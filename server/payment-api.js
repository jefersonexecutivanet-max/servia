import { createHash } from "node:crypto";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import security from "./security.cjs";
import { CashValidationError, calculateDiscount, normalizePaymentParts, toCents } from "./cash-logic.js";
import { authorizeManagerPin, SupervisorApprovalError } from "./cash-approval.js";
import { quantityCanBeSettled, splitTransferOrders, unpaidLineQuantity } from "./payment-domain.js";

const { isRequestOriginAllowed } = security;

class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function fail(code, message) {
  const statuses = { "invalid-argument": 400, unauthenticated: 401, "permission-denied": 403, "not-found": 404, "failed-precondition": 409, "resource-exhausted": 429, internal: 500 };
  throw new ApiError(code, message, statuses[code] || 500);
}

function getServices() {
  if (getApps().length === 0) {
    const serialized = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serialized) throw new ApiError("configuration", "Credencial administrativa do Firebase não configurada no Vercel.", 500);
    let serviceAccount;
    try { serviceAccount = JSON.parse(serialized); } catch { throw new ApiError("configuration", "FIREBASE_SERVICE_ACCOUNT_JSON não contém um JSON válido.", 500); }
    initializeApp({ credential: cert(serviceAccount), projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id });
  }
  return { auth: getAuth(), db: getFirestore() };
}

function requireString(value, label, maxLength = 128) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) fail("invalid-argument", `${label} é obrigatório.`);
  return value.trim();
}

async function assertCanCloseRestaurant(db, user, restaurantId) {
  const restaurantSnapshot = await db.collection("restaurants").doc(restaurantId).get();
  if (!restaurantSnapshot.exists) fail("not-found", "Restaurante não encontrado.");
  const restaurant = restaurantSnapshot.data();
  const paidUntil = restaurant.monthlyPaidUntil;
  if (restaurant.status !== "active" || !paidUntil?.toMillis || paidUntil.toMillis() <= Date.now()) fail("permission-denied", "O restaurante não está com o acesso liberado.");

  const staff = await db.collection("restaurantStaff").doc(user.uid).get();
  const data = staff.data();
  if (staff.exists && data?.active === true && data.restaurantId === restaurantId && data.role === "CASHIER") {
    return { name: String(data.name || user.name || user.email || "Caixa").slice(0, 100) };
  }
  fail("permission-denied", "Somente o Caixa pode fechar mesas e receber pagamentos.");
}


async function resolveDiscount(data, db, request, restaurantId, requestingUser) {
  if (data?.discount === undefined || data?.discount === null) return null;
  const requested = data.discount;
  if (!["percent", "fixed"].includes(requested?.type)) fail("invalid-argument", "Tipo de desconto inválido.");
  let valueCents;
  try { valueCents = toCents(requested.value, requested.type === "percent" ? "Percentual do desconto" : "Desconto em reais"); }
  catch (error) { if (error instanceof CashValidationError) fail("invalid-argument", error.message); throw error; }
  if (requested.type === "percent" && valueCents > 10000) fail("invalid-argument", "O desconto percentual não pode ultrapassar 100%.");
  const reason = requireString(requested.reason, "Motivo do desconto", 120);
  if (reason.length < 4) fail("invalid-argument", "Informe o motivo do desconto (mínimo 4 caracteres).");
  let supervisor;
  try { supervisor = await authorizeManagerPin(db, request, restaurantId, requested.supervisorCode, requested.supervisorPin); }
  catch (error) { if (error instanceof SupervisorApprovalError) throw new ApiError(error.code, error.message, error.status); throw error; }
  if (supervisor.uid === requestingUser?.uid) fail("permission-denied", "O gerente não pode autorizar o próprio desconto.");
  return { type: requested.type, value: Number(requested.value), reason, supervisor };
}

function applyResolvedDiscount(subtotalCents, requested) {
  if (!requested) return { discountCents: 0, netSubtotalCents: subtotalCents };
  try { return calculateDiscount(subtotalCents, requested); }
  catch (error) { if (error instanceof CashValidationError) fail("invalid-argument", error.message); throw error; }
}

function validateDiscountApprovalSnapshots(snapshots, approval, restaurantId) {
  if (!approval) return;
  const [codeSnapshot, waiterSnapshot, directorySnapshot, staffSnapshot, secretSnapshot] = snapshots;
  const waiter = waiterSnapshot.data();
  const directory = directorySnapshot.data();
  const staff = staffSnapshot.data();
  if (!codeSnapshot.exists || codeSnapshot.data()?.active !== true || codeSnapshot.data()?.restaurantId !== restaurantId
    || codeSnapshot.data()?.employeeId !== approval.employeeId
    || !waiterSnapshot.exists || waiter?.active !== true || waiter.restaurantId !== restaurantId || waiter.role !== "MANAGER" || waiter.uid !== approval.uid
    || !directorySnapshot.exists || directory?.active !== true || directory.restaurantId !== restaurantId || directory.role !== "MANAGER"
    || !staffSnapshot.exists || staff?.active !== true || staff.restaurantId !== restaurantId || staff.role !== "MANAGER" || staff.waiterId !== approval.employeeId
    || !secretSnapshot.exists || secretSnapshot.data()?.pinHash !== approval.pinHash) {
    fail("permission-denied", "A autorização do gerente deixou de ser válida. Solicite novamente.");
  }
}

function cents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) fail("invalid-argument", "Valor monetário inválido.");
  return Math.round(n * 100);
}

function requestedOrderIds(data) {
  if (data?.orderIds === undefined) return null;
  if (!Array.isArray(data.orderIds) || data.orderIds.length < 1 || data.orderIds.length > 100
    || data.orderIds.some((id) => typeof id !== "string" || !id.trim())
    || new Set(data.orderIds).size !== data.orderIds.length) {
    fail("invalid-argument", "Seleção de pedidos inválida.");
  }
  return new Set(data.orderIds);
}

function requestedItemSelections(data) {
  if (data?.itemSelections === undefined) return null;
  if (!Array.isArray(data.itemSelections) || data.itemSelections.length < 1 || data.itemSelections.length > 500) {
    fail("invalid-argument", "Seleção de itens inválida.");
  }
  const seen = new Set();
  for (const selection of data.itemSelections) {
    const orderId = requireString(selection?.orderId, "Pedido", 128);
    const lineIndex = Number(selection?.lineIndex);
    const quantity = Number(selection?.quantity);
    const key = `${orderId}:${lineIndex}`;
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex > 99 || !Number.isInteger(quantity) || quantity < 1 || quantity > 99 || seen.has(key)) {
      fail("invalid-argument", "Seleção de itens inválida.");
    }
    seen.add(key);
  }
  return new Map(data.itemSelections.map((item) => [`${item.orderId}:${Number(item.lineIndex)}`, Number(item.quantity)]));
}

async function quoteTable(data, db, user, request) {
  const restaurantId = requireString(data?.restaurantId, "Restaurante");
  const tableNumber = Number(data?.tableNumber);
  if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 9999) fail("invalid-argument", "Número da mesa inválido.");
  await assertCanCloseRestaurant(db, user, restaurantId);
  const tableId = `${restaurantId}_${tableNumber}`;
  const [tableSnapshot, orderSnapshot, restaurantSnapshot, registerSnapshot] = await Promise.all([
    db.collection("tables").doc(tableId).get(),
    db.collection("orders").where("restaurantId", "==", restaurantId).where("tableNumber", "==", tableNumber).get(),
    db.collection("restaurants").doc(restaurantId).get(),
    db.collection("cashRegisters").doc(restaurantId).get(),
  ]);
  if (!tableSnapshot.exists || tableSnapshot.data().restaurantId !== restaurantId || tableSnapshot.data().number !== tableNumber) fail("not-found", "Mesa não encontrada neste restaurante.");
  const orderIds = requestedOrderIds(data);
  const itemSelections = requestedItemSelections(data);
  const sessionId = registerSnapshot.data()?.activeSessionId;
  if (!sessionId) fail("failed-precondition", "Abra o caixa antes de conferir contas.");
  const sessionSnapshot = await db.collection("cashSessions").doc(sessionId).get();
  if (!sessionSnapshot.exists || sessionSnapshot.data().restaurantId !== restaurantId || sessionSnapshot.data().status !== "open") fail("failed-precondition", "Não há uma sessão de caixa aberta.");
  const activeOrders = orderSnapshot.docs.filter((snapshot) => {
    const order = snapshot.data();
    return order.tableId === tableId && order.status !== "cancelado" && order.paymentStatus !== "paid"
       && (!orderIds || orderIds.has(snapshot.id))
       && (!itemSelections || [...itemSelections.keys()].some((key) => key.startsWith(`${snapshot.id}:`)));
  });
  if (activeOrders.length === 0) fail("invalid-argument", "Não há pedidos em aberto para esta mesa.");
  if (orderIds && !itemSelections && activeOrders.length !== orderIds.size) fail("failed-precondition", "Um ou mais pedidos selecionados não estão mais disponíveis nesta mesa.");
  let subtotalCents = 0;
  const items = [];
  let selectedLineCount = 0;
  for (const orderSnapshotItem of activeOrders) {
    const order = orderSnapshotItem.data();
    if (!Array.isArray(order.items)) fail("invalid-argument", "Pedido inválido encontrado na mesa.");
    for (let lineIndex = 0; lineIndex < order.items.length; lineIndex += 1) {
      const item = order.items[lineIndex];
      const available = unpaidLineQuantity(order, lineIndex);
      const quantity = itemSelections ? itemSelections.get(`${orderSnapshotItem.id}:${lineIndex}`) || 0 : available;
      if (!Number.isInteger(available) || available < 0 || !Number.isInteger(quantity) || quantity < 0 || quantity > available) fail("failed-precondition", "A quantidade selecionada não está mais disponível.");
      if (quantity === 0) continue;
      if (itemSelections) selectedLineCount += 1;
      const unitCents = cents(item.price);
      subtotalCents += unitCents * quantity;
      items.push({ name: String(item.name || "Produto"), quantity, price: unitCents / 100, extras: Array.isArray(item.extras) ? item.extras : [], notes: String(item.notes || "") });
    }
  }
  if (itemSelections && (items.length === 0 || selectedLineCount !== itemSelections.size)) fail("failed-precondition", "Um ou mais itens selecionados não estão mais disponíveis.");
  const restaurant = restaurantSnapshot.data();
  const discount = await resolveDiscount(data, db, request, restaurantId, user);
  const discountCalculation = applyResolvedDiscount(subtotalCents, discount);
  const configuredFee = Number(restaurant?.payment?.serviceFee ?? 10);
  const serviceFeePercent = Number.isFinite(configuredFee) ? Math.min(100, Math.max(0, configuredFee)) : 10;
  const serviceFeeCents = Math.round(discountCalculation.netSubtotalCents * serviceFeePercent / 100);
  const amountCents = discountCalculation.netSubtotalCents + serviceFeeCents;
  return {
    restaurantId, tableId, tableNumber, sessionId, orderIds: activeOrders.map((item) => item.id), items,
    subtotal: subtotalCents / 100, discount: discountCalculation.discountCents / 100,
    discountType: discount?.type || "none", discountValue: discount?.value || 0, discountReason: discount?.reason || "",
    discountAuthorizedBy: discount?.supervisor.name || "", netSubtotal: discountCalculation.netSubtotalCents / 100,
    serviceFee: serviceFeeCents / 100, serviceFeePercent, amount: amountCents / 100,
  };
}

async function closeTable(data, db, user, request) {
  const restaurantId = requireString(data?.restaurantId, "Restaurante");
  const tableNumber = Number(data?.tableNumber);
  if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 9999) fail("invalid-argument", "Número da mesa inválido.");
  const operator = await assertCanCloseRestaurant(db, user, restaurantId);
  const discountApproval = await resolveDiscount(data, db, request, restaurantId, user);
  const orderIds = requestedOrderIds(data);
  const itemSelections = requestedItemSelections(data);
  const idempotencyKey = requireString(data?.idempotencyKey, "Chave da operação", 128);
  if (!/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) fail("invalid-argument", "Chave da operação inválida.");
  const requestHash = createHash("sha256").update(JSON.stringify({ restaurantId, tableNumber, orderIds: orderIds ? [...orderIds].sort() : null, itemSelections: itemSelections ? [...itemSelections.entries()].sort() : null, paymentMethod: data.paymentMethod, paymentParts: data.paymentParts || null, cashReceived: data.cashReceived ?? null, discount: discountApproval ? { type: discountApproval.type, value: discountApproval.value, reason: discountApproval.reason, employeeId: discountApproval.supervisor.employeeId } : null })).digest("hex");

  const tableId = `${restaurantId}_${tableNumber}`;
  const tableRef = db.collection("tables").doc(tableId);
  const assignmentRef = db.collection("waiterTables").doc(tableId);
  const billRequestRef = db.collection("billRequests").doc(`${tableId}_bill`);
  const registerRef = db.collection("cashRegisters").doc(restaurantId);
  const auditRef = db.collection("cashAudit").doc();
  const operationId = createHash("sha256").update(`close-table:${restaurantId}:${user.uid}:${idempotencyKey}`).digest("hex");
  const operationRef = db.collection("cashIdempotency").doc(operationId);
  const result = await db.runTransaction(async (transaction) => {
    const previousOperation = await transaction.get(operationRef);
    if (previousOperation.exists) {
      const previous = previousOperation.data();
      if (previous.requestHash !== requestHash || previous.restaurantId !== restaurantId || previous.actorUid !== user.uid) fail("permission-denied", "Chave de operação inválida.");
      return { ...previous.result, reused: true };
    }
    const [tableSnapshot, assignmentSnapshot, orderSnapshot, restaurantSnapshot, billRequestSnapshot, registerSnapshot] = await Promise.all([
      transaction.get(tableRef),
      transaction.get(assignmentRef),
      transaction.get(db.collection("orders").where("restaurantId", "==", restaurantId).where("tableNumber", "==", tableNumber)),
      transaction.get(db.collection("restaurants").doc(restaurantId)),
      transaction.get(billRequestRef),
      transaction.get(registerRef),
    ]);
    const sessionId = registerSnapshot.data()?.activeSessionId;
    if (!sessionId) fail("failed-precondition", "Abra o caixa antes de receber pagamentos.");
    const sessionRef = db.collection("cashSessions").doc(sessionId);
    const sessionSnapshot = await transaction.get(sessionRef);
    if (!sessionSnapshot.exists || sessionSnapshot.data().restaurantId !== restaurantId || sessionSnapshot.data().status !== "open") {
      fail("failed-precondition", "Não há uma sessão de caixa aberta.");
    }
    if (discountApproval) {
      const refs = discountApproval.supervisor.refs;
      const approvalSnapshots = await Promise.all([refs.code, refs.waiter, refs.directory, refs.staff, refs.secret].map((ref) => transaction.get(ref)));
      validateDiscountApprovalSnapshots(approvalSnapshots, discountApproval.supervisor, restaurantId);
    }
    const restaurant = restaurantSnapshot.data();
    if (!restaurantSnapshot.exists || restaurant.status !== "active" || !restaurant.monthlyPaidUntil?.toMillis || restaurant.monthlyPaidUntil.toMillis() <= Date.now()) {
      fail("permission-denied", "O restaurante não está com o acesso liberado.");
    }
    if (!tableSnapshot.exists || tableSnapshot.data().restaurantId !== restaurantId || tableSnapshot.data().number !== tableNumber) fail("not-found", "Mesa não encontrada neste restaurante.");
    const activeOrders = orderSnapshot.docs.filter((snapshot) => {
      const value = snapshot.data();
      return value.tableId === tableId && value.status !== "cancelado" && value.paymentStatus !== "paid"
        && (!orderIds || orderIds.has(snapshot.id))
        && (!itemSelections || [...itemSelections.keys()].some((key) => key.startsWith(`${snapshot.id}:`)));
    });
    if (activeOrders.length === 0) fail("invalid-argument", "Não há pedidos em aberto para esta mesa.");
    if (orderIds && !itemSelections && activeOrders.length !== orderIds.size) fail("failed-precondition", "Um ou mais pedidos selecionados não estão mais disponíveis nesta mesa.");

    let subtotalCents = 0;
    let itemCount = 0;
    const items = [];
    const paidQuantitiesByOrder = new Map();
    const settledSelections = [];
    const settledItemDetails = [];
    for (const snapshot of activeOrders) {
      const value = snapshot.data();
      if (!Array.isArray(value.items)) fail("invalid-argument", "Pedido inválido encontrado na mesa.");
      const paidQuantities = { ...(value.paidQuantities || {}) };
      for (let lineIndex = 0; lineIndex < value.items.length; lineIndex += 1) {
        const item = value.items[lineIndex];
        const available = unpaidLineQuantity(value, lineIndex);
        const quantity = itemSelections ? itemSelections.get(`${snapshot.id}:${lineIndex}`) || 0 : available;
        if (!Number.isInteger(available) || available < 0 || !Number.isInteger(quantity) || quantity < 0 || quantity > available) fail("failed-precondition", "A quantidade selecionada não está mais disponível.");
        if (quantity === 0) continue;
        if (!quantityCanBeSettled(value, lineIndex, quantity)) fail("failed-precondition", "A quantidade selecionada não está mais disponível.");
        const unitCents = cents(item.price);
        subtotalCents += unitCents * quantity;
        itemCount += quantity;
        items.push({ name: String(item.name || "Produto"), quantity, price: unitCents / 100 });
        settledSelections.push({ orderId: snapshot.id, lineIndex, quantity });
        settledItemDetails.push({ orderId: snapshot.id, lineIndex, productId: String(item.productId || ""), name: String(item.name || "Produto"), quantity, unitPriceCents: unitCents });
        paidQuantities[String(lineIndex)] = Number(paidQuantities[String(lineIndex)] || 0) + quantity;
      }
      paidQuantitiesByOrder.set(snapshot.id, paidQuantities);
    }
    if (items.length === 0) fail("invalid-argument", "Selecione ao menos um item disponível para receber.");
    if (itemSelections && settledSelections.length !== itemSelections.size) fail("failed-precondition", "Um ou mais itens selecionados não estão mais disponíveis.");
    if (subtotalCents <= 0) fail("invalid-argument", "O total da mesa deve ser maior que zero.");

    const discountCalculation = applyResolvedDiscount(subtotalCents, discountApproval);
    const configuredFee = Number(restaurant.payment?.serviceFee ?? 10);
    const serviceFeePercent = Number.isFinite(configuredFee) ? Math.min(100, Math.max(0, configuredFee)) : 10;
    const serviceFeeCents = Math.round(discountCalculation.netSubtotalCents * serviceFeePercent / 100);
    const amountCents = discountCalculation.netSubtotalCents + serviceFeeCents;
    let payment;
    try {
      const requestedParts = Array.isArray(data.paymentParts)
        ? data.paymentParts
        : [{ method: data.paymentMethod === "card" ? "credit" : data.paymentMethod, amount: amountCents / 100 }];
      payment = normalizePaymentParts(requestedParts, amountCents, data.cashReceived);
    } catch (error) {
      if (error instanceof CashValidationError) fail("invalid-argument", error.message);
      throw error;
    }
    const paymentRef = db.collection("payments").doc();
    transaction.create(paymentRef, {
      restaurantId,
      tableId,
      tableNumber,
      cashSessionId: sessionId,
      method: payment.parts.length === 1 ? payment.parts[0].method : "split",
      paymentParts: payment.parts,
      cashReceivedCents: payment.receivedCents,
      cashReceived: payment.receivedCents / 100,
      changeCents: payment.changeCents,
      change: payment.changeCents / 100,
      amount: amountCents / 100,
      amountCents,
      subtotalCents,
      discountCents: discountCalculation.discountCents,
      discount: discountCalculation.discountCents / 100,
      discountType: discountApproval?.type || "none",
      discountValue: discountApproval?.value || 0,
      discountReason: discountApproval?.reason || "",
      discountAuthorizedByUid: discountApproval?.supervisor.uid || "",
      discountAuthorizedByName: discountApproval?.supervisor.name || "",
      discountAuthorizedByEmployeeId: discountApproval?.supervisor.employeeId || "",
      items: itemCount,
      status: "completed",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: user.uid,
      createdByName: operator.name,
      serviceFeePercent,
      orderIds: activeOrders.map((snapshot) => snapshot.id),
      itemSelections: settledSelections,
      itemDetails: settledItemDetails,
    });
    for (const snapshot of activeOrders) {
      const value = snapshot.data();
      const paidQuantities = paidQuantitiesByOrder.get(snapshot.id);
      const hasRemaining = value.items.some((item, index) => Number(item.quantity) - Number(paidQuantities[String(index)] || 0) - Number(item.cancelledQuantity || 0) > 0);
      const outstandingTotal = value.items.reduce((sum, item, index) => sum + cents(item.price) * Math.max(0, Number(item.quantity) - Number(paidQuantities[String(index)] || 0) - Number(item.cancelledQuantity || 0)), 0) / 100;
      transaction.update(snapshot.ref, { paidQuantities, total: outstandingTotal, ...(hasRemaining ? {} : { paymentStatus: "paid", paymentId: paymentRef.id, paidAt: FieldValue.serverTimestamp() }) });
    }
    const remainingOrders = orderSnapshot.docs.filter((snapshot) => {
      const value = snapshot.data();
      if (value.tableId !== tableId || value.status === "cancelado" || value.paymentStatus === "paid") return false;
      const paid = paidQuantitiesByOrder.get(snapshot.id) || value.paidQuantities || {};
      return value.items.some((item, index) => Number(item.quantity) - Number(paid[String(index)] || 0) - Number(item.cancelledQuantity || 0) > 0);
    });
    if (remainingOrders.length === 0) {
      transaction.update(tableRef, { status: "livre", guests: 0, total: 0, customer: FieldValue.delete() });
      if (assignmentSnapshot.exists) transaction.delete(assignmentRef);
    } else {
      const outstandingTableTotal = orderSnapshot.docs.reduce((sum, snapshot) => {
        const value = snapshot.data();
        if (value.tableId !== tableId || value.status === "cancelado" || value.paymentStatus === "paid") return sum;
        const paid = paidQuantitiesByOrder.get(snapshot.id) || value.paidQuantities || {};
        return sum + value.items.reduce((subtotal, item, index) => subtotal + cents(item.price) * Math.max(0, Number(item.quantity) - Number(paid[String(index)] || 0) - Number(item.cancelledQuantity || 0)), 0);
      }, 0) / 100;
      transaction.update(tableRef, { status: "ocupada", total: outstandingTableTotal });
    }
    if (remainingOrders.length === 0 && billRequestSnapshot.exists && billRequestSnapshot.data().status !== "completed") {
      transaction.update(billRequestRef, {
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        attendedBy: operator.name,
      });
    }
    transaction.create(auditRef, {
      restaurantId,
      sessionId,
      actorUid: user.uid,
      actorName: operator.name,
      action: "payment_completed",
      amountCents,
      referenceId: paymentRef.id,
      details: { tableId, tableNumber, orderIds: activeOrders.map((snapshot) => snapshot.id), itemSelections: settledSelections, paymentParts: payment.parts, changeCents: payment.changeCents, discountCents: discountCalculation.discountCents, discountReason: discountApproval?.reason || "", discountAuthorizedByUid: discountApproval?.supervisor.uid || "" },
      createdAt: FieldValue.serverTimestamp(),
    });

    const response = {
      paymentId: paymentRef.id,
      items,
      amount: amountCents / 100,
      subtotal: subtotalCents / 100,
      discount: discountCalculation.discountCents / 100,
      discountReason: discountApproval?.reason || "",
      discountAuthorizedBy: discountApproval?.supervisor.name || "",
      waiterName: String(assignmentSnapshot.data()?.waiterName || "Nao informado"),
      serviceFee: serviceFeeCents / 100,
      paymentParts: payment.parts,
      cashReceived: payment.receivedCents / 100,
      change: payment.changeCents / 100,
      orderIds: activeOrders.map((snapshot) => snapshot.id),
    };
    transaction.create(operationRef, { restaurantId, actorUid: user.uid, requestHash, result: response, createdAt: FieldValue.serverTimestamp() });
    return response;
  });
  return result;
}

async function transferOrders(data, db, user) {
  const restaurantId = requireString(data?.restaurantId, "Restaurante");
  const sourceNumber = Number(data?.sourceTableNumber);
  const destinationNumber = Number(data?.destinationTableNumber);
  if (!Number.isInteger(sourceNumber) || sourceNumber < 1 || sourceNumber > 9999
    || !Number.isInteger(destinationNumber) || destinationNumber < 1 || destinationNumber > 9999
    || sourceNumber === destinationNumber) fail("invalid-argument", "Mesas de origem e destino inválidas.");
  const operator = await assertCanCloseRestaurant(db, user, restaurantId);
  const selectedIds = requestedOrderIds(data);
  const sourceId = `${restaurantId}_${sourceNumber}`;
  const destinationId = `${restaurantId}_${destinationNumber}`;
  const sourceRef = db.collection("tables").doc(sourceId);
  const destinationRef = db.collection("tables").doc(destinationId);
  const sourceAssignmentRef = db.collection("waiterTables").doc(sourceId);
  const destinationAssignmentRef = db.collection("waiterTables").doc(destinationId);
  const sourceBillRef = db.collection("billRequests").doc(`${sourceId}_bill`);
  const auditRef = db.collection("cashAudit").doc();

  return db.runTransaction(async (transaction) => {
    const [sourceSnapshot, destinationSnapshot, orderSnapshot, sourceAssignment, destinationAssignment, sourceBillSnapshot] = await Promise.all([
      transaction.get(sourceRef), transaction.get(destinationRef),
      transaction.get(db.collection("orders").where("restaurantId", "==", restaurantId).where("tableNumber", "==", sourceNumber)),
      transaction.get(sourceAssignmentRef), transaction.get(destinationAssignmentRef), transaction.get(sourceBillRef),
    ]);
    if (!sourceSnapshot.exists || sourceSnapshot.data().restaurantId !== restaurantId || sourceSnapshot.data().number !== sourceNumber
      || !destinationSnapshot.exists || destinationSnapshot.data().restaurantId !== restaurantId || destinationSnapshot.data().number !== destinationNumber) {
      fail("not-found", "Mesa de origem ou destino não pertence a este restaurante.");
    }
    if (destinationSnapshot.data().status === "reservada") fail("failed-precondition", "Não é possível transferir pedidos para uma mesa reservada.");
    let transferPlan;
    try {
      transferPlan = splitTransferOrders(orderSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ref: snapshot.ref, ...snapshot.data() })), sourceId, selectedIds);
    } catch {
      fail("failed-precondition", "Um ou mais pedidos selecionados não estão mais disponíveis na mesa de origem.");
    }
    const { moving: orders, remaining } = transferPlan;
    for (const order of orders) transaction.update(order.ref, { tableId: destinationId, tableNumber: destinationNumber, transferredAt: FieldValue.serverTimestamp(), transferredBy: user.uid });
    transaction.update(sourceRef, { status: remaining.length ? "ocupada" : "livre", ...(remaining.length ? {} : { guests: 0, total: 0, customer: FieldValue.delete() }) });
    transaction.update(destinationRef, { status: "ocupada" });
    if (!remaining.length && sourceAssignment.exists) {
      if (!destinationAssignment.exists) {
        transaction.set(destinationAssignmentRef, { ...sourceAssignment.data(), tableId: destinationId, tableNumber: destinationNumber, updatedAt: FieldValue.serverTimestamp() });
      }
      transaction.delete(sourceAssignmentRef);
    }
    if (!remaining.length && sourceBillSnapshot.exists && sourceBillSnapshot.data().status !== "completed") {
      transaction.update(sourceBillRef, { status: "completed", completedAt: FieldValue.serverTimestamp(), attendedBy: operator.name, transferToTableNumber: destinationNumber });
    }
    transaction.create(auditRef, {
      restaurantId, actorUid: user.uid, actorName: operator.name,
      action: "orders_transferred", amountCents: 0,
      referenceId: `${sourceId}->${destinationId}`,
      details: { sourceTableNumber: sourceNumber, destinationTableNumber: destinationNumber, orderIds: orders.map((order) => order.id) },
      createdAt: FieldValue.serverTimestamp(),
    });
    return { moved: orders.length, remaining: remaining.length, sourceTableNumber: sourceNumber, destinationTableNumber: destinationNumber };
  });
}

async function cancelOrderItem(data, db, user, request) {
  const restaurantId = requireString(data?.restaurantId, "Restaurante");
  const orderId = requireString(data?.orderId, "Pedido", 128);
  const lineIndex = Number(data?.lineIndex);
  const quantity = Number(data?.quantity);
  const reason = requireString(data?.reason, "Motivo do cancelamento", 120);
  if (reason.length < 4 || !Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex > 99
    || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) fail("invalid-argument", "Informe item, quantidade e motivo válidos.");
  const idempotencyKey = requireString(data?.idempotencyKey, "Chave da operação", 128);
  if (!/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) fail("invalid-argument", "Chave da operação inválida.");
  const operator = await assertCanCloseRestaurant(db, user, restaurantId);
  let supervisor;
  try { supervisor = await authorizeManagerPin(db, request, restaurantId, data?.supervisorCode, data?.supervisorPin); }
  catch (error) { if (error instanceof SupervisorApprovalError) throw new ApiError(error.code, error.message, error.status); throw error; }
  if (supervisor.uid === user.uid) fail("permission-denied", "O gerente não pode autorizar o próprio cancelamento.");

  const requestHash = createHash("sha256").update(JSON.stringify({ restaurantId, orderId, lineIndex, quantity, reason, supervisorCode: data.supervisorCode })).digest("hex");
  const operationId = createHash("sha256").update(`cancel-item:${restaurantId}:${user.uid}:${idempotencyKey}`).digest("hex");
  const operationRef = db.collection("cashIdempotency").doc(operationId);
  const orderRef = db.collection("orders").doc(orderId);
  const auditRef = db.collection("cashAudit").doc();

  return db.runTransaction(async (transaction) => {
    const prior = await transaction.get(operationRef);
    if (prior.exists) {
      const previous = prior.data();
      if (previous.requestHash !== requestHash || previous.restaurantId !== restaurantId || previous.actorUid !== user.uid) fail("permission-denied", "Chave de operação inválida.");
      return { ...previous.result, reused: true };
    }
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists || orderSnapshot.data().restaurantId !== restaurantId) fail("not-found", "Pedido não encontrado neste restaurante.");
    const order = orderSnapshot.data();
    if (order.paymentStatus === "paid") fail("failed-precondition", "Pedido pago não pode ser cancelado.");
    if (order.status === "cancelado" || !Array.isArray(order.items) || !order.items[lineIndex]) fail("failed-precondition", "Pedido ou item não está mais disponível para cancelamento.");
    const line = order.items[lineIndex];
    if (data?.expectedProductId !== line.productId || data?.expectedName !== line.name
      || Math.round(Number(data?.expectedPrice) * 100) !== Math.round(Number(line.price) * 100)
      || JSON.stringify(Array.isArray(data?.expectedExtras) ? data.expectedExtras : []) !== JSON.stringify(Array.isArray(line.extras) ? line.extras : [])
      || String(data?.expectedNotes || "") !== String(line.notes || "")) {
      fail("failed-precondition", "A comanda mudou. Atualize a mesa e selecione o item novamente.");
    }
    const oldQuantity = Number(line.quantity);
    const alreadyPaid = Number(order.paidQuantities?.[String(lineIndex)] || 0);
    const previouslyCancelled = Number(line.cancelledQuantity || 0);
    const availableToCancel = unpaidLineQuantity(order, lineIndex);
    if (!Number.isInteger(oldQuantity) || !Number.isInteger(alreadyPaid) || !Number.isInteger(previouslyCancelled)
      || availableToCancel < 0 || !quantityCanBeSettled(order, lineIndex, quantity)) fail("invalid-argument", "A quantidade informada excede os itens ainda não pagos da comanda.");
    const tableRef = db.collection("tables").doc(String(order.tableId));
    const assignmentRef = db.collection("waiterTables").doc(String(order.tableId));
    const billRequestRef = db.collection("billRequests").doc(`${order.tableId}_bill`);
    const registerRef = db.collection("cashRegisters").doc(restaurantId);
    const refs = supervisor.refs;
    const [tableSnapshot, assignmentSnapshot, billRequestSnapshot, registerSnapshot, codeSnapshot, waiterSnapshot, directorySnapshot, staffSnapshot, secretSnapshot] = await Promise.all([
      transaction.get(tableRef), transaction.get(assignmentRef), transaction.get(billRequestRef), transaction.get(registerRef),
      transaction.get(refs.code), transaction.get(refs.waiter), transaction.get(refs.directory), transaction.get(refs.staff), transaction.get(refs.secret),
    ]);
    const sessionId = registerSnapshot.data()?.activeSessionId;
    if (!sessionId) fail("failed-precondition", "Abra o Caixa antes de cancelar itens.");
    const sessionSnapshot = await transaction.get(db.collection("cashSessions").doc(sessionId));
    if (!sessionSnapshot.exists || sessionSnapshot.data().restaurantId !== restaurantId || sessionSnapshot.data().status !== "open") fail("failed-precondition", "Não há uma sessão de Caixa aberta.");
    validateDiscountApprovalSnapshots([codeSnapshot, waiterSnapshot, directorySnapshot, staffSnapshot, secretSnapshot], supervisor, restaurantId);
    if (!tableSnapshot.exists || tableSnapshot.data().restaurantId !== restaurantId) fail("failed-precondition", "A mesa deste pedido não está disponível.");

    const restoredByStockId = new Map();
    const usage = Array.isArray(line.stockUsage) ? line.stockUsage : [];
    const reservedQuantity = oldQuantity - previouslyCancelled;
    const restoreFactor = quantity / reservedQuantity;
    for (const ingredient of usage) {
      const stockId = requireString(ingredient?.stockId, "Ingrediente", 128);
      const restore = Number(ingredient?.quantity) * restoreFactor;
      if (!Number.isFinite(restore) || restore <= 0) fail("failed-precondition", "Registro de consumo de estoque inválido.");
      restoredByStockId.set(stockId, (restoredByStockId.get(stockId) || 0) + restore);
    }
    const restoredStocks = [];
    for (const [stockId, amount] of restoredByStockId) {
      const ref = db.collection("stock").doc(stockId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data().restaurantId !== restaurantId) fail("failed-precondition", "Não foi possível estornar um ingrediente da ficha técnica.");
      restoredStocks.push({ ref, snapshot, amount });
    }
    const newItems = order.items.map((item, index) => ({ ...item, ...(index === lineIndex ? {
      cancelledQuantity: previouslyCancelled + quantity,
      ...(usage.length ? { stockUsage: usage.map((ingredient) => ({ ...ingredient, quantity: Number(ingredient.quantity) * ((reservedQuantity - quantity) / reservedQuantity) })) } : {}),
    } : {}) }));
    const paidQuantities = order.paidQuantities || {};
    const remainingQuantity = oldQuantity - alreadyPaid - previouslyCancelled - quantity;
    const cancelled = newItems.every((item, index) => Number(item.quantity) - Number(paidQuantities[String(index)] || 0) - Number(item.cancelledQuantity || 0) <= 0);
    const nextTotal = newItems.reduce((sum, item, index) => sum + (Number(item.price) || 0) * Math.max(0, Number(item.quantity) - Number(paidQuantities[String(index)] || 0) - Number(item.cancelledQuantity || 0)), 0);
    const tableOrders = await transaction.get(db.collection("orders").where("restaurantId", "==", restaurantId).where("tableNumber", "==", Number(order.tableNumber)));
    const hasOtherOpenOrders = tableOrders.docs.some((snapshot) => snapshot.id !== orderId && snapshot.data().tableId === order.tableId && snapshot.data().status !== "cancelado" && snapshot.data().paymentStatus !== "paid");

    for (const stock of restoredStocks) {
      transaction.update(stock.ref, { quantity: Number(stock.snapshot.data().quantity) + stock.amount, lastUpdated: FieldValue.serverTimestamp() });
      transaction.create(db.collection("stockMovements").doc(`cancel_${operationId}_${stock.ref.id}`), { restaurantId, stockId: stock.ref.id, referenceId: orderId, type: "item_cancelled", quantity: stock.amount, actorUid: user.uid, createdAt: FieldValue.serverTimestamp() });
    }
    transaction.update(orderRef, { items: newItems, total: nextTotal, ...(cancelled ? { status: "cancelado", cancelledAt: FieldValue.serverTimestamp() } : {}), cancellationUpdatedAt: FieldValue.serverTimestamp() });
    if (cancelled && !hasOtherOpenOrders) {
      transaction.update(tableRef, { status: "livre", total: 0, guests: 0, customer: FieldValue.delete() });
      if (assignmentSnapshot.exists) transaction.delete(assignmentRef);
      if (billRequestSnapshot.exists && billRequestSnapshot.data().status !== "completed") transaction.update(billRequestRef, { status: "completed", completedAt: FieldValue.serverTimestamp(), attendedBy: operator.name, cancellationReason: reason });
    }
    const result = { orderId, itemName: String(line.name || "Produto"), cancelledQuantity: quantity, remainingQuantity, cancelled };
    transaction.create(auditRef, {
      restaurantId, sessionId, actorUid: user.uid, actorName: operator.name,
      action: "order_item_cancelled", amountCents: Math.round((Number(line.price) || 0) * quantity * 100),
      referenceId: orderId,
      details: { lineIndex, productId: line.productId || "", itemName: result.itemName, quantity, reason, supervisorUid: supervisor.uid, supervisorName: supervisor.name, restoredStock: [...restoredByStockId].map(([stockId, amount]) => ({ stockId, quantity: amount })) },
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(operationRef, { restaurantId, actorUid: user.uid, requestHash, result, createdAt: FieldValue.serverTimestamp() });
    return { ...result, reused: false };
  });
}

export default async function paymentApi(action, request, response) {
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ error: { code: "method-not-allowed", message: "Método não permitido." } });
  const origin = request.headers.origin;
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173").split(",").map((o) => o.trim()).filter(Boolean);
  if (!isRequestOriginAllowed(request, origin, allowedOrigins)) return response.status(403).json({ error: { code: "permission-denied", message: "Origem não autorizada." } });
  if (origin) { response.setHeader("Access-Control-Allow-Origin", origin); response.setHeader("Vary", "Origin"); }
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Cache-Control", "no-store");

  try {
    const { db, auth } = getServices();
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) fail("unauthenticated", "Entre na sua conta para continuar.");
    let user;
    try { user = await auth.verifyIdToken(token); } catch { fail("unauthenticated", "Sua sessão expirou. Entre novamente."); }
    const payload = request.body && typeof request.body === "object" ? request.body : {};
    if (!["close", "quote", "transfer", "cancel-item"].includes(action)) fail("not-found", "Operação não encontrada.");
    const result = action === "quote" ? await quoteTable(payload, db, user, request)
      : action === "transfer" ? await transferOrders(payload, db, user)
        : action === "cancel-item" ? await cancelOrderItem(payload, db, user, request)
        : await closeTable(payload, db, user, request);
    return response.status(200).json({ data: result });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : "internal";
    const message = error instanceof ApiError ? error.message : "Não foi possível concluir o fechamento da mesa.";
    if (status === 500) console.error("Payment API error", error?.code || error?.message || "unknown");
    return response.status(status).json({ error: { code, message } });
  }
}

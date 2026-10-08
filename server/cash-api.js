import { createHash } from "node:crypto";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import security from "./security.cjs";
import { CashValidationError, toCents } from "./cash-logic.js";

const { isRequestOriginAllowed } = security;

class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status = 400) {
  throw new ApiError(code, message, status);
}

function getServices() {
  if (getApps().length === 0) {
    const serialized = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serialized) fail("configuration", "Credencial administrativa do Firebase não configurada.", 500);
    let serviceAccount;
    try { serviceAccount = JSON.parse(serialized); } catch { fail("configuration", "Credencial administrativa inválida.", 500); }
    initializeApp({ credential: cert(serviceAccount), projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id });
  }
  return { auth: getAuth(), db: getFirestore() };
}

function requiredString(value, label, minLength = 1, maxLength = 160) {
  if (typeof value !== "string" || value.trim().length < minLength || value.trim().length > maxLength) {
    fail("invalid-argument", `${label} inválido.`);
  }
  return value.trim();
}

function requiredMoney(value, label, allowZero = false) {
  try { return toCents(value, label, { allowZero }); }
  catch (error) {
    if (error instanceof CashValidationError) fail("invalid-argument", error.message);
    throw error;
  }
}

async function authorizeCashier(db, user, restaurantId) {
  const [restaurantSnapshot, staffSnapshot] = await Promise.all([
    db.collection("restaurants").doc(restaurantId).get(),
    db.collection("restaurantStaff").doc(user.uid).get(),
  ]);
  const restaurant = restaurantSnapshot.data();
  const paidUntil = restaurant?.monthlyPaidUntil;
  if (!restaurantSnapshot.exists || restaurant.status !== "active" || !paidUntil?.toMillis || paidUntil.toMillis() <= Date.now()) {
    fail("permission-denied", "O restaurante não está com o acesso liberado.", 403);
  }
  const staff = staffSnapshot.data();
  if (!staffSnapshot.exists || staff?.active !== true || staff.restaurantId !== restaurantId || staff.role !== "CASHIER") {
    fail("permission-denied", "Somente um funcionário Caixa ativo pode executar esta operação.", 403);
  }
  return { name: String(staff.name || user.name || user.email || "Caixa").slice(0, 100) };
}

function makeFingerprint(data) {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

async function openSession(data, db, user) {
  const restaurantId = requiredString(data?.restaurantId, "Restaurante", 1, 128);
  const operator = await authorizeCashier(db, user, restaurantId);
  const openingAmountCents = requiredMoney(data?.openingAmount, "Fundo de troco", true);
  const notes = typeof data?.notes === "string" ? data.notes.trim().slice(0, 500) : "";
  const registerRef = db.collection("cashRegisters").doc(restaurantId);
  const sessionRef = db.collection("cashSessions").doc();
  const auditRef = db.collection("cashAudit").doc();

  await db.runTransaction(async (transaction) => {
    const registerSnapshot = await transaction.get(registerRef);
    const activeSessionId = registerSnapshot.data()?.activeSessionId;
    if (activeSessionId) {
      const activeSessionRef = db.collection("cashSessions").doc(activeSessionId);
      const activeSession = await transaction.get(activeSessionRef);
      if (activeSession.exists && activeSession.data().status === "open") {
        fail("failed-precondition", "Já existe um caixa aberto para este restaurante.", 409);
      }
    }
    transaction.create(sessionRef, {
      restaurantId,
      status: "open",
      openingAmountCents,
      openingAmount: openingAmountCents / 100,
      openedBy: user.uid,
      operatorName: operator.name,
      notes,
      openedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(registerRef, {
      restaurantId,
      activeSessionId: sessionRef.id,
      openedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(auditRef, {
      restaurantId,
      sessionId: sessionRef.id,
      actorUid: user.uid,
      actorName: operator.name,
      action: "cash_opened",
      details: { openingAmountCents, notes },
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { sessionId: sessionRef.id, openingAmount: openingAmountCents / 100, operatorName: operator.name };
}

async function recordMovement(data, db, user) {
  const restaurantId = requiredString(data?.restaurantId, "Restaurante", 1, 128);
  const operator = await authorizeCashier(db, user, restaurantId);
  const type = String(data?.type || "").trim().toLowerCase();
  if (!["sangria", "suprimento", "despesa", "entrada", "saida"].includes(type)) fail("invalid-argument", "Tipo de movimentação inválido.");
  const amountCents = requiredMoney(data?.amount, "Valor");
  const reason = requiredString(data?.reason, "Motivo", 4, 250);
  const idempotencyKey = requiredString(data?.idempotencyKey, "Identificador da operação", 8, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) fail("invalid-argument", "Identificador da operação inválido.");
  const rawMethod = String(data?.paymentMethod || "cash").trim().toLowerCase();
  const paymentMethod = ({ dinheiro: "cash", cash: "cash", pix: "pix", cartao: "credit", credit: "credit", debit: "debit", transferencia: "other", other: "other" })[rawMethod];
  if (!paymentMethod) fail("invalid-argument", "Forma da movimentação inválida.");
  if (["sangria", "suprimento", "despesa"].includes(type) && paymentMethod !== "cash") fail("invalid-argument", "Sangria, suprimento e despesa devem ser em dinheiro.");
  const category = type === "entrada" || type === "saida" ? requiredString(data?.category, "Categoria", 1, 60) : type;
  const fingerprint = makeFingerprint({ restaurantId, type, amountCents, reason, paymentMethod, category });
  const registerRef = db.collection("cashRegisters").doc(restaurantId);
  const movementRef = db.collection("cashTransactions").doc(`cash_${restaurantId}_${idempotencyKey}`);
  const idempotencyRef = db.collection("cashIdempotency").doc(`${restaurantId}_${idempotencyKey}`);
  const auditRef = db.collection("cashAudit").doc();

  const result = await db.runTransaction(async (transaction) => {
    const [idempotencySnapshot, registerSnapshot] = await Promise.all([
      transaction.get(idempotencyRef),
      transaction.get(registerRef),
    ]);
    if (idempotencySnapshot.exists) {
      const previous = idempotencySnapshot.data();
      if (previous.fingerprint !== fingerprint) fail("invalid-argument", "Identificador já utilizado em outra movimentação.");
      return { movementId: previous.movementId, reused: true };
    }
    const sessionId = registerSnapshot.data()?.activeSessionId;
    if (!sessionId) fail("failed-precondition", "Abra o caixa antes de registrar movimentações.", 409);
    const sessionRef = db.collection("cashSessions").doc(sessionId);
    const sessionSnapshot = await transaction.get(sessionRef);
    if (!sessionSnapshot.exists || sessionSnapshot.data().restaurantId !== restaurantId || sessionSnapshot.data().status !== "open") {
      fail("failed-precondition", "Não há uma sessão de caixa aberta.", 409);
    }
    const direction = type === "suprimento" || type === "entrada" ? "entrada" : "saida";
    transaction.create(movementRef, {
      restaurantId,
      sessionId,
      type: direction,
      category,
      description: reason,
      reason,
      amountCents,
      amount: amountCents / 100,
      paymentMethod,
      createdBy: user.uid,
      operatorName: operator.name,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(idempotencyRef, { fingerprint, movementId: movementRef.id, createdAt: FieldValue.serverTimestamp() });
    transaction.create(auditRef, {
      restaurantId,
      sessionId,
      actorUid: user.uid,
      actorName: operator.name,
      action: type,
      amountCents,
      reason,
      referenceId: movementRef.id,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { movementId: movementRef.id, reused: false };
  });
  return result;
}

async function closeSession(data, db, user) {
  const restaurantId = requiredString(data?.restaurantId, "Restaurante", 1, 128);
  const operator = await authorizeCashier(db, user, restaurantId);
  const countedCashCents = requiredMoney(data?.countedCash, "Dinheiro contado", true);
  const notes = typeof data?.notes === "string" ? data.notes.trim().slice(0, 500) : "";
  const idempotencyKey = requiredString(data?.idempotencyKey, "Identificador do fechamento", 8, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) fail("invalid-argument", "Identificador do fechamento inválido.");
  const registerRef = db.collection("cashRegisters").doc(restaurantId);
  const closeRef = db.collection("cashClosures").doc(`${restaurantId}_${idempotencyKey}`);
  const auditRef = db.collection("cashAudit").doc();

  return db.runTransaction(async (transaction) => {
    const [closeSnapshot, registerSnapshot] = await Promise.all([
      transaction.get(closeRef),
      transaction.get(registerRef),
    ]);
    if (closeSnapshot.exists) return closeSnapshot.data().report;
    const sessionId = registerSnapshot.data()?.activeSessionId;
    if (!sessionId) fail("failed-precondition", "Não há caixa aberto para fechar.", 409);
    const sessionRef = db.collection("cashSessions").doc(sessionId);
    const [sessionSnapshot, paymentsSnapshot, transactionsSnapshot] = await Promise.all([
      transaction.get(sessionRef),
      transaction.get(db.collection("payments").where("cashSessionId", "==", sessionId)),
      transaction.get(db.collection("cashTransactions").where("sessionId", "==", sessionId)),
    ]);
    if (!sessionSnapshot.exists || sessionSnapshot.data().restaurantId !== restaurantId || sessionSnapshot.data().status !== "open") {
      fail("failed-precondition", "A sessão de caixa não está aberta.", 409);
    }
    const session = sessionSnapshot.data();
    const salesByMethodCents = {};
    let cashSalesCents = 0;
    for (const snapshot of paymentsSnapshot.docs) {
      const payment = snapshot.data();
      if (payment.restaurantId !== restaurantId || payment.status !== "completed") continue;
      const parts = Array.isArray(payment.paymentParts) ? payment.paymentParts : [];
      for (const part of parts) {
        const method = String(part.method || "other");
        const amountCents = Number.isInteger(part.amountCents) ? part.amountCents : 0;
        salesByMethodCents[method] = (salesByMethodCents[method] || 0) + amountCents;
        if (method === "cash") cashSalesCents += amountCents;
      }
    }
    let cashMovementsCents = 0;
    const movementTotals = { sangriaCents: 0, suprimentoCents: 0, expenseCents: 0 };
    for (const snapshot of transactionsSnapshot.docs) {
      const movement = snapshot.data();
      if (movement.restaurantId !== restaurantId) continue;
      const amountCents = Number.isInteger(movement.amountCents) ? movement.amountCents : Math.round(Number(movement.amount || 0) * 100);
      if (movement.paymentMethod !== "dinheiro" && movement.paymentMethod !== "cash") continue;
      if (movement.type === "estorno") {
        const delta = movement.reversesType === "entrada" ? -amountCents : amountCents;
        cashMovementsCents += delta;
        if (movement.category === "suprimento") movementTotals.suprimentoCents -= amountCents;
        if (movement.category === "sangria") movementTotals.sangriaCents -= amountCents;
        if (movement.category === "despesa") movementTotals.expenseCents -= amountCents;
      } else if (movement.category === "suprimento" || movement.type === "entrada") {
        cashMovementsCents += amountCents;
        if (movement.category === "suprimento") movementTotals.suprimentoCents += amountCents;
      } else if (movement.category === "sangria") {
        cashMovementsCents -= amountCents;
        movementTotals.sangriaCents += amountCents;
      } else if (movement.category === "despesa" || movement.type === "saida") {
        cashMovementsCents -= amountCents;
        movementTotals.expenseCents += amountCents;
      }
    }
    const openingAmountCents = Number(session.openingAmountCents) || 0;
    const expectedCashCents = openingAmountCents + cashSalesCents + cashMovementsCents;
    const differenceCents = countedCashCents - expectedCashCents;
    const report = {
      restaurantId,
      sessionId,
      closedBy: user.uid,
      operatorName: operator.name,
      closedAt: FieldValue.serverTimestamp(),
      openingAmountCents,
      salesByMethodCents,
      cashSalesCents,
      movementTotals,
      expectedCashCents,
      countedCashCents,
      differenceCents,
      overageCents: Math.max(0, differenceCents),
      shortageCents: Math.max(0, -differenceCents),
      notes,
    };
    transaction.update(sessionRef, { status: "closed", closedAt: FieldValue.serverTimestamp(), closeReport: report });
    transaction.update(registerRef, { activeSessionId: FieldValue.delete(), closedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    transaction.create(closeRef, { restaurantId, sessionId, report, createdAt: FieldValue.serverTimestamp() });
    transaction.create(auditRef, {
      restaurantId,
      sessionId,
      actorUid: user.uid,
      actorName: operator.name,
      action: "cash_closed",
      details: report,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ...report, closedAt: Date.now() };
  });
}

async function reverseMovement(data, db, user) {
  const restaurantId = requiredString(data?.restaurantId, "Restaurante", 1, 128);
  const operator = await authorizeCashier(db, user, restaurantId);
  const transactionId = requiredString(data?.transactionId, "Movimentação", 1, 180);
  const reason = requiredString(data?.reason, "Motivo do estorno", 4, 250);
  const registerRef = db.collection("cashRegisters").doc(restaurantId);
  const originalRef = db.collection("cashTransactions").doc(transactionId);
  const reversalRef = db.collection("cashTransactions").doc(`reversao_${restaurantId}_${transactionId}`);
  const auditRef = db.collection("cashAudit").doc();
  return db.runTransaction(async (transaction) => {
    const [registerSnapshot, originalSnapshot, reversalSnapshot] = await Promise.all([
      transaction.get(registerRef), transaction.get(originalRef), transaction.get(reversalRef),
    ]);
    if (reversalSnapshot.exists) return { reversalId: reversalRef.id, reused: true };
    const sessionId = registerSnapshot.data()?.activeSessionId;
    if (!sessionId) fail("failed-precondition", "Abra o caixa antes de registrar o estorno.", 409);
    const sessionRef = db.collection("cashSessions").doc(sessionId);
    const sessionSnapshot = await transaction.get(sessionRef);
    if (!sessionSnapshot.exists || sessionSnapshot.data().restaurantId !== restaurantId || sessionSnapshot.data().status !== "open") fail("failed-precondition", "Não há uma sessão de caixa aberta.", 409);
    if (!originalSnapshot.exists || originalSnapshot.data().restaurantId !== restaurantId || !["entrada", "saida"].includes(originalSnapshot.data().type)) fail("not-found", "Movimentação original não encontrada.", 404);
    const original = originalSnapshot.data();
    if (original.createdBy !== user.uid) fail("permission-denied", "Somente o operador que registrou a movimentação pode solicitar este estorno.", 403);
    const amountCents = Number.isInteger(original.amountCents) ? original.amountCents : Math.round(Number(original.amount || 0) * 100);
    transaction.create(reversalRef, {
      restaurantId,
      sessionId,
      type: "estorno",
      category: original.category || "estorno",
      description: reason,
      reason,
      amountCents,
      amount: amountCents / 100,
      paymentMethod: original.paymentMethod || "cash",
      reference: transactionId,
      reversesType: original.type,
      createdBy: user.uid,
      operatorName: operator.name,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(auditRef, {
      restaurantId,
      sessionId,
      actorUid: user.uid,
      actorName: operator.name,
      action: "cash_movement_reversed",
      amountCents,
      reason,
      referenceId: transactionId,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { reversalId: reversalRef.id, reused: false };
  });
}

const actions = { open: openSession, movement: recordMovement, reverse: reverseMovement, close: closeSession };

export default async function cashApi(action, request, response) {
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ error: { code: "method-not-allowed", message: "Método não permitido." } });
  const origin = request.headers.origin;
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173").split(",").map((value) => value.trim()).filter(Boolean);
  if (!isRequestOriginAllowed(request, origin, allowedOrigins)) return response.status(403).json({ error: { code: "permission-denied", message: "Origem não autorizada." } });
  if (origin) { response.setHeader("Access-Control-Allow-Origin", origin); response.setHeader("Vary", "Origin"); }
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Cache-Control", "no-store");

  try {
    const operation = actions[action];
    if (!operation) fail("not-found", "Operação não encontrada.", 404);
    const { db, auth } = getServices();
    const authorization = request.headers.authorization || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) fail("unauthenticated", "Entre na sua conta para continuar.", 401);
    let user;
    try { user = await auth.verifyIdToken(token); }
    catch { fail("unauthenticated", "Sua sessão expirou. Entre novamente.", 401); }
    const data = request.body && typeof request.body === "object" ? request.body : {};
    return response.status(200).json({ data: await operation(data, db, user) });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : "internal";
    const message = error instanceof ApiError ? error.message : "Não foi possível concluir a operação de caixa.";
    if (status === 500) console.error("Cash API error", error?.code || error?.message || "unknown");
    return response.status(status).json({ error: { code, message } });
  }
}

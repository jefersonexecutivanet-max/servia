import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import security from "./security.cjs";

const { isRequestOriginAllowed } = security;

class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function fail(code, message) {
  const statuses = {
    "invalid-argument": 400,
    unauthenticated: 401,
    "permission-denied": 403,
    "not-found": 404,
    "resource-exhausted": 429,
    internal: 500,
  };
  throw new ApiError(code, message, statuses[code] || 500);
}

function getServices() {
  if (getApps().length === 0) {
    const serialized = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serialized) throw new ApiError("configuration", "Credencial administrativa do Firebase não configurada no Vercel.", 500);
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(serialized);
    } catch {
      throw new ApiError("configuration", "FIREBASE_SERVICE_ACCOUNT_JSON não contém um JSON válido.", 500);
    }
    initializeApp({
      credential: cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
    });
  }
  return { auth: getAuth(), db: getFirestore() };
}

async function writeAudit(db, { action, result, restaurantId = "", customerUid = "", details = {} }) {
  await db.collection("orderAudit").add({
    action,
    result,
    restaurantId,
    customerUid,
    details,
    createdAt: FieldValue.serverTimestamp(),
  }).catch((error) => console.error("Order audit write failed", error?.code || "unknown"));
}

function requireString(value, label, maxLength = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    fail("invalid-argument", `${label} é obrigatório.`);
  }
  return value.trim();
}

function requireInt(value, label, min, max) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    fail("invalid-argument", `${label} inválido.`);
  }
  return num;
}

async function assertRestaurantActive(restaurantId, restaurantData) {
  const paidUntil = restaurantData.monthlyPaidUntil;
  if (restaurantData.status !== "active" || !paidUntil?.toMillis || paidUntil.toMillis() <= Date.now()) {
    fail("permission-denied", "O restaurante não está com o acesso liberado.");
  }
}

async function createOrder(data, db, user) {
  const restaurantId = requireString(data?.restaurantId, "Restaurante", 128);
  const tableId = requireString(data?.tableId, "Mesa", 128);
  const tableNumber = requireInt(data?.tableNumber, "Número da mesa", 1, 9999);
  const authenticatedUid = requireString(user?.uid, "Cliente", 128);
  if (data?.customerUid !== undefined && data.customerUid !== authenticatedUid) {
    fail("permission-denied", "A sessão do cliente não corresponde ao usuário autenticado.");
  }
  const accessToken = data?.accessToken ? requireString(data.accessToken, "Token de acesso", 128) : undefined;
  const waiterId = data?.waiterId ? requireString(data.waiterId, "Garçom", 128) : undefined;
  const items = data?.items;
  const idempotencyKey = requireString(data?.idempotencyKey, "Chave da operação", 128);
  if (!/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) {
    fail("invalid-argument", "Chave da operação inválida.");
  }
  const requestHash = createHash("sha256").update(JSON.stringify({
    restaurantId,
    tableId,
    tableNumber,
    waiterId: waiterId || "",
    accessToken: accessToken || "",
    items,
  })).digest("hex");

  if (!Array.isArray(items) || items.length === 0 || items.length > 10) {
    fail("invalid-argument", "Pedido deve ter entre 1 e 10 itens.");
  }

  const restaurantRef = db.collection("restaurants").doc(restaurantId);
  const restaurantSnapshot = await restaurantRef.get();
  if (!restaurantSnapshot.exists) {
    fail("not-found", "Restaurante não encontrado.");
  }
  const restaurantData = restaurantSnapshot.data();
  await assertRestaurantActive(restaurantId, restaurantData);

  const tableRef = db.collection("tables").doc(tableId);
  const tableSnapshot = await tableRef.get();
  if (!tableSnapshot.exists || tableSnapshot.data().restaurantId !== restaurantId || tableSnapshot.data().number !== tableNumber) {
    fail("not-found", "Mesa não encontrada neste restaurante.");
  }
  const tableData = tableSnapshot.data();
  if (tableData.accessToken && (!accessToken || accessToken !== tableData.accessToken)) {
    fail("permission-denied", "Token de acesso inválido para esta mesa.");
  }

  const idempotencyRef = db.collection("orderIdempotency").doc(idempotencyKey);
  const result = await db.runTransaction(async (transaction) => {
    const idempotencySnapshot = await transaction.get(idempotencyRef);
    if (idempotencySnapshot.exists) {
      const previous = idempotencySnapshot.data();
      if (previous?.customerUid !== authenticatedUid || previous?.restaurantId !== restaurantId || previous?.tableId !== tableId) {
        fail("permission-denied", "Chave de operação inválida.");
      }
      if (previous.requestHash && previous.requestHash !== requestHash) {
        fail("invalid-argument", "A chave da operação já foi usada com outro pedido.");
      }
      return { orderId: previous.orderId, total: Number(previous.total) || 0, reused: true };
    }

    const tableSnapshot = await transaction.get(tableRef);
    if (!tableSnapshot.exists || tableSnapshot.data().restaurantId !== restaurantId || tableSnapshot.data().number !== tableNumber) {
      fail("not-found", "Mesa não encontrada neste restaurante.");
    }
    const freshTableData = tableSnapshot.data();
    const assignmentSnapshot = await transaction.get(db.collection("waiterTables").doc(tableId));
    let resolvedWaiterId = waiterId;
    if (assignmentSnapshot.exists) {
      const assignment = assignmentSnapshot.data();
      if (assignment.restaurantId !== restaurantId || assignment.tableId !== tableId || !assignment.waiterId) {
        fail("permission-denied", "A atribuição de garçom desta mesa é inválida.");
      }
      if (waiterId && assignment.waiterId !== waiterId) {
        fail("permission-denied", "O garçom informado não está atribuído a esta mesa.");
      }
      resolvedWaiterId ||= assignment.waiterId;
    }
    if (resolvedWaiterId) {
      const waiterSnapshot = await transaction.get(db.collection("waiterDirectory").doc(resolvedWaiterId));
      if (!waiterSnapshot.exists || waiterSnapshot.data().restaurantId !== restaurantId || waiterSnapshot.data().active !== true) {
        fail("invalid-argument", "Garçom inválido para este restaurante.");
      }
    }
    if (freshTableData.accessToken && (!accessToken || accessToken !== freshTableData.accessToken)) {
      fail("permission-denied", "Token de acesso inválido para esta mesa.");
    }

    const lastOrderAt = freshTableData.lastOrderAt?.toMillis ? freshTableData.lastOrderAt.toMillis() : 0;
    const now = Date.now();
    if (lastOrderAt && now - lastOrderAt < 30000) {
      fail("resource-exhausted", "Aguarde 30 segundos antes de enviar novo pedido para esta mesa.");
    }

    const productSnapshots = [];
    for (const item of items) {
      const productId = requireString(item?.productId, "Produto", 128);
      productSnapshots.push({ item, productId, snapshot: await transaction.get(db.collection("menuItems").doc(`${restaurantId}_${productId}`)) });
    }

    const orderItems = [];
    let orderTotalCents = 0;
    for (const { item, productId, snapshot } of productSnapshots) {
      const quantity = requireInt(item?.quantity, "Quantidade", 1, 99);
      if (!snapshot.exists) fail("not-found", `Produto ${productId} não encontrado no cardápio deste restaurante.`);
      const productData = snapshot.data();
      if (productData.restaurantId !== restaurantId) fail("permission-denied", `Produto ${productId} não pertence a este restaurante.`);
      if (productData.available === false) fail("invalid-argument", `Produto ${productData.name} não está disponível.`);

      const productPriceCents = Math.round(Number(productData.price || 0) * 100);
      if (!Number.isFinite(productPriceCents) || productPriceCents < 0) fail("invalid-argument", `Preço inválido para ${productData.name}.`);
      let extraPriceCents = 0;
      const extraNames = [];
      const requestedExtras = Array.isArray(item.extras) ? item.extras : [];
      if (requestedExtras.length > 10 || requestedExtras.some((id) => typeof id !== "string") || new Set(requestedExtras).size !== requestedExtras.length) {
        fail("invalid-argument", "Quantidade de adicionais inválida.");
      }
      for (const extraId of requestedExtras) {
        const extra = (productData.extras || []).find((entry) => entry.id === extraId);
        if (!extra) fail("not-found", `Adicional ${extraId} não encontrado para o produto ${productData.name}.`);
        const extraCents = Math.round(Number(extra.price || 0) * 100);
        if (!Number.isFinite(extraCents) || extraCents < 0) fail("invalid-argument", `Preço inválido para o adicional ${extra.name}.`);
        extraPriceCents += extraCents;
        extraNames.push(extra.name);
      }
      const unitCents = productPriceCents + extraPriceCents;
      orderTotalCents += unitCents * quantity;
      orderItems.push({
        productId,
        name: productData.name,
        quantity,
        price: unitCents / 100,
        extras: extraNames,
        notes: typeof item.notes === "string" ? item.notes.trim().slice(0, 500) : "",
      });
    }

    if (orderTotalCents <= 0) fail("invalid-argument", "O total do pedido deve ser maior que zero.");
    const orderRef = db.collection("orders").doc();
    const total = orderTotalCents / 100;
    transaction.create(orderRef, {
      restaurantId,
      tableId,
      tableNumber,
      ...(resolvedWaiterId ? { waiterId: resolvedWaiterId } : {}),
      customerUid: authenticatedUid,
      ...(accessToken ? { accessToken } : {}),
      status: "novo",
      source: "qrcode",
      items: orderItems,
      total,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(tableRef, { lastOrderAt: Timestamp.fromMillis(now) });
    transaction.create(idempotencyRef, { orderId: orderRef.id, total, customerUid: authenticatedUid, restaurantId, tableId, requestHash, createdAt: FieldValue.serverTimestamp() });
    return { orderId: orderRef.id, total, reused: false };
  });

  if (result.reused) return result;

  await writeAudit(db, {
    action: "order_created",
    result: "success",
    restaurantId,
    customerUid: authenticatedUid,
    details: { orderId: result.orderId, tableNumber, itemCount: items.length, total: result.total },
  });

  return { orderId: result.orderId, total: result.total };
}

async function getTableOrders(data, db) {
  const restaurantId = requireString(data?.restaurantId, "Restaurante", 128);
  const tableId = requireString(data?.tableId, "Mesa", 128);
  const tableNumber = requireInt(data?.tableNumber, "Número da mesa", 1, 9999);
  const accessToken = data?.accessToken ? requireString(data.accessToken, "Token de acesso", 128) : "";

  const restaurantSnapshot = await db.collection("restaurants").doc(restaurantId).get();
  if (!restaurantSnapshot.exists) fail("not-found", "Restaurante não encontrado.");
  await assertRestaurantActive(restaurantId, restaurantSnapshot.data());

  const tableSnapshot = await db.collection("tables").doc(tableId).get();
  if (!tableSnapshot.exists || tableSnapshot.data().restaurantId !== restaurantId || tableSnapshot.data().number !== tableNumber) {
    fail("not-found", "Mesa não encontrada neste restaurante.");
  }
  const tableData = tableSnapshot.data();
  if (!tableData.accessToken || !accessToken || accessToken !== tableData.accessToken) {
    fail("permission-denied", "Token de acesso inválido para esta mesa.");
  }

  const ordersSnapshot = await db.collection("orders")
    .where("restaurantId", "==", restaurantId)
    .where("tableId", "==", tableId)
    .get();
  return ordersSnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    .filter((order) => order.status !== "cancelado" && order.paymentStatus !== "paid")
    .map((order) => ({
      id: order.id,
      status: String(order.status || "novo"),
      paymentStatus: String(order.paymentStatus || "unpaid"),
      createdAt: order.createdAt?.toMillis?.() || 0,
      items: Array.isArray(order.items) ? order.items.map((item) => ({
        productId: String(item.productId || ""),
        name: String(item.name || "Produto"),
        quantity: Number(item.quantity || 0),
        price: Number(item.price || 0),
        extras: Array.isArray(item.extras) ? item.extras.map(String) : [],
        notes: String(item.notes || ""),
      })) : [],
    }))
    .filter((order) => order.items.length > 0)
    .sort((first, second) => second.createdAt - first.createdAt)
    .slice(0, 100)
    .map(({ createdAt, ...order }) => ({ ...order, createdAt }));
}

const actions = { createOrder, getTableOrders };

export default async function orderApi(action, request, response) {
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ error: { code: "method-not-allowed", message: "Método não permitido." } });

  const origin = request.headers.origin;
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173").split(",").map((o) => o.trim());
  if (!isRequestOriginAllowed(request, origin, allowedOrigins)) {
    return response.status(403).json({ error: { code: "permission-denied", message: "Origem não autorizada." } });
  }
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Cache-Control", "no-store");

  try {
    const { db, auth } = getServices();
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) fail("unauthenticated", "Entre na sua conta para continuar.");
    let user;
    try {
      user = await auth.verifyIdToken(token);
    } catch {
      fail("unauthenticated", "Sua sessão expirou. Entre novamente.");
    }
    const payload = request.body && typeof request.body === "object" ? request.body : {};
    const result = await actions[action](payload, db, user);
    return response.status(200).json({ data: result });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : "internal";
    const message = error instanceof ApiError ? error.message : "Não foi possível concluir a operação.";
    if (status === 500) console.error("Order API error", error?.code || error?.message || "unknown");
    return response.status(status).json({ error: { code, message } });
  }
}

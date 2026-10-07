import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
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
  const statuses = { "invalid-argument": 400, unauthenticated: 401, "permission-denied": 403, "not-found": 404, "resource-exhausted": 429, internal: 500 };
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

function requireMethod(value) {
  const method = requireString(value, "Forma de pagamento", 20).toLowerCase();
  if (!["pix", "card", "cash"].includes(method)) fail("invalid-argument", "Forma de pagamento inválida.");
  return method;
}

async function assertCanCloseRestaurant(db, user, restaurantId) {
  const restaurantSnapshot = await db.collection("restaurants").doc(restaurantId).get();
  if (!restaurantSnapshot.exists) fail("not-found", "Restaurante não encontrado.");
  const restaurant = restaurantSnapshot.data();
  const paidUntil = restaurant.monthlyPaidUntil;
  if (restaurant.status !== "active" || !paidUntil?.toMillis || paidUntil.toMillis() <= Date.now()) fail("permission-denied", "O restaurante não está com o acesso liberado.");

  if (user.uid === restaurantId && String(user.email || "").toLowerCase() === String(restaurant.ownerEmail || "").toLowerCase()) return;
  const staff = await db.collection("restaurantStaff").doc(user.uid).get();
  const data = staff.data();
  if (staff.exists && data?.active === true && data.restaurantId === restaurantId && ["MANAGER", "CASHIER"].includes(data.role)) return;
  fail("permission-denied", "Você não tem permissão para fechar esta mesa.");
}

function cents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) fail("invalid-argument", "Valor monetário inválido.");
  return Math.round(n * 100);
}

async function closeTable(data, db, user) {
  const restaurantId = requireString(data?.restaurantId, "Restaurante");
  const tableNumber = Number(data?.tableNumber);
  if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 9999) fail("invalid-argument", "Número da mesa inválido.");
  const paymentMethod = requireMethod(data?.paymentMethod);
  await assertCanCloseRestaurant(db, user, restaurantId);

  const tableId = `${restaurantId}_${tableNumber}`;
  const tableRef = db.collection("tables").doc(tableId);
  const assignmentRef = db.collection("waiterTables").doc(tableId);
  const result = await db.runTransaction(async (transaction) => {
    const [tableSnapshot, assignmentSnapshot, orderSnapshot, restaurantSnapshot] = await Promise.all([
      transaction.get(tableRef),
      transaction.get(assignmentRef),
      transaction.get(db.collection("orders").where("restaurantId", "==", restaurantId).where("tableNumber", "==", tableNumber)),
      transaction.get(db.collection("restaurants").doc(restaurantId)),
    ]);
    if (!tableSnapshot.exists || tableSnapshot.data().restaurantId !== restaurantId || tableSnapshot.data().number !== tableNumber) fail("not-found", "Mesa não encontrada neste restaurante.");
    const activeOrders = orderSnapshot.docs.filter((snapshot) => {
      const value = snapshot.data();
      return value.status !== "cancelado" && value.paymentStatus !== "paid";
    });
    if (activeOrders.length === 0) fail("invalid-argument", "Não há pedidos em aberto para esta mesa.");

    let subtotalCents = 0;
    let itemCount = 0;
    const items = [];
    for (const snapshot of activeOrders) {
      const value = snapshot.data();
      if (!Array.isArray(value.items)) fail("invalid-argument", "Pedido inválido encontrado na mesa.");
      for (const item of value.items) {
        const quantity = Number(item.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) fail("invalid-argument", "Quantidade inválida no pedido.");
        const unitCents = cents(item.price);
        subtotalCents += unitCents * quantity;
        itemCount += quantity;
        items.push({ name: String(item.name || "Produto"), quantity, price: unitCents / 100 });
      }
    }
    if (subtotalCents <= 0) fail("invalid-argument", "O total da mesa deve ser maior que zero.");

    const restaurant = restaurantSnapshot.data();
    const configuredFee = Number(restaurant.payment?.serviceFee ?? 10);
    const serviceFeePercent = Number.isFinite(configuredFee) ? Math.min(100, Math.max(0, configuredFee)) : 10;
    const amountCents = Math.round(subtotalCents * (1 + serviceFeePercent / 100));
    const paymentRef = db.collection("payments").doc();
    transaction.create(paymentRef, {
      restaurantId,
      tableId,
      tableNumber,
      method: paymentMethod,
      amount: amountCents / 100,
      items: itemCount,
      status: "completed",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: user.uid,
      serviceFeePercent,
    });
    for (const snapshot of activeOrders) transaction.update(snapshot.ref, { paymentStatus: "paid", paymentId: paymentRef.id, paidAt: FieldValue.serverTimestamp() });
    transaction.update(tableRef, { status: "livre", guests: 0, total: 0, customer: FieldValue.delete() });
    if (assignmentSnapshot.exists) transaction.delete(assignmentRef);

    return {
      paymentId: paymentRef.id,
      items,
      amount: amountCents / 100,
      subtotal: subtotalCents / 100,
      waiterName: String(assignmentSnapshot.data()?.waiterName || "Nao informado"),
      serviceFee: amountCents / 100 - subtotalCents / 100,
      orderIds: activeOrders.map((snapshot) => snapshot.id),
    };
  });
  return result;
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
    if (action !== "close") fail("not-found", "Operação não encontrada.");
    const result = await closeTable(payload, db, user);
    return response.status(200).json({ data: result });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : "internal";
    const message = error instanceof ApiError ? error.message : "Não foi possível concluir o fechamento da mesa.";
    if (status === 500) console.error("Payment API error", error?.code || error?.message || "unknown");
    return response.status(status).json({ error: { code, message } });
  }
}

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import security from "./security.cjs";

const {
  employeeCodeFromWaiterId,
  hashPin,
  hashRateLimitKey,
  isStaffRole,
  isValidEmployeeCode,
  normalizeEmployeeCode,
  validatePin,
  verifyPin,
} = security;

const SYSTEM_OWNER_UID = "KVoJiEGKnnceyADEqFhcflynohr2";
const SYSTEM_OWNER_EMAIL = "finho60@hotmail.com";
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_IP_ATTEMPTS = 25;

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

function getRequestIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  return String(request.headers["x-real-ip"] || (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0] || "unknown").trim().slice(0, 64);
}

function rateLimitRef(db, scope, key) {
  return db.collection("employeeLoginLimits").doc(hashRateLimitKey(scope, key));
}

async function assertNotRateLimited(db, refs, now) {
  await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    if (snapshots.some((snapshot) => snapshot.data()?.lockedUntilMs > now)) {
      fail("resource-exhausted", "Muitas tentativas. Aguarde 15 minutos e tente novamente.");
    }
  });
}

async function recordFailedAttempt(db, limits, now) {
  await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(limits.map(({ ref }) => transaction.get(ref)));
    snapshots.forEach((snapshot, index) => {
      const { ref, maximum } = limits[index];
      const data = snapshot.data() || {};
      const currentWindow = Number(data.windowStartedAtMs || 0);
      const inWindow = currentWindow > 0 && now - currentWindow < RATE_WINDOW_MS;
      const count = inWindow ? Number(data.count || 0) + 1 : 1;
      transaction.set(ref, {
        count,
        windowStartedAtMs: inWindow ? currentWindow : now,
        lockedUntilMs: count >= maximum ? now + RATE_WINDOW_MS : 0,
        expireAt: Timestamp.fromMillis(now + RATE_RETENTION_MS),
      });
    });
  });
}

async function clearRateLimit(ref) {
  await ref.delete().catch(() => undefined);
}

async function writeAudit(db, { action, result, restaurantId = "", employeeId = "", actorUid = "", identityHash = "" }) {
  await db.collection("employeeAudit").add({
    action,
    result,
    restaurantId,
    employeeId,
    actorUid,
    identityHash,
    createdAt: FieldValue.serverTimestamp(),
  }).catch((error) => console.error("Employee audit write failed", error?.code || "unknown"));
}

async function requireUser(request, auth) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) fail("unauthenticated", "Entre na sua conta para continuar.");
  try {
    return await auth.verifyIdToken(token);
  } catch {
    fail("unauthenticated", "Sua sessão expirou. Entre novamente.");
  }
}

function isSystemOwner(user) {
  return user.uid === SYSTEM_OWNER_UID && String(user.email || "").toLowerCase() === SYSTEM_OWNER_EMAIL;
}

function requireString(value, label, maxLength = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    fail("invalid-argument", `${label} é obrigatório.`);
  }
  return value.trim();
}

function requirePin(value) {
  const error = validatePin(value);
  if (error) fail("invalid-argument", error);
  return value;
}

function employeePublicData(waiterId, data) {
  return {
    id: waiterId,
    employeeId: waiterId,
    employeeCode: data.employeeCode || employeeCodeFromWaiterId(waiterId),
    name: data.name,
    role: data.role,
    restaurantId: data.restaurantId,
    active: data.active === true,
    pinEnabled: data.pinEnabled === true,
  };
}

async function assertRestaurantActive(restaurantId, restaurantData) {
  const paidUntil = restaurantData.monthlyPaidUntil;
  if (restaurantData.status !== "active" || !paidUntil?.toMillis || paidUntil.toMillis() <= Date.now()) {
    fail("permission-denied", "O restaurante não está com o acesso liberado.");
  }
}

async function assertCanManageRestaurant(user, restaurantId, db) {
  const restaurantRef = db.collection("restaurants").doc(restaurantId);
  const restaurantSnapshot = await restaurantRef.get();
  if (!restaurantSnapshot.exists) fail("not-found", "Restaurante não encontrado.");
  const restaurantData = restaurantSnapshot.data();
  if (isSystemOwner(user)) return { actor: user, restaurantRef, restaurantData };

  await assertRestaurantActive(restaurantId, restaurantData);
  if (user.uid === restaurantId && user.email === restaurantData.ownerEmail) {
    return { actor: user, restaurantRef, restaurantData };
  }

  const staffSnapshot = await db.collection("restaurantStaff").doc(user.uid).get();
  const staffData = staffSnapshot.data();
  if (staffSnapshot.exists && staffData.active === true && staffData.role === "MANAGER" && staffData.restaurantId === restaurantId) {
    return { actor: user, restaurantRef, restaurantData };
  }
  fail("permission-denied", "Somente o proprietário ou gerente do restaurante pode gerenciar funcionários.");
}

async function createEmployee(data, request, db, auth, user) {
  const name = requireString(data?.name, "Nome", 100);
  const restaurantId = requireString(data?.restaurantId, "Restaurante", 128);
  const role = data?.role;
  if (!isStaffRole(role)) fail("invalid-argument", "Função inválida.");
  const pinHash = await hashPin(requirePin(data?.pin));
  const { actor } = await assertCanManageRestaurant(user, restaurantId, db);
  const waiterRef = db.collection("waiters").doc();
  const uid = `staff_${waiterRef.id}`;
  const employeeCode = employeeCodeFromWaiterId(waiterRef.id);
  let authUserCreated = false;

  try {
    await auth.createUser({ uid, displayName: name, disabled: false });
    authUserCreated = true;
    const waiterData = {
      name, role, employeeNumber: employeeCode, employeeCode, restaurantId,
      email: "", uid, pinEnabled: true, mustChangePassword: false, active: true,
      createdAt: FieldValue.serverTimestamp(),
    };
    const batch = db.batch();
    batch.create(db.collection("employeeCodes").doc(employeeCode), { employeeId: waiterRef.id, restaurantId, active: true });
    batch.create(waiterRef, waiterData);
    batch.create(db.collection("employeeSecrets").doc(waiterRef.id), { pinHash, updatedAt: FieldValue.serverTimestamp() });
    batch.create(db.collection("waiterDirectory").doc(waiterRef.id), { restaurantId, name, role, active: true });
    batch.create(db.collection("waiterDirectory").doc(restaurantId).collection("staff").doc(waiterRef.id), { restaurantId, name, role, active: true });
    batch.create(db.collection("restaurantStaff").doc(uid), { restaurantId, waiterId: waiterRef.id, role, active: true });
    await batch.commit();
    await writeAudit(db, { action: "employee_created", result: "success", restaurantId, employeeId: waiterRef.id, actorUid: actor.uid });
    return employeePublicData(waiterRef.id, waiterData);
  } catch (error) {
    if (authUserCreated) await auth.deleteUser(uid).catch(() => undefined);
    throw error;
  }
}

async function updateEmployee(data, request, db, auth, user) {
  const restaurantId = requireString(data?.restaurantId, "Restaurante", 128);
  const employeeId = requireString(data?.employeeId, "Funcionário", 128);
  const { actor } = await assertCanManageRestaurant(user, restaurantId, db);
  const waiterRef = db.collection("waiters").doc(employeeId);
  const waiterSnapshot = await waiterRef.get();
  if (!waiterSnapshot.exists || waiterSnapshot.data().restaurantId !== restaurantId) fail("not-found", "Funcionário não encontrado neste restaurante.");
  const current = waiterSnapshot.data();
  const name = data?.name === undefined ? current.name : requireString(data.name, "Nome", 100);
  const role = data?.role === undefined ? current.role : data.role;
  if (!isStaffRole(role)) fail("invalid-argument", "Função inválida.");
  const active = data?.active === undefined ? current.active === true : data.active === true;
  const employeeCode = current.employeeCode || employeeCodeFromWaiterId(employeeId);
  const update = { name, role, active, employeeCode, employeeNumber: employeeCode, pinEnabled: current.pinEnabled === true, updatedAt: FieldValue.serverTimestamp() };
  let replacementPinHash;
  if (data?.pin !== undefined && data.pin !== "") {
    replacementPinHash = await hashPin(requirePin(data.pin));
    update.pinEnabled = true;
  }

  const batch = db.batch();
  batch.update(waiterRef, update);
  batch.set(db.collection("waiterDirectory").doc(employeeId), { restaurantId, name, role, active }, { merge: true });
  batch.set(db.collection("waiterDirectory").doc(restaurantId).collection("staff").doc(employeeId), { restaurantId, name, role, active }, { merge: true });
  batch.set(db.collection("restaurantStaff").doc(current.uid), { restaurantId, waiterId: employeeId, role, active }, { merge: true });
  if (replacementPinHash) batch.set(db.collection("employeeSecrets").doc(employeeId), { pinHash: replacementPinHash, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.set(db.collection("employeeCodes").doc(employeeCode), { employeeId, restaurantId, active }, { merge: true });
  await batch.commit();

  await auth.updateUser(current.uid, { displayName: name, disabled: !active }).catch((error) => console.error("Employee Auth sync failed", error?.code || "unknown"));
  if (!active) await auth.revokeRefreshTokens(current.uid).catch(() => undefined);
  await writeAudit(db, { action: data?.pin ? "employee_pin_changed" : active ? "employee_updated" : "employee_deactivated", result: "success", restaurantId, employeeId, actorUid: actor.uid });
  return employeePublicData(employeeId, { ...current, ...update });
}

async function deleteEmployee(data, request, db, auth, user) {
  const restaurantId = requireString(data?.restaurantId, "Restaurante", 128);
  const employeeId = requireString(data?.employeeId, "Funcionário", 128);
  const { actor } = await assertCanManageRestaurant(user, restaurantId, db);
  const waiterRef = db.collection("waiters").doc(employeeId);
  const snapshot = await waiterRef.get();
  if (!snapshot.exists || snapshot.data().restaurantId !== restaurantId) fail("not-found", "Funcionário não encontrado neste restaurante.");
  const employee = snapshot.data();
  const batch = db.batch();
  batch.delete(waiterRef);
  batch.delete(db.collection("employeeSecrets").doc(employeeId));
  if (employee.employeeCode) batch.delete(db.collection("employeeCodes").doc(employee.employeeCode));
  batch.delete(db.collection("waiterDirectory").doc(employeeId));
  batch.delete(db.collection("waiterDirectory").doc(restaurantId).collection("staff").doc(employeeId));
  batch.delete(db.collection("restaurantStaff").doc(employee.uid));
  await batch.commit();
  await auth.revokeRefreshTokens(employee.uid).catch(() => undefined);
  await auth.deleteUser(employee.uid).catch((error) => { if (error?.code !== "auth/user-not-found") console.error("Employee Auth delete failed", error?.code || "unknown"); });
  await writeAudit(db, { action: "employee_deleted", result: "success", restaurantId, employeeId, actorUid: actor.uid });
  return { employeeId };
}

async function resolveEmployeeForLogin(data, db) {
  const requestedWaiterId = typeof data?.waiterId === "string" ? data.waiterId.trim() : "";
  if (requestedWaiterId) {
    const restaurantId = requireString(data?.restaurantId, "Restaurante", 128);
    const snapshot = await db.collection("waiters").doc(requestedWaiterId).get();
    if (!snapshot.exists || snapshot.data().restaurantId !== restaurantId) return null;
    return { id: snapshot.id, data: snapshot.data() };
  }
  const employeeCode = normalizeEmployeeCode(data?.employeeCode);
  if (!isValidEmployeeCode(employeeCode)) return null;
  const codeSnapshot = await db.collection("employeeCodes").doc(employeeCode).get();
  if (!codeSnapshot.exists || codeSnapshot.data().active !== true) return null;
  const snapshot = await db.collection("waiters").doc(codeSnapshot.data().employeeId).get();
  return snapshot.exists ? { id: snapshot.id, data: snapshot.data() } : null;
}

async function loginEmployee(data, request, db, auth) {
  const now = Date.now();
  const rawCode = typeof data?.employeeCode === "string" ? normalizeEmployeeCode(data.employeeCode) : "";
  const rawWaiterId = typeof data?.waiterId === "string" ? data.waiterId.trim() : "";
  const identity = rawWaiterId ? `qr:${data?.restaurantId}:${rawWaiterId}` : rawCode || `invalid:${hashRateLimitKey("invalid-code", String(data?.employeeCode || "").slice(0, 64))}`;
  const ipRef = rateLimitRef(db, "ip", getRequestIp(request));
  const identityRef = rateLimitRef(db, "identity", identity);
  await assertNotRateLimited(db, [ipRef, identityRef], now);

  const employee = await resolveEmployeeForLogin(data, db);
  if (!employee || employee.data.active !== true || !employee.data.uid) {
    await recordFailedAttempt(db, [{ ref: ipRef, maximum: MAX_IP_ATTEMPTS }, { ref: identityRef, maximum: MAX_CODE_ATTEMPTS }], now);
    await writeAudit(db, { action: "employee_login", result: "rejected", identityHash: hashRateLimitKey("audit", identity) });
    fail("unauthenticated", "Identificação ou PIN incorretos.");
  }

  const employeeData = employee.data;
  const [restaurantSnapshot, secretSnapshot] = await Promise.all([
    db.collection("restaurants").doc(employeeData.restaurantId).get(),
    db.collection("employeeSecrets").doc(employee.id).get(),
  ]);
  const pinValid = await verifyPin(data?.pin, secretSnapshot.data()?.pinHash);
  if (!pinValid || !restaurantSnapshot.exists) {
    await recordFailedAttempt(db, [{ ref: ipRef, maximum: MAX_IP_ATTEMPTS }, { ref: identityRef, maximum: MAX_CODE_ATTEMPTS }], now);
    await writeAudit(db, { action: "employee_login", result: "rejected", restaurantId: employeeData.restaurantId, employeeId: employee.id, identityHash: hashRateLimitKey("audit", identity) });
    fail("unauthenticated", "Identificação ou PIN incorretos.");
  }
  await assertRestaurantActive(employeeData.restaurantId, restaurantSnapshot.data());
  await clearRateLimit(identityRef);
  const token = await auth.createCustomToken(employeeData.uid, {
    employee: true,
    employeeId: employee.id,
    restaurantId: employeeData.restaurantId,
    role: employeeData.role,
  });
  await writeAudit(db, { action: "employee_login", result: "success", restaurantId: employeeData.restaurantId, employeeId: employee.id, actorUid: employeeData.uid });
  return { token, employee: employeePublicData(employee.id, employeeData) };
}

async function changeOwnEmployeePin(data, request, db, auth, user) {
  const employeeId = user.employeeId;
  const restaurantId = user.restaurantId;
  if (user.employee !== true || typeof employeeId !== "string" || typeof restaurantId !== "string") fail("permission-denied", "Esta sessão não pertence a um funcionário.");
  const newPin = requirePin(data?.newPin);
  const ipRef = rateLimitRef(db, "pin-change-ip", getRequestIp(request));
  const employeeRef = rateLimitRef(db, "pin-change-employee", user.uid);
  await assertNotRateLimited(db, [ipRef, employeeRef], Date.now());
  const [waiterSnapshot, secretSnapshot] = await Promise.all([
    db.collection("waiters").doc(employeeId).get(),
    db.collection("employeeSecrets").doc(employeeId).get(),
  ]);
  const validOldPin = await verifyPin(data?.oldPin, secretSnapshot.data()?.pinHash);
  if (!waiterSnapshot.exists || waiterSnapshot.data().uid !== user.uid || waiterSnapshot.data().active !== true || !validOldPin) {
    await recordFailedAttempt(db, [{ ref: ipRef, maximum: MAX_IP_ATTEMPTS }, { ref: employeeRef, maximum: MAX_CODE_ATTEMPTS }], Date.now());
    await writeAudit(db, { action: "employee_pin_change", result: "rejected", restaurantId, employeeId, actorUid: user.uid });
    fail("unauthenticated", "PIN atual incorreto.");
  }
  await db.collection("employeeSecrets").doc(employeeId).update({ pinHash: await hashPin(newPin), updatedAt: FieldValue.serverTimestamp() });
  await clearRateLimit(employeeRef);
  await writeAudit(db, { action: "employee_pin_changed", result: "success", restaurantId, employeeId, actorUid: user.uid });
  return { success: true };
}

const actions = { createEmployee, updateEmployee, deleteEmployee, loginEmployee, changeOwnEmployeePin };

export default async function employeeApi(action, request, response) {
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ error: { code: "method-not-allowed", message: "Método não permitido." } });

  const origin = request.headers.origin;
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173").split(",").map((o) => o.trim());
  if (origin && !allowedOrigins.includes(origin)) {
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
    const { auth, db } = getServices();
    const user = action === "loginEmployee" ? null : await requireUser(request, auth);
    const data = request.body && typeof request.body === "object" ? request.body : {};
    const result = await actions[action](data, request, db, auth, user);
    return response.status(200).json({ data: result });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : "internal";
    const message = error instanceof ApiError ? error.message : "Não foi possível concluir a operação.";
    if (status === 500) console.error("Employee API error", error?.code || error?.message || "unknown");
    return response.status(status).json({ error: { code, message } });
  }
}

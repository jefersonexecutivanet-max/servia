const { getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const {
  employeeCodeFromWaiterId,
  hashPin,
  hashRateLimitKey,
  isStaffRole,
  isValidEmployeeCode,
  normalizeEmployeeCode,
  validatePin,
  verifyPin,
} = require("./security.cjs");

if (getApps().length === 0) initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10, concurrency: 5, memory: "512MiB" });

const db = getFirestore();
const auth = getAuth();
const SYSTEM_OWNER_UID = "KVoJiEGKnnceyADEqFhcflynohr2";
const SYSTEM_OWNER_EMAIL = "finho60@hotmail.com";
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_IP_ATTEMPTS = 25;
function isSystemOwner(request) {
  return request.auth?.uid === SYSTEM_OWNER_UID
    && String(request.auth.token.email || "").toLowerCase() === SYSTEM_OWNER_EMAIL;
}

function fail(code, message) {
  throw new HttpsError(code, message);
}

function getRequestIp(request) {
  return String(request.rawRequest?.ip || "unknown").slice(0, 64);
}

function rateLimitRef(scope, key) {
  return db.collection("employeeLoginLimits").doc(hashRateLimitKey(scope, key));
}

async function assertNotRateLimited(refs, now) {
  await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    for (const snapshot of snapshots) {
      const data = snapshot.data();
      if (data?.lockedUntilMs > now) {
        fail("resource-exhausted", "Muitas tentativas. Aguarde 15 minutos e tente novamente.");
      }
    }
  });
}

async function recordFailedAttempt(limits, now) {
  await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(limits.map(({ ref }) => transaction.get(ref)));
    snapshots.forEach((snapshot, index) => {
      const { ref, maximum } = limits[index];
      const data = snapshot.data() || {};
      const currentWindow = Number(data.windowStartedAtMs || 0);
      const inWindow = currentWindow > 0 && now - currentWindow < RATE_WINDOW_MS;
      const count = inWindow ? Number(data.count || 0) + 1 : 1;
      const windowStartedAtMs = inWindow ? currentWindow : now;
      transaction.set(ref, {
        count,
        windowStartedAtMs,
        lockedUntilMs: count >= maximum ? now + RATE_WINDOW_MS : 0,
        expireAt: Timestamp.fromMillis(now + RATE_RETENTION_MS),
      });
    });
  });
}

async function clearRateLimit(ref) {
  await ref.delete().catch(() => undefined);
}

async function writeAudit({ action, result, restaurantId = "", employeeId = "", actorUid = "", identityHash = "" }) {
  await db.collection("employeeAudit").add({
    action,
    result,
    restaurantId,
    employeeId,
    actorUid,
    identityHash,
    createdAt: FieldValue.serverTimestamp(),
  }).catch((error) => {
    console.error("Unable to write employee audit event", error?.code || "unknown");
  });
}

function requireSignedIn(request) {
  if (!request.auth) fail("unauthenticated", "Entre no sistema para continuar.");
  return request.auth;
}

async function assertRestaurantActive(restaurantId, restaurantData) {
  const paidUntil = restaurantData.monthlyPaidUntil;
  if (
    restaurantData.status !== "active"
    || !paidUntil
    || typeof paidUntil.toMillis !== "function"
    || paidUntil.toMillis() <= Date.now()
  ) {
    fail("permission-denied", "O restaurante não está com o acesso liberado.");
  }
}

async function assertCanManageRestaurant(request, restaurantId) {
  const actor = requireSignedIn(request);
  const restaurantRef = db.collection("restaurants").doc(restaurantId);
  const restaurantSnapshot = await restaurantRef.get();
  if (!restaurantSnapshot.exists) fail("not-found", "Restaurante não encontrado.");
  const restaurantData = restaurantSnapshot.data();

  if (isSystemOwner(request)) return { actor, restaurantRef, restaurantData };

  await assertRestaurantActive(restaurantId, restaurantData);
  if (actor.uid === restaurantId && actor.token.email === restaurantData.ownerEmail) {
    return { actor, restaurantRef, restaurantData };
  }

  const staffSnapshot = await db.collection("restaurantStaff").doc(actor.uid).get();
  const staffData = staffSnapshot.data();
  if (
    staffSnapshot.exists
    && staffData.active === true
    && staffData.role === "MANAGER"
    && staffData.restaurantId === restaurantId
  ) {
    return { actor, restaurantRef, restaurantData };
  }
  fail("permission-denied", "Somente o proprietário ou gerente do restaurante pode gerenciar funcionários.");
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

async function reserveEmployeeCode(transaction, waiterRef, restaurantId, role, name, uid, pinHash) {
  const employeeCode = employeeCodeFromWaiterId(waiterRef.id);
  const codeRef = db.collection("employeeCodes").doc(employeeCode);
  const secretRef = db.collection("employeeSecrets").doc(waiterRef.id);
  const directoryRef = db.collection("waiterDirectory").doc(waiterRef.id);
  const publicDirectoryRef = db.collection("waiterDirectory").doc(restaurantId).collection("staff").doc(waiterRef.id);
  const staffRef = db.collection("restaurantStaff").doc(uid);
  const waiterData = {
    name,
    role,
    employeeNumber: employeeCode,
    employeeCode,
    restaurantId,
    email: "",
    uid,
    pinEnabled: true,
    mustChangePassword: false,
    active: true,
    createdAt: FieldValue.serverTimestamp(),
  };
  transaction.create(codeRef, { employeeId: waiterRef.id, restaurantId, active: true });
  transaction.create(waiterRef, waiterData);
  transaction.create(secretRef, { pinHash, updatedAt: FieldValue.serverTimestamp() });
  transaction.create(directoryRef, { restaurantId, name, role, active: true });
  transaction.create(publicDirectoryRef, { restaurantId, name, role, active: true });
  transaction.create(staffRef, { restaurantId, waiterId: waiterRef.id, role, active: true });
  return employeePublicData(waiterRef.id, waiterData);
}

exports.createEmployee = onCall(async (request) => {
  const name = requireString(request.data?.name, "Nome", 100);
  const restaurantId = requireString(request.data?.restaurantId, "Restaurante", 128);
  const role = request.data?.role;
  if (!isStaffRole(role)) fail("invalid-argument", "Função inválida.");
  const pin = requirePin(request.data?.pin);
  const { actor } = await assertCanManageRestaurant(request, restaurantId);
  const pinHash = await hashPin(pin);
  const waiterRef = db.collection("waiters").doc();
  const uid = `staff_${waiterRef.id}`;
  let authUserCreated = false;

  try {
    await auth.createUser({ uid, displayName: name, disabled: false });
    authUserCreated = true;
    let employee;
    await db.runTransaction(async (transaction) => {
      employee = await reserveEmployeeCode(transaction, waiterRef, restaurantId, role, name, uid, pinHash);
    });
    await writeAudit({ action: "employee_created", result: "success", restaurantId, employeeId: waiterRef.id, actorUid: actor.uid });
    return employee;
  } catch (error) {
    if (authUserCreated) await auth.deleteUser(uid).catch(() => undefined);
    if (error instanceof HttpsError) throw error;
    console.error("Employee creation failed", error?.code || "unknown");
    fail("internal", "Não foi possível cadastrar o funcionário.");
  }
});

exports.updateEmployee = onCall(async (request) => {
  const restaurantId = requireString(request.data?.restaurantId, "Restaurante", 128);
  const employeeId = requireString(request.data?.employeeId, "Funcionário", 128);
  const { actor } = await assertCanManageRestaurant(request, restaurantId);
  const waiterRef = db.collection("waiters").doc(employeeId);
  const waiterSnapshot = await waiterRef.get();
  if (!waiterSnapshot.exists || waiterSnapshot.data().restaurantId !== restaurantId) {
    fail("not-found", "Funcionário não encontrado neste restaurante.");
  }
  const current = waiterSnapshot.data();
  const name = request.data?.name === undefined ? current.name : requireString(request.data.name, "Nome", 100);
  const role = request.data?.role === undefined ? current.role : request.data.role;
  if (!isStaffRole(role)) fail("invalid-argument", "Função inválida.");
  const active = request.data?.active === undefined ? current.active === true : request.data.active === true;
  const employeeCode = current.employeeCode || employeeCodeFromWaiterId(employeeId);
  const update = { name, role, active, employeeCode, employeeNumber: employeeCode, pinEnabled: current.pinEnabled === true, updatedAt: FieldValue.serverTimestamp() };
  let replacementPinHash;
  if (request.data?.pin !== undefined && request.data.pin !== "") {
    const pin = requirePin(request.data.pin);
    replacementPinHash = await hashPin(pin);
    update.pinEnabled = true;
  }

  const batch = db.batch();
  batch.update(waiterRef, update);
  batch.set(db.collection("waiterDirectory").doc(employeeId), { restaurantId, name, role, active }, { merge: true });
  batch.set(db.collection("waiterDirectory").doc(restaurantId).collection("staff").doc(employeeId), { restaurantId, name, role, active }, { merge: true });
  batch.set(db.collection("restaurantStaff").doc(current.uid), { restaurantId, waiterId: employeeId, role, active }, { merge: true });

  if (request.data?.pin !== undefined && request.data.pin !== "") {
    batch.set(db.collection("employeeSecrets").doc(employeeId), { pinHash: replacementPinHash, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  batch.set(db.collection("employeeCodes").doc(employeeCode), { employeeId, restaurantId, active }, { merge: true });
  await batch.commit();

  try {
    await auth.updateUser(current.uid, { displayName: name, disabled: !active });
    if (!active) await auth.revokeRefreshTokens(current.uid);
  } catch (error) {
    console.error("Unable to synchronize employee Auth state", error?.code || "unknown");
  }

  const action = request.data?.pin ? "employee_pin_changed" : active ? "employee_updated" : "employee_deactivated";
  await writeAudit({ action, result: "success", restaurantId, employeeId, actorUid: actor.uid });
  return employeePublicData(employeeId, { ...current, name, role, active, employeeCode });
});

exports.deleteEmployee = onCall(async (request) => {
  const restaurantId = requireString(request.data?.restaurantId, "Restaurante", 128);
  const employeeId = requireString(request.data?.employeeId, "Funcionário", 128);
  const { actor } = await assertCanManageRestaurant(request, restaurantId);
  const waiterRef = db.collection("waiters").doc(employeeId);
  const snapshot = await waiterRef.get();
  if (!snapshot.exists || snapshot.data().restaurantId !== restaurantId) {
    fail("not-found", "Funcionário não encontrado neste restaurante.");
  }
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
  await auth.deleteUser(employee.uid).catch((error) => {
    if (error?.code !== "auth/user-not-found") console.error("Unable to delete employee Auth account", error?.code || "unknown");
  });
  await writeAudit({ action: "employee_deleted", result: "success", restaurantId, employeeId, actorUid: actor.uid });
  return { employeeId };
});

async function resolveEmployeeForLogin(data) {
  const requestedWaiterId = typeof data.waiterId === "string" ? data.waiterId.trim() : "";
  if (requestedWaiterId) {
    const restaurantId = requireString(data.restaurantId, "Restaurante", 128);
    const waiterSnapshot = await db.collection("waiters").doc(requestedWaiterId).get();
    if (!waiterSnapshot.exists || waiterSnapshot.data().restaurantId !== restaurantId) return null;
    return { id: waiterSnapshot.id, data: waiterSnapshot.data() };
  }

  const employeeCode = normalizeEmployeeCode(data.employeeCode);
  if (!isValidEmployeeCode(employeeCode)) return null;
  const codeSnapshot = await db.collection("employeeCodes").doc(employeeCode).get();
  if (!codeSnapshot.exists || codeSnapshot.data().active !== true) return null;
  const employeeId = codeSnapshot.data().employeeId;
  const waiterSnapshot = await db.collection("waiters").doc(employeeId).get();
  if (!waiterSnapshot.exists) return null;
  return { id: waiterSnapshot.id, data: waiterSnapshot.data() };
}

exports.loginEmployee = onCall(async (request) => {
  const now = Date.now();
  const rawCode = typeof request.data?.employeeCode === "string" ? normalizeEmployeeCode(request.data.employeeCode) : "";
  const rawWaiterId = typeof request.data?.waiterId === "string" ? request.data.waiterId.trim() : "";
  const identity = rawWaiterId
    ? `qr:${request.data?.restaurantId}:${rawWaiterId}`
    : rawCode || `invalid:${hashRateLimitKey("invalid-code", String(request.data?.employeeCode || "").slice(0, 64))}`;
  const ipRef = rateLimitRef("ip", getRequestIp(request));
  const identityRef = rateLimitRef("identity", identity);
  await assertNotRateLimited([ipRef, identityRef], now);

  const employee = await resolveEmployeeForLogin(request.data || {});
  if (!employee || employee.data.active !== true || !employee.data.uid) {
    await recordFailedAttempt([
      { ref: ipRef, maximum: MAX_IP_ATTEMPTS },
      { ref: identityRef, maximum: MAX_CODE_ATTEMPTS },
    ], now);
    await writeAudit({ action: "employee_login", result: "rejected", identityHash: hashRateLimitKey("audit", identity) });
    fail("unauthenticated", "Identificação ou PIN incorretos.");
  }

  const data = employee.data;
  const restaurantSnapshot = await db.collection("restaurants").doc(data.restaurantId).get();
  const secretSnapshot = await db.collection("employeeSecrets").doc(employee.id).get();
  const pinHash = secretSnapshot.data()?.pinHash;
  const pinValid = await verifyPin(request.data?.pin, pinHash);

  if (!pinValid || !restaurantSnapshot.exists) {
    await recordFailedAttempt([
      { ref: ipRef, maximum: MAX_IP_ATTEMPTS },
      { ref: identityRef, maximum: MAX_CODE_ATTEMPTS },
    ], now);
    await writeAudit({ action: "employee_login", result: "rejected", restaurantId: data.restaurantId, employeeId: employee.id, identityHash: hashRateLimitKey("audit", identity) });
    fail("unauthenticated", "Identificação ou PIN incorretos.");
  }
  await assertRestaurantActive(data.restaurantId, restaurantSnapshot.data());

  await clearRateLimit(identityRef);
  const token = await auth.createCustomToken(data.uid, {
    employee: true,
    employeeId: employee.id,
    restaurantId: data.restaurantId,
    role: data.role,
  });
  await writeAudit({ action: "employee_login", result: "success", restaurantId: data.restaurantId, employeeId: employee.id, actorUid: data.uid });
  return { token, employee: employeePublicData(employee.id, data) };
});

exports.changeOwnEmployeePin = onCall(async (request) => {
  const actor = requireSignedIn(request);
  const employeeId = actor.token.employeeId;
  const restaurantId = actor.token.restaurantId;
  if (actor.token.employee !== true || typeof employeeId !== "string" || typeof restaurantId !== "string") {
    fail("permission-denied", "Esta sessão não pertence a um funcionário.");
  }
  const oldPin = request.data?.oldPin;
  const newPin = requirePin(request.data?.newPin);
  const ipRef = rateLimitRef("pin-change-ip", getRequestIp(request));
  const employeeRef = rateLimitRef("pin-change-employee", actor.uid);
  await assertNotRateLimited([ipRef, employeeRef], Date.now());
  const [waiterSnapshot, secretSnapshot] = await Promise.all([
    db.collection("waiters").doc(employeeId).get(),
    db.collection("employeeSecrets").doc(employeeId).get(),
  ]);
  const pinHash = secretSnapshot.data()?.pinHash;
  const validOldPin = await verifyPin(oldPin, pinHash);
  if (!waiterSnapshot.exists || waiterSnapshot.data().uid !== actor.uid || waiterSnapshot.data().active !== true || !validOldPin) {
    await recordFailedAttempt([
      { ref: ipRef, maximum: MAX_IP_ATTEMPTS },
      { ref: employeeRef, maximum: MAX_CODE_ATTEMPTS },
    ], Date.now());
    await writeAudit({ action: "employee_pin_change", result: "rejected", restaurantId, employeeId, actorUid: actor.uid });
    fail("unauthenticated", "PIN atual incorreto.");
  }
  await db.collection("employeeSecrets").doc(employeeId).update({ pinHash: await hashPin(newPin), updatedAt: FieldValue.serverTimestamp() });
  await clearRateLimit(employeeRef);
  await writeAudit({ action: "employee_pin_changed", result: "success", restaurantId, employeeId, actorUid: actor.uid });
  return { success: true };
});

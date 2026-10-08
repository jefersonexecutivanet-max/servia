import security from "./security.cjs";

const { hashRateLimitKey, verifyPin } = security;
const MAX_IDENTITY_ATTEMPTS = 5;
const MAX_IP_ATTEMPTS = 25;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_RETENTION_MS = 24 * 60 * 60 * 1000;

export class SupervisorApprovalError extends Error {
  constructor(code, message, status = 403) { super(message); this.code = code; this.status = status; }
}

function requestIp(request) {
  const forwarded = request?.headers?.["x-forwarded-for"];
  return String(request?.headers?.["x-real-ip"] || (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0] || "unknown").trim().slice(0, 64);
}

async function checkRateLimits(db, refs, now) {
  const snapshots = await Promise.all(refs.map((ref) => ref.get()));
  if (snapshots.some((snapshot) => Number(snapshot.data()?.lockedUntilMs || 0) > now)) {
    throw new SupervisorApprovalError("resource-exhausted", "Muitas tentativas de autorização. Aguarde 15 minutos.", 429);
  }
}

async function recordFailedAttempt(db, limits, now) {
  await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(limits.map(({ ref }) => transaction.get(ref)));
    snapshots.forEach((snapshot, index) => {
      const { ref, maximum } = limits[index];
      const data = snapshot.data() || {};
      const started = Number(data.windowStartedAtMs || 0);
      const withinWindow = started > 0 && now - started < RATE_WINDOW_MS;
      const count = withinWindow ? Number(data.count || 0) + 1 : 1;
      transaction.set(ref, { count, windowStartedAtMs: withinWindow ? started : now, lockedUntilMs: count >= maximum ? now + RATE_WINDOW_MS : 0, expireAt: new Date(now + RATE_RETENTION_MS) });
    });
  });
}

export async function authorizeManagerPin(db, request, restaurantId, employeeCode, pin) {
  const code = typeof employeeCode === "string" ? employeeCode.trim().toUpperCase() : "";
  if (!/^FUNC-[A-Z0-9]{20}$/.test(code) || typeof pin !== "string" || !/^\d{6,8}$/.test(pin)) {
    throw new SupervisorApprovalError("invalid-argument", "Informe o código e o PIN válidos do gerente.", 400);
  }
  const identity = restaurantId + ":" + code;
  const ip = requestIp(request);
  const ipRef = db.collection("employeeLoginLimits").doc(hashRateLimitKey("discount-ip", ip));
  const identityRef = db.collection("employeeLoginLimits").doc(hashRateLimitKey("discount-manager", identity));
  const now = Date.now();
  await checkRateLimits(db, [ipRef, identityRef], now);

  const codeRef = db.collection("employeeCodes").doc(code);
  const codeSnapshot = await codeRef.get();
  const employeeId = codeSnapshot.data()?.employeeId;
  const refsValid = codeSnapshot.exists && codeSnapshot.data()?.active === true && codeSnapshot.data()?.restaurantId === restaurantId && typeof employeeId === "string";
  const refs = refsValid ? {
    code: codeRef,
    waiter: db.collection("waiters").doc(employeeId),
    directory: db.collection("waiterDirectory").doc(restaurantId).collection("staff").doc(employeeId),
    staff: db.collection("restaurantStaff").doc("staff_" + employeeId),
    secret: db.collection("employeeSecrets").doc(employeeId),
  } : null;
  const [waiterSnapshot, directorySnapshot, staffSnapshot, secretSnapshot] = refs ? await Promise.all([
    refs.waiter.get(), refs.directory.get(), refs.staff.get(), refs.secret.get(),
  ]) : [null, null, null, null];
  const waiter = waiterSnapshot?.data();
  const directory = directorySnapshot?.data();
  const staff = staffSnapshot?.data();
  const validIdentity = refsValid && waiterSnapshot?.exists && directorySnapshot?.exists && staffSnapshot?.exists && secretSnapshot?.exists
    && waiter?.active === true && waiter.restaurantId === restaurantId && waiter.role === "MANAGER"
    && directory?.active === true && directory.restaurantId === restaurantId && directory.role === "MANAGER"
    && staff?.active === true && staff.restaurantId === restaurantId && staff.role === "MANAGER" && staff.waiterId === employeeId
    && waiter.uid === "staff_" + employeeId;
  const pinValid = await verifyPin(pin, secretSnapshot?.data()?.pinHash);
  if (!validIdentity || !pinValid) {
    await recordFailedAttempt(db, [{ ref: ipRef, maximum: MAX_IP_ATTEMPTS }, { ref: identityRef, maximum: MAX_IDENTITY_ATTEMPTS }], now);
    throw new SupervisorApprovalError("permission-denied", "Código ou PIN do gerente incorreto, inativo ou sem permissão neste restaurante.", 403);
  }
  await identityRef.delete().catch(() => undefined);
  return { uid: waiter.uid, employeeId, name: String(waiter.name || "Gerente").slice(0, 100), refs, pinHash: secretSnapshot.data().pinHash };
}

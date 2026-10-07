const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_KEY_LENGTH = 64;

const STAFF_ROLES = new Set(["MANAGER", "WAITER", "FLOOR_MANAGER", "CASHIER", "KITCHEN"]);
const WEAK_PINS = new Set([
  "000000", "111111", "222222", "333333", "444444", "555555", "666666", "777777", "888888", "999999",
  "123456", "654321", "012345", "543210", "121212", "112233", "123123", "00000000", "11111111",
]);

function normalizeEmployeeCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function isValidEmployeeCode(value) {
  return /^FUNC-[A-Z0-9]{20}$/.test(normalizeEmployeeCode(value));
}

function validatePin(value) {
  if (typeof value !== "string" || !/^\d{6,8}$/.test(value)) {
    return "O PIN deve ter de 6 a 8 números.";
  }
  if (WEAK_PINS.has(value) || /^(\d)\1+$/.test(value)) {
    return "Escolha um PIN menos previsível.";
  }
  const ascending = "0123456789";
  for (let start = 0; start <= 10 - value.length; start += 1) {
    const sequence = ascending.slice(start, start + value.length);
    if (value === sequence || value === sequence.split("").reverse().join("")) return "Escolha um PIN menos previsível.";
  }
  return "";
}

function isStaffRole(value) {
  return STAFF_ROLES.has(value);
}

function hashRateLimitKey(scope, value) {
  return crypto.createHash("sha256").update(`${scope}:${value}`).digest("hex");
}

function isRequestOriginAllowed(request, origin, allowedOrigins = []) {
  if (!origin || allowedOrigins.includes(origin)) return true;

  const firstHeaderValue = (value) => (Array.isArray(value) ? value[0] : value)?.split(",")[0]?.trim();
  const host = firstHeaderValue(request?.headers?.["x-forwarded-host"])
    || firstHeaderValue(request?.headers?.host);
  const protocol = firstHeaderValue(request?.headers?.["x-forwarded-proto"])
    || (request?.socket?.encrypted ? "https" : "http");
  if (!host || !["http", "https"].includes(protocol)) return false;

  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

async function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(pin, salt, SCRYPT_KEY_LENGTH);
  return `${salt}:${Buffer.from(derivedKey).toString("hex")}`;
}

async function verifyPin(pin, encodedHash) {
  if (typeof pin !== "string" || !/^\d{6,8}$/.test(pin) || typeof encodedHash !== "string") return false;
  const [salt, expectedHex] = encodedHash.split(":");
  if (!/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(expectedHex || "")) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(await scryptAsync(pin, salt, SCRYPT_KEY_LENGTH));
  return crypto.timingSafeEqual(actual, expected);
}

function employeeCodeFromWaiterId(waiterId) {
  return `FUNC-${String(waiterId).toUpperCase()}`;
}

module.exports = {
  employeeCodeFromWaiterId,
  hashPin,
  hashRateLimitKey,
  isRequestOriginAllowed,
  isStaffRole,
  isValidEmployeeCode,
  normalizeEmployeeCode,
  validatePin,
  verifyPin,
};

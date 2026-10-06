const test = require("node:test");
const assert = require("node:assert/strict");
const {
  employeeCodeFromWaiterId,
  hashPin,
  hashRateLimitKey,
  isStaffRole,
  isValidEmployeeCode,
  normalizeEmployeeCode,
  validatePin,
  verifyPin,
} = require("../server/security.cjs");

test("employee code is normalized and scoped to a generated staff id", () => {
  const id = "Abcdef1234567890Ghij";
  const code = employeeCodeFromWaiterId(id);
  assert.equal(code, "FUNC-ABCDEF1234567890GHIJ");
  assert.equal(isValidEmployeeCode(code), true);
  assert.equal(isValidEmployeeCode(normalizeEmployeeCode(` ${code.toLowerCase()} `)), true);
  assert.equal(isValidEmployeeCode("FUNC-1234"), false);
});

test("PIN validation rejects short, non-numeric, repeated, and sequential values", () => {
  assert.notEqual(validatePin("1234"), "");
  assert.notEqual(validatePin("12a456"), "");
  assert.notEqual(validatePin("111111"), "");
  assert.notEqual(validatePin("123456"), "");
  assert.notEqual(validatePin("23456789"), "");
  assert.equal(validatePin("482915"), "");
  assert.equal(validatePin("48291572"), "");
});

test("PINs are stored as salted scrypt hashes and verified without storing plaintext", async () => {
  const encoded = await hashPin("482915");
  assert.match(encoded, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.notEqual(encoded, "482915");
  assert.equal(await verifyPin("482915", encoded), true);
  assert.equal(await verifyPin("482916", encoded), false);
  assert.equal(await verifyPin("482915", "malformed"), false);
});

test("only configured staff roles are accepted", () => {
  for (const role of ["MANAGER", "WAITER", "FLOOR_MANAGER", "CASHIER", "KITCHEN"]) {
    assert.equal(isStaffRole(role), true);
  }
  assert.equal(isStaffRole("OWNER"), false);
  assert.equal(isStaffRole("manager"), false);
});

test("rate limit keys are deterministic hashes and do not expose their inputs", () => {
  const first = hashRateLimitKey("employee", "FUNC-ABCDEF1234567890GHIJ");
  assert.equal(first, hashRateLimitKey("employee", "FUNC-ABCDEF1234567890GHIJ"));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes("FUNC-"), false);
});

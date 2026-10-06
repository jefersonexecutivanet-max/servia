export const STAFF_ROLE_LABELS = {
  MANAGER: "Gerente",
  FLOOR_MANAGER: "Chefe de salão",
  CASHIER: "Caixa",
  WAITER: "Garçom",
  KITCHEN: "Cozinha",
} as const;

export type StaffRole = keyof typeof STAFF_ROLE_LABELS;

export function normalizeStaffRole(value: unknown): StaffRole {
  const role = String(value || "").trim().toUpperCase();
  if (role in STAFF_ROLE_LABELS) return role as StaffRole;

  const legacy = String(value || "").trim().toLocaleLowerCase("pt-BR");
  if (legacy === "chefe de salão" || legacy === "chefe de salÃ£o") return "FLOOR_MANAGER";
  if (legacy === "caixa") return "CASHIER";
  if (legacy === "cozinha") return "KITCHEN";
  if (legacy === "gerente") return "MANAGER";
  return "WAITER";
}

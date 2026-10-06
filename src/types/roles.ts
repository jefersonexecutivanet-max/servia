export const STAFF_ROLE_LABELS = {
  MANAGER: "Gerente",
  FLOOR_MANAGER: "Chefe do Sal\u00e3o",
  CASHIER: "Caixa",
  WAITER: "Gar\u00e7om/Gar\u00e7onete",
  KITCHEN: "Cozinha",
} as const;

export type StaffRole = keyof typeof STAFF_ROLE_LABELS;

export function normalizeStaffRole(value: unknown): StaffRole {
  const role = String(value || "").trim().toUpperCase();
  if (role in STAFF_ROLE_LABELS) return role as StaffRole;

  const legacy = String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  if (legacy === "chefe do salao" || legacy === "chefe de salao") return "FLOOR_MANAGER";
  if (["caixa"].includes(legacy)) return "CASHIER";
  if (legacy === "cozinha") return "KITCHEN";
  if (legacy === "gerente") return "MANAGER";
  return "WAITER";
}

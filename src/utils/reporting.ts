export type CashMovement = {
  type?: string;
  category?: string;
  reversesType?: string;
  amount?: number;
  amountCents?: number;
};

function movementAmountCents(movement: CashMovement): number {
  const cents = Number(movement.amountCents);
  if (Number.isInteger(cents) && cents >= 0) return cents;
  const amount = Number(movement.amount);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : 0;
}

function isCashHandlingMovement(movement: CashMovement): boolean {
  const category = String(movement.category || "").toLowerCase();
  const type = String(movement.type || "").toLowerCase();
  return ["sangria", "suprimento"].includes(category) || ["sangria", "suprimento"].includes(type);
}

export function expenseDeltaCents(movement: CashMovement): number {
  const type = String(movement.type || "").toLowerCase();
  if (isCashHandlingMovement(movement)) return 0;
  const amount = movementAmountCents(movement);
  if (type === "estorno") return movement.reversesType === "saida" ? -amount : 0;
  return type === "saida" || type === "despesa" ? amount : 0;
}

export function totalExpenseCents(movements: CashMovement[]): number {
  return movements.reduce((total, movement) => total + expenseDeltaCents(movement), 0);
}

export type PaidItemDetail = {
  productId?: string;
  name?: string;
  quantity?: number;
  unitPriceCents?: number;
};

export type ProductSale = { name: string; quantity: number; revenue: number };

export function aggregateProductSales(items: PaidItemDetail[]): ProductSale[] {
  const sales = new Map<string, ProductSale>();
  for (const item of items) {
    const quantity = Number(item.quantity);
    const unitPriceCents = Number(item.unitPriceCents);
    if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isInteger(unitPriceCents) || unitPriceCents < 0) continue;
    const name = String(item.name || "Produto");
    const key = String(item.productId || name);
    const existing = sales.get(key) || { name, quantity: 0, revenue: 0 };
    existing.quantity += quantity;
    existing.revenue += unitPriceCents * quantity / 100;
    sales.set(key, existing);
  }
  return [...sales.values()].sort((first, second) => second.quantity - first.quantity);
}

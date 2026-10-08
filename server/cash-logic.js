export class CashValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CashValidationError";
  }
}

export function toCents(value, label = "Valor", { allowZero = false } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) {
    throw new CashValidationError(`${label} inválido.`);
  }
  const rounded = Math.round(amount * 100);
  if (Math.abs(amount * 100 - rounded) > 1e-7) {
    throw new CashValidationError(`${label} deve ter no máximo duas casas decimais.`);
  }
  return rounded;
}

export function calculateDiscount(subtotalCents, discount) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents <= 0) throw new CashValidationError("Subtotal inválido para desconto.");
  if (!discount || typeof discount !== "object") throw new CashValidationError("Desconto inválido.");
  let discountCents;
  if (discount.type === "percent") {
    const percentBasisPoints = toCents(discount.value, "Percentual do desconto");
    if (percentBasisPoints < 1 || percentBasisPoints > 10000) throw new CashValidationError("O desconto percentual deve ficar entre 0,01% e 100%.");
    discountCents = Math.round(subtotalCents * percentBasisPoints / 10000);
  } else if (discount.type === "fixed") {
    discountCents = toCents(discount.value, "Desconto em reais");
    if (discountCents > subtotalCents) throw new CashValidationError("O desconto não pode ultrapassar o subtotal.");
  } else {
    throw new CashValidationError("Tipo de desconto inválido.");
  }
  if (discountCents < 1 || discountCents > subtotalCents) throw new CashValidationError("Valor de desconto inválido.");
  return { discountCents, netSubtotalCents: subtotalCents - discountCents };
}

const paymentMethods = new Set(["cash", "pix", "debit", "credit", "other"]);

export function normalizePaymentParts(parts, totalCents, cashReceived) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 5) {
    throw new CashValidationError("Informe de 1 a 5 formas de pagamento.");
  }

  const normalized = parts.map((part) => {
    const method = String(part?.method || "").trim().toLowerCase();
    if (!paymentMethods.has(method)) throw new CashValidationError("Forma de pagamento inválida.");
    const amountCents = toCents(part?.amount, "Valor do pagamento");
    const label = method === "other" ? String(part?.label || "").trim().slice(0, 40) : "";
    if (method === "other" && !label) throw new CashValidationError("Descreva a outra forma de pagamento.");
    return { method, ...(label ? { label } : {}), amountCents };
  });

  const paidCents = normalized.reduce((sum, part) => sum + part.amountCents, 0);
  if (paidCents !== totalCents) throw new CashValidationError("A soma dos pagamentos deve ser igual ao total da conta.");

  const cashCents = normalized.filter((part) => part.method === "cash").reduce((sum, part) => sum + part.amountCents, 0);
  const receivedCents = cashCents === 0
    ? 0
    : (cashReceived === undefined ? cashCents : toCents(cashReceived, "Valor recebido"));
  if (receivedCents < cashCents) throw new CashValidationError("O valor recebido em dinheiro é menor que a parte em dinheiro.");

  return {
    parts: normalized.map((part) => ({ ...part, amount: part.amountCents / 100 })),
    paidCents,
    cashCents,
    receivedCents,
    changeCents: receivedCents - cashCents,
  };
}

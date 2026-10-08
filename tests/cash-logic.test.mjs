import { describe, expect, it } from "vitest";
import { calculateDiscount, normalizePaymentParts, toCents } from "../server/cash-logic.js";

describe("cash payment calculations", () => {
  it("keeps a split payment equal to the server total", () => {
    const result = normalizePaymentParts([
      { method: "cash", amount: 50 },
      { method: "pix", amount: 50 },
      { method: "credit", amount: 50 },
    ], 15000, 60);

    expect(result.paidCents).toBe(15000);
    expect(result.cashCents).toBe(5000);
    expect(result.changeCents).toBe(1000);
  });

  it("rejects incomplete, excessive and invalid payments", () => {
    expect(() => normalizePaymentParts([{ method: "pix", amount: 99.99 }], 10000)).toThrow();
    expect(() => normalizePaymentParts([{ method: "cash", amount: 101 }], 10000, 101)).toThrow();
    expect(() => normalizePaymentParts([{ method: "cash", amount: 100 }], 10000, 99)).toThrow();
    expect(() => normalizePaymentParts([{ method: "unknown", amount: 100 }], 10000)).toThrow();
  });

  it("rejects negative and fractional-cent values", () => {
    expect(() => toCents(-1)).toThrow();
    expect(() => toCents(1.001)).toThrow();
  });
});


describe("server discount calculations", () => {
  it("calculates fixed and percentage discounts in cents", () => {
    expect(calculateDiscount(10000, { type: "percent", value: 12.5 })).toEqual({ discountCents: 1250, netSubtotalCents: 8750 });
    expect(calculateDiscount(10000, { type: "fixed", value: 25.55 })).toEqual({ discountCents: 2555, netSubtotalCents: 7445 });
  });

  it("rejects discounts above the subtotal or the 100 percent limit", () => {
    expect(() => calculateDiscount(10000, { type: "percent", value: 100.01 })).toThrow();
    expect(() => calculateDiscount(10000, { type: "fixed", value: 100.01 })).toThrow();
    expect(() => calculateDiscount(10000, { type: "percent", value: 0 })).toThrow();
  });
});

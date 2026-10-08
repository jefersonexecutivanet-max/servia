import { describe, expect, it } from "vitest";
import { calculateDiscount, normalizePaymentParts, toCents } from "../server/cash-logic.js";
import { quantityCanBeSettled, splitTransferOrders, unpaidLineQuantity } from "../server/payment-domain.js";

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

describe("partial payment, cancellation and transfer selections", () => {
  it("limits both payment and cancellation to the remaining line quantity", () => {
    const order = {
      items: [{ productId: "coffee", quantity: 5, cancelledQuantity: 1 }],
      paidQuantities: { "0": 2 },
    };
    expect(unpaidLineQuantity(order, 0)).toBe(2);
    expect(quantityCanBeSettled(order, 0, 2)).toBe(true);
    expect(quantityCanBeSettled(order, 0, 3)).toBe(false);
    expect(quantityCanBeSettled(order, 0, 0)).toBe(false);
  });

  it("transfers only selected open orders and retains the rest", () => {
    const orders = [
      { id: "open-a", tableId: "restaurant_1", status: "novo" },
      { id: "open-b", tableId: "restaurant_1", status: "preparando" },
      { id: "paid", tableId: "restaurant_1", status: "pronto", paymentStatus: "paid" },
      { id: "other-table", tableId: "restaurant_2", status: "novo" },
    ];
    const result = splitTransferOrders(orders, "restaurant_1", new Set(["open-a"]));
    expect(result.moving.map((order) => order.id)).toEqual(["open-a"]);
    expect(result.remaining.map((order) => order.id)).toEqual(["open-b"]);
    expect(() => splitTransferOrders(orders, "restaurant_1", new Set(["missing"]))).toThrow();
  });
});

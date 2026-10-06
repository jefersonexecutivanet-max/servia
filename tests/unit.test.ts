import { describe, expect, it } from "vitest";
import { cartItemKey } from "../src/utils/cart";
import { calculateOrderTotal, shouldClaimOrderPrint } from "../src/utils/orders";
import { normalizeStaffRole } from "../src/types/roles";

describe("order and cart helpers", () => {
  it("recalculates totals from item quantity and price", () => {
    expect(calculateOrderTotal([{ quantity: 2, price: 4.5 }, { quantity: 1, price: 3 }])).toBe(12);
  });

  it("keeps extras and notes in the cart identity", () => {
    expect(cartItemKey({ productId: "p1", extraIds: ["b", "a"], notes: " sem cebola " })).toBe(
      cartItemKey({ productId: "p1", extraIds: ["a", "b"], notes: "sem cebola" }),
    );
    expect(cartItemKey({ productId: "p1", extraIds: ["a"], notes: "sem cebola" })).not.toBe(
      cartItemKey({ productId: "p1", extraIds: ["a"], notes: "bem passado" }),
    );
  });

  it("normalizes staff roles and only claims unprinted, non-cancelled orders", () => {
    expect(normalizeStaffRole("caixa")).toBe("CASHIER");
    expect(shouldClaimOrderPrint({ status: "novo" })).toBe(true);
    expect(shouldClaimOrderPrint({ status: "novo", printedAt: new Date() })).toBe(false);
    expect(shouldClaimOrderPrint({ status: "cancelado" })).toBe(false);
  });
});

type CartIdentity = { productId: string; extraIds: readonly string[]; notes: string };

export function cartItemKey(item: CartIdentity): string {
  return JSON.stringify([item.productId, [...item.extraIds].sort(), item.notes.trim()]);
}

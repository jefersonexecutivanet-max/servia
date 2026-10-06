export function tableDocId(restaurantId: string, tableNumber: number | string): string {
  return `${restaurantId}_${tableNumber}`;
}

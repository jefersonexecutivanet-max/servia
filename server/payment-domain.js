export function unpaidLineQuantity(order, lineIndex) {
  const line = Array.isArray(order?.items) ? order.items[lineIndex] : undefined;
  if (!line) return 0;
  return Number(line.quantity) - Number(order.paidQuantities?.[String(lineIndex)] || 0) - Number(line.cancelledQuantity || 0);
}

export function quantityCanBeSettled(order, lineIndex, quantity) {
  const available = unpaidLineQuantity(order, lineIndex);
  return Number.isInteger(available) && available >= 0
    && Number.isInteger(quantity) && quantity > 0 && quantity <= available;
}

export function splitTransferOrders(orders, sourceTableId, selectedIds = null) {
  const available = orders.filter((order) => order.tableId === sourceTableId
    && order.status !== "cancelado" && order.paymentStatus !== "paid");
  const moving = selectedIds ? available.filter((order) => selectedIds.has(order.id)) : available;
  if (moving.length === 0 || (selectedIds && moving.length !== selectedIds.size)) {
    throw new Error("Um ou mais pedidos selecionados não estão mais disponíveis para transferência.");
  }
  const movingIds = new Set(moving.map((order) => order.id));
  return { moving, remaining: available.filter((order) => !movingIds.has(order.id)) };
}

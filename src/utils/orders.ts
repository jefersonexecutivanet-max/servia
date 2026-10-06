import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import type { Order, OrderItem, OrderStatus } from "../types/order";

export function calculateOrderTotal(items: readonly Pick<OrderItem, "quantity" | "price">[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.price) || 0), 0);
}

export function statusLabel(status: OrderStatus): string {
  return ({ novo: "Novo", preparando: "Preparando", pronto: "Pronto", entregue: "Entregue", cancelado: "Cancelado" } satisfies Record<OrderStatus, string>)[status];
}

export function statusClass(status: OrderStatus): string {
  return ({ novo: "new", preparando: "preparing", pronto: "ready", entregue: "delivered", cancelado: "cancelled" } satisfies Record<OrderStatus, string>)[status];
}

export function formatTime(date?: Date): string {
  return date?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) || "--:--";
}

export function convertOrder(snapshot: QueryDocumentSnapshot<DocumentData>): Order {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    tableNumber: Number(data.tableNumber || 0),
    status: (data.status || "novo") as OrderStatus,
    source: data.source,
    items: Array.isArray(data.items) ? data.items : [],
    total: calculateOrderTotal(Array.isArray(data.items) ? data.items : []),
    createdAt: data.createdAt?.toDate instanceof Function ? data.createdAt.toDate() : undefined,
    paymentStatus: data.paymentStatus,
    paymentId: data.paymentId,
    paidAt: data.paidAt?.toDate instanceof Function ? data.paidAt.toDate() : undefined,
    printedAt: data.printedAt?.toDate instanceof Function ? data.printedAt.toDate() : undefined,
    printedBy: data.printedBy,
  };
}

export function shouldClaimOrderPrint(order: Pick<Order, "status" | "printedAt">): boolean {
  return order.status !== "cancelado" && !order.printedAt;
}

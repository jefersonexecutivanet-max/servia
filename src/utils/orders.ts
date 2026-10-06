import type { Order } from "../types/order";

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  extras?: string[];
  notes?: string;
}

/**
 * Recalcula o total de um pedido a partir dos itens
 * Isso garante que sempre usamos o valor correto, mesmo se o gravado foi adulterado
 */
export function recalculateOrderTotal(items: OrderItem[]): number {
  if (!items || items.length === 0) return 0;
  
  return items.reduce((sum, item) => {
    const itemTotal = (item.quantity || 0) * (item.price || 0);
    return sum + itemTotal;
  }, 0);
}

/**
 * Alias para compatibilidade com código existente
 */
export function calculateOrderTotal(items: OrderItem[]): number {
  return recalculateOrderTotal(items);
}

/**
 * Compara o total gravado com o recalculado
 * Retorna true se divergir (indica possível adulteração)
 */
export function totalDiverges(order: Order): boolean {
  const recordedTotal = order.total || 0;
  const recalculatedTotal = recalculateOrderTotal(order.items || []);
  
  // Tolerância de 0.01 para erros de ponto flutuante
  return Math.abs(recordedTotal - recalculatedTotal) > 0.01;
}

/**
 * Obtém o total confiável do pedido (sempre recalculado)
 */
export function getReliableTotal(order: Order): number {
  return recalculateOrderTotal(order.items || []);
}

/**
 * Converte status do pedido para label legível
 */
export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    novo: "Novo",
    preparando: "Preparando",
    pronto: "Pronto",
    entregue: "Entregue",
    cancelado: "Cancelado",
  };
  return labels[status] || status;
}

/**
 * Retorna classe CSS para o status
 */
export function statusClass(status: string): string {
  const classes: Record<string, string> = {
    novo: "status-novo",
    preparando: "status-preparando",
    pronto: "status-pronto",
    entregue: "status-entregue",
    cancelado: "status-cancelado",
  };
  return classes[status] || "";
}

/**
 * Formata timestamp para exibição
 */
export function formatTime(timestamp?: Date): string {
  if (!timestamp) return "";
  
  if (timestamp instanceof Date) {
    return timestamp.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  
  return "";
}

/**
 * Verifica se o pedido deve ser impresso (não tem printedAt e não está cancelado)
 */
export function shouldClaimOrderPrint(order: Order): boolean {
  return !order.printedAt && order.status !== "cancelado";
}

/**
 * Converte documento do Firestore para tipo Order
 */
export function convertOrder(doc: any): Order {
  const data = doc.data();
  return {
    id: doc.id,
    restaurantId: data.restaurantId || "",
    tableId: data.tableId || "",
    tableNumber: data.tableNumber || 0,
    waiterId: data.waiterId || "",
    status: data.status || "novo",
    source: data.source || "manual",
    items: data.items || [],
    total: data.total || 0,
    createdAt: data.createdAt?.toDate() || new Date(),
    printedAt: data.printedAt?.toDate(),
    printedBy: data.printedBy || "",
    paymentStatus: data.paymentStatus || "pending",
    paymentId: data.paymentId || "",
    paidAt: data.paidAt?.toDate(),
    customerUid: data.customerUid || "",
  };
}

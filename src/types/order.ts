export type OrderStatus = "novo" | "preparando" | "pronto" | "entregue" | "cancelado";

export type OrderItem = {
  productId: string | number;
  name: string;
  quantity: number;
  price: number;
  extras?: string[];
  notes?: string;
};

export type Order = {
  id: string;
  restaurantId: string;
  tableId: string;
  tableNumber: number;
  waiterId: string;
  status: OrderStatus;
  source?: string;
  items: OrderItem[];
  total: number;
  createdAt?: Date;
  printedAt?: Date;
  printedBy?: string;
  paymentStatus?: "paid" | "pending" | "unpaid";
  paymentId?: string;
  paidAt?: Date;
  customerUid: string;
};
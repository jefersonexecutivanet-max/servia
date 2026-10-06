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
  tableNumber: number;
  status: OrderStatus;
  source?: string;
  items: OrderItem[];
  total: number;
  createdAt?: Date;
  paymentStatus?: "paid" | "unpaid";
  paymentId?: string;
  paidAt?: Date;
  printedAt?: Date;
  printedBy?: string;
};

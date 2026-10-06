import type { Timestamp } from "firebase/firestore";

export type TableStatus = "livre" | "ocupada" | "reservada";

export type Table = {
  number: number;
  status: TableStatus;
  guests: number;
  total: number;
  customer?: string;
  capacity: number;
  x?: number;
  y?: number;
  accessToken?: string; // Token secreto para acesso via QR/NFC
  lastOrderAt?: Timestamp; // Timestamp do último pedido para limite de frequência
};

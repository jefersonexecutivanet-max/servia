export type TableStatus = "livre" | "ocupada" | "reservada";

export type Table = {
  number: number;
  status: TableStatus;
  guests: number;
  total: number;
  customer?: string;
  capacity: number;
};

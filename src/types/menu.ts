export type ProductExtra = {
  id: string;
  name: string;
  price: number;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl: string;
  available: boolean;
  featured: boolean;
  extras: ProductExtra[];
  notesEnabled: boolean;
};

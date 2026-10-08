export type ProductExtra = {
  id: string;
  name: string;
  price: number;
};

export type ProductRecipeItem = {
  stockId: string;
  quantity: number;
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
  recipe?: ProductRecipeItem[];
};

import { useCallback, useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import { db } from "../firebase";
import type { Product, ProductExtra, ProductRecipeItem } from "../types/menu";

function toExtras(value: unknown): ProductExtra[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const extra = item as Record<string, unknown>;

      return {
        id: String(extra.id || `extra-${index}`),
        name: String(extra.name || ""),
        price: Number(extra.price || 0),
      };
    })
    .filter((item): item is ProductExtra => Boolean(item?.name));
}

function convertProduct(id: string, data: DocumentData): Product {
  return {
    id: String(data.id || id),
    name: String(data.name || ""),
    description: String(data.description || ""),
    price: Number(data.price || 0),
    category: String(data.category || "Pratos"),
    imageUrl: String(data.imageUrl || ""),
    available: data.available !== false,
    featured: Boolean(data.featured),
    extras: toExtras(data.extras),
    notesEnabled: data.notesEnabled !== false,
    recipe: Array.isArray(data.recipe) ? data.recipe.filter((item: unknown): item is ProductRecipeItem => Boolean(item && typeof item === "object" && typeof (item as ProductRecipeItem).stockId === "string" && Number.isFinite(Number((item as ProductRecipeItem).quantity)) && Number((item as ProductRecipeItem).quantity) > 0)).map((item: ProductRecipeItem) => ({ stockId: item.stockId, quantity: Number(item.quantity) })) : [],
  };
}

function toFirestore(product: Product, restaurantId: string) {
  return {
    id: product.id,
    restaurantId,
    name: product.name,
    description: product.description,
    price: product.price,
    category: product.category,
    imageUrl: product.imageUrl,
    available: product.available,
    featured: product.featured,
    extras: product.extras,
    notesEnabled: product.notesEnabled,
    recipe: product.recipe || [],
  };
}

export function useMenuCatalog(restaurantId: string, catalogDb: Firestore = db) {
  const [products, setProducts] = useState<Product[]>([]);
  const [fromRemote, setFromRemote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const menuQuery = restaurantId
      ? query(collection(catalogDb, "menuItems"), where("restaurantId", "==", restaurantId))
      : query(collection(catalogDb, "menuItems"));
    const unsubscribe = onSnapshot(
      menuQuery,
      (snapshot) => {
        if (snapshot.empty) {
          setProducts([]);
          setFromRemote(true);
        } else {
          const nextProducts = snapshot.docs
            .map((item) => convertProduct(item.id, item.data()))
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

          setProducts(nextProducts);
          setFromRemote(true);
        }

        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        console.error("Erro ao carregar cardápio:", snapshotError);
        setProducts([]);
        setFromRemote(false);
        setLoading(false);
        setError(
          "Não foi possível sincronizar o cardápio.",
        );
      },
    );

    return () => unsubscribe();
  }, [catalogDb, restaurantId]);

  const saveProduct = useCallback(async (product: Product) => {
    await setDoc(doc(catalogDb, "menuItems", `${restaurantId}_${product.id}`), toFirestore(product, restaurantId));
  }, [catalogDb, restaurantId]);

  const deleteProduct = useCallback(async (productId: string) => {
    await deleteDoc(doc(catalogDb, "menuItems", `${restaurantId}_${productId}`));
  }, [catalogDb, restaurantId]);

  const publishCatalog = useCallback(async (items: Product[]) => {
    await Promise.all(
      items.map((product) =>
        setDoc(doc(catalogDb, "menuItems", `${restaurantId}_${product.id}`), toFirestore(product, restaurantId)),
      ),
    );
  }, [catalogDb, restaurantId]);

  return {
    products,
    fromRemote,
    loading,
    error,
    saveProduct,
    deleteProduct,
    publishCatalog,
  };
}

import { createContext, useContext, type ReactNode } from "react";

export type RestaurantScopeValue = {
  restaurantId: string;
  systemAdmin: boolean;
  setRestaurantId: (restaurantId: string) => void;
};

const RestaurantContext = createContext<RestaurantScopeValue | null>(null);

export function RestaurantProvider({
  value,
  children,
}: {
  value: RestaurantScopeValue;
  children: ReactNode;
}) {
  return (
    <RestaurantContext.Provider value={value}>
      {children}
    </RestaurantContext.Provider>
  );
}

export function useRestaurantScope() {
  const context = useContext(RestaurantContext);
  if (!context) {
    throw new Error("useRestaurantScope deve ser usado dentro de RestaurantProvider.");
  }
  return context;
}

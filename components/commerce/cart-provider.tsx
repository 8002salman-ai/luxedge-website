"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type CartItem = {
  variantId: string;
  productId: string;
  slug: string;
  title: string;
  variantTitle: string;
  sku: string;
  priceAmount: number;
  currency: string;
  imageUrl: string | null;
  quantity: number;
};

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  subtotalAmount: number;
  hydrated: boolean;
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  removeItem: (variantId: string) => void;
  clearCart: () => void;
};

const STORAGE_KEY = "luxedge_cart_v1";
const CartContext = createContext<CartContextValue | null>(null);

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CartItem>;
  return typeof item.variantId === "string" && /^[0-9a-f-]{36}$/i.test(item.variantId)
    && typeof item.productId === "string" && /^[0-9a-f-]{36}$/i.test(item.productId)
    && typeof item.title === "string" && typeof item.variantTitle === "string"
    && typeof item.sku === "string" && Number.isInteger(item.priceAmount) && (item.priceAmount ?? -1) >= 0
    && typeof item.currency === "string" && typeof item.quantity === "number"
    && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 25;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(parsed)) setItems(parsed.filter(isCartItem).slice(0, 25));
    } catch { localStorage.removeItem(STORAGE_KEY); }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [hydrated, items]);

  const addItem = useCallback((item: Omit<CartItem, "quantity">, quantity = 1) => {
    const safeQuantity = Math.max(1, Math.min(25, Math.trunc(quantity)));
    setItems((current) => {
      const existing = current.find((entry) => entry.variantId === item.variantId);
      if (existing) return current.map((entry) => entry.variantId === item.variantId ? { ...entry, quantity: Math.min(25, entry.quantity + safeQuantity) } : entry);
      return [...current.slice(0, 24), { ...item, quantity: safeQuantity }];
    });
  }, []);

  const updateQuantity = useCallback((variantId: string, quantity: number) => {
    if (!Number.isInteger(quantity) || quantity < 1) return setItems((current) => current.filter((item) => item.variantId !== variantId));
    setItems((current) => current.map((item) => item.variantId === variantId ? { ...item, quantity: Math.min(25, quantity) } : item));
  }, []);
  const removeItem = useCallback((variantId: string) => setItems((current) => current.filter((item) => item.variantId !== variantId)), []);
  const clearCart = useCallback(() => setItems([]), []);
  const value = useMemo(() => ({ items, hydrated, addItem, updateQuantity, removeItem, clearCart, itemCount: items.reduce((sum, item) => sum + item.quantity, 0), subtotalAmount: items.reduce((sum, item) => sum + item.priceAmount * item.quantity, 0) }), [items, hydrated, addItem, updateQuantity, removeItem, clearCart]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider.");
  return context;
}

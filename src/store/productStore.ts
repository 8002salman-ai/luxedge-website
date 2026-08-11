import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product, Category } from '../types';

interface ProductStore {
  products: Product[];
  categories: Category[];
  addProduct: (product: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'rating' | 'reviewCount'>) => void;
  updateProduct: (id: string, updates: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  getProduct: (id: string) => Product | undefined;
  getProductsByCategory: (category: string) => Product[];
  searchProducts: (query: string) => Product[];
  updateStock: (id: string, quantity: number) => void;
  getLowStockProducts: () => Product[];
}

const initialProducts: Product[] = [
  {
    id: 'prod-001',
    name: 'Orthopedic Memory Foam Dog Bed',
    description: 'Joint-supporting orthopedic memory foam dog bed with a washable, removable cover. Relieves pressure points so your dog sleeps deeply and wakes refreshed.',
    price: 49.99,
    originalPrice: 89.99,
    category: 'Pet Beds',
    stock: 64,
    images: [
      { id: 'img-1', url: 'https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg?auto=compress&cs=tinysrgb&w=600', isPrimary: true },
    ],
    rating: 4.9,
    reviewCount: 1123,
    sku: 'LE-PB-001',
    isActive: true,
    createdAt: '2024-01-10T10:00:00Z',
    updatedAt: '2024-03-15T14:30:00Z',
  },
  {
    id: 'prod-002',
    name: 'Interactive Cat Feather Toy',
    description: 'Motion-activated interactive feather toy that mimics prey movement. Keeps indoor cats active, entertained, and mentally stimulated for hours.',
    price: 24.99,
    originalPrice: 44.99,
    category: 'Pet Toys',
    stock: 132,
    images: [
      { id: 'img-2', url: 'https://images.pexels.com/photos/1170986/pexels-photo-1170986.jpeg?auto=compress&cs=tinysrgb&w=600', isPrimary: true },
    ],
    rating: 4.7,
    reviewCount: 876,
    sku: 'LE-TOY-001',
    isActive: true,
    createdAt: '2024-01-15T09:00:00Z',
    updatedAt: '2024-03-14T11:00:00Z',
  },
  {
    id: 'prod-003',
    name: 'Stainless Steel Pet Water Fountain',
    description: '3-liter stainless steel pet water fountain with triple filtration and a quiet pump. Encourages pets to drink more fresh, filtered water every day.',
    price: 34.99,
    originalPrice: 59.99,
    category: 'Feeding & Water',
    stock: 76,
    images: [
      { id: 'img-3', url: 'https://images.pexels.com/photos/3777622/pexels-photo-3777622.jpeg?auto=compress&cs=tinysrgb&w=600', isPrimary: true },
    ],
    rating: 4.8,
    reviewCount: 521,
    sku: 'LE-FDW-001',
    isActive: true,
    createdAt: '2024-02-01T08:00:00Z',
    updatedAt: '2024-03-10T16:00:00Z',
  },
  {
    id: 'prod-004',
    name: 'Adjustable No-Pull Dog Harness',
    description: 'No-pull reflective dog harness with padded chest and fully adjustable straps. Ensures comfortable, secure walks for dogs of all sizes.',
    price: 29.99,
    originalPrice: 54.99,
    category: 'Dog Supplies',
    stock: 98,
    images: [
      { id: 'img-4', url: 'https://images.pexels.com/photos/164186/pexels-photo-164186.jpeg?auto=compress&cs=tinysrgb&w=600', isPrimary: true },
    ],
    rating: 4.8,
    reviewCount: 654,
    sku: 'LE-DOG-001',
    isActive: true,
    createdAt: '2024-02-10T12:00:00Z',
    updatedAt: '2024-03-12T09:00:00Z',
  },
  {
    id: 'prod-005',
    name: 'Self-Cleaning Slicker Grooming Brush',
    description: 'Self-cleaning slicker brush with retractable bristles for easy cleanup. Gently removes loose fur, tangles, and mats while massaging your pet\u2019s skin.',
    price: 19.99,
    originalPrice: 39.99,
    category: 'Grooming',
    stock: 210,
    images: [
      { id: 'img-5', url: 'https://images.pexels.com/photos/2173872/pexels-photo-2173872.jpeg?auto=compress&cs=tinysrgb&w=600', isPrimary: true },
    ],
    rating: 4.6,
    reviewCount: 432,
    sku: 'LE-GRM-001',
    isActive: true,
    createdAt: '2024-02-15T14:00:00Z',
    updatedAt: '2024-03-08T10:00:00Z',
  },
  {
    id: 'prod-006',
    name: 'Premium Cat Scratching Post',
    description: 'Premium sisal scratching post with a cozy perch and dangling toy. Satisfies your cat\u2019s natural scratching instinct while protecting your furniture.',
    price: 45.99,
    originalPrice: 79.99,
    category: 'Cat Supplies',
    stock: 57,
    images: [
      { id: 'img-6', url: 'https://images.pexels.com/photos/2194261/pexels-photo-2194261.jpeg?auto=compress&cs=tinysrgb&w=600', isPrimary: true },
    ],
    rating: 4.8,
    reviewCount: 389,
    sku: 'LE-CAT-001',
    isActive: true,
    createdAt: '2024-02-20T11:00:00Z',
    updatedAt: '2024-03-15T08:00:00Z',
  },
  {
    id: 'prod-007',
    name: 'Slow Feeder Dog Bowl',
    description: 'Non-slip slow feeder bowl with raised ridges that slows down fast eaters. Reduces bloating and improves digestion for happier mealtimes.',
    price: 17.99,
    originalPrice: 29.99,
    category: 'Feeding & Water',
    stock: 143,
    images: [
      { id: 'img-7', url: 'https://images.pexels.com/photos/5732487/pexels-photo-5732487.jpeg?auto=compress&cs=tinysrgb&w=600', isPrimary: true },
    ],
    rating: 4.7,
    reviewCount: 298,
    sku: 'LE-FDW-002',
    isActive: true,
    createdAt: '2024-03-01T10:00:00Z',
    updatedAt: '2024-03-14T15:00:00Z',
  },
  {
    id: 'prod-008',
    name: 'Portable Pet Travel Water Bottle',
    description: 'Portable pet travel water bottle with a one-hand dispensing cup and leak-proof design. Perfect for walks, hikes, and road trips with your furry friend.',
    price: 15.99,
    originalPrice: 27.99,
    category: 'Pet Accessories',
    stock: 188,
    images: [
      { id: 'img-8', url: 'https://images.pexels.com/photos/127028/pexels-photo-127028.jpeg?auto=compress&cs=tinysrgb&w=600', isPrimary: true },
    ],
    rating: 4.6,
    reviewCount: 245,
    sku: 'LE-ACC-001',
    isActive: true,
    createdAt: '2024-03-05T09:00:00Z',
    updatedAt: '2024-03-15T12:00:00Z',
  },
  {
    id: 'prod-009',
    name: 'Durable Rope Dog Toy Set',
    description: 'Set of 3 durable cotton rope dog toys designed for chewing, tug-of-war, and fetch. Helps clean teeth and satisfies natural chewing instincts.',
    price: 14.99,
    originalPrice: 24.99,
    category: 'Pet Toys',
    stock: 201,
    images: [
      { id: 'img-9', url: 'https://images.pexels.com/photos/2607544/pexels-photo-2607544.jpeg?auto=compress&cs=tinysrgb&w=600', isPrimary: true },
    ],
    rating: 4.7,
    reviewCount: 512,
    sku: 'LE-TOY-002',
    isActive: true,
    createdAt: '2024-03-08T09:00:00Z',
    updatedAt: '2024-03-15T12:00:00Z',
  },
  {
    id: 'prod-010',
    name: 'Cozy Calming Cat Bed',
    description: 'Cozy donut-shaped cat bed with a raised rim for security and warmth. Machine-washable plush design gives cats a calm, snug place to curl up.',
    price: 32.99,
    originalPrice: 54.99,
    category: 'Pet Beds',
    stock: 84,
    images: [
      { id: 'img-10', url: 'https://images.pexels.com/photos/416160/pexels-photo-416160.jpeg?auto=compress&cs=tinysrgb&w=600', isPrimary: true },
    ],
    rating: 4.9,
    reviewCount: 734,
    sku: 'LE-PB-002',
    isActive: true,
    createdAt: '2024-03-10T09:00:00Z',
    updatedAt: '2024-03-15T12:00:00Z',
  },
  {
    id: 'prod-011',
    name: 'Automatic Pet Food Dispenser',
    description: 'Automatic pet food dispenser with programmable portions and a built-in voice recorder. Keeps your pet on a consistent feeding schedule even when you are away.',
    price: 54.99,
    originalPrice: 89.99,
    category: 'Feeding & Water',
    stock: 46,
    images: [
      { id: 'img-11', url: 'https://images.pexels.com/photos/1805164/pexels-photo-1805164.jpeg?auto=compress&cs=tinysrgb&w=600', isPrimary: true },
    ],
    rating: 4.7,
    reviewCount: 318,
    sku: 'LE-FDW-003',
    isActive: true,
    createdAt: '2024-03-11T09:00:00Z',
    updatedAt: '2024-03-15T12:00:00Z',
  },
  {
    id: 'prod-012',
    name: 'Pet Car Seat Protector',
    description: 'Waterproof, scratch-resistant pet car seat protector with a non-slip base and easy straps. Keeps your car clean from fur, dirt, and spills on every ride.',
    price: 36.99,
    originalPrice: 59.99,
    category: 'Pet Accessories',
    stock: 72,
    images: [
      { id: 'img-12', url: 'https://images.pexels.com/photos/617278/pexels-photo-617278.jpeg?auto=compress&cs=tinysrgb&w=600', isPrimary: true },
    ],
    rating: 4.6,
    reviewCount: 276,
    sku: 'LE-ACC-002',
    isActive: true,
    createdAt: '2024-03-12T09:00:00Z',
    updatedAt: '2024-03-15T12:00:00Z',
  },
];

const initialCategories: Category[] = [
  { id: 'cat-1', name: 'Dog Supplies', productCount: 1 },
  { id: 'cat-2', name: 'Cat Supplies', productCount: 1 },
  { id: 'cat-3', name: 'Pet Beds', productCount: 2 },
  { id: 'cat-4', name: 'Pet Toys', productCount: 2 },
  { id: 'cat-5', name: 'Feeding & Water', productCount: 3 },
  { id: 'cat-6', name: 'Grooming', productCount: 1 },
  { id: 'cat-7', name: 'Pet Accessories', productCount: 2 },
];

export const useProductStore = create<ProductStore>()(
  persist(
    (set, get) => ({
      products: initialProducts,
      categories: initialCategories,

      addProduct: (productData) => {
        const newProduct: Product = {
          ...productData,
          id: `prod-${Date.now()}`,
          rating: 0,
          reviewCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set((state) => ({
          products: [...state.products, newProduct],
        }));
      },

      updateProduct: (id, updates) => {
        set((state) => ({
          products: state.products.map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
          ),
        }));
      },

      deleteProduct: (id) => {
        set((state) => ({
          products: state.products.filter((p) => p.id !== id),
        }));
      },

      getProduct: (id) => {
        return get().products.find((p) => p.id === id);
      },

      getProductsByCategory: (category) => {
        if (category === 'All') return get().products.filter((p) => p.isActive);
        return get().products.filter((p) => p.category === category && p.isActive);
      },

      searchProducts: (query) => {
        const lowercaseQuery = query.toLowerCase();
        return get().products.filter(
          (p) =>
            p.isActive &&
            (p.name.toLowerCase().includes(lowercaseQuery) ||
              p.description.toLowerCase().includes(lowercaseQuery) ||
              p.category.toLowerCase().includes(lowercaseQuery))
        );
      },

      updateStock: (id, quantity) => {
        set((state) => ({
          products: state.products.map((p) =>
            p.id === id ? { ...p, stock: Math.max(0, p.stock + quantity) } : p
          ),
        }));
      },

      getLowStockProducts: () => {
        return get().products.filter((p) => p.stock <= 10 && p.isActive);
      },
    }),
    {
      name: 'luxedge-products',
    }
  )
);

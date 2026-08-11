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
    name: 'ProSound Elite Wireless Earbuds',
    description: 'Experience crystal-clear audio with our premium wireless earbuds featuring active noise cancellation, 36-hour battery life, and seamless Bluetooth 5.3 connectivity. IPX5 water-resistant design makes them perfect for workouts and daily commutes.',
    price: 49.99,
    originalPrice: 89.99,
    category: 'Tech & Gadgets',
    stock: 145,
    images: [
      { id: 'img-1', url: 'https://images.pexels.com/photos/37420781/pexels-photo-37420781.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940', isPrimary: true },
      { id: 'img-2', url: 'https://images.pexels.com/photos/3780681/pexels-photo-3780681.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940', isPrimary: false },
    ],
    rating: 4.8,
    reviewCount: 2341,
    sku: 'LE-EAR-001',
    isActive: true,
    createdAt: '2024-01-10T10:00:00Z',
    updatedAt: '2024-03-15T14:30:00Z',
  },
  {
    id: 'prod-002',
    name: 'LuxeTime Pro Smartwatch',
    description: 'The ultimate smartwatch combining health monitoring, GPS tracking, and premium design. Features heart rate monitoring, sleep tracking, 100+ workout modes, and a stunning AMOLED display. 7-day battery life.',
    price: 79.99,
    originalPrice: 149.99,
    category: 'Tech & Gadgets',
    stock: 89,
    images: [
      { id: 'img-3', url: 'https://images.pexels.com/photos/12564670/pexels-photo-12564670.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940', isPrimary: true },
    ],
    rating: 4.7,
    reviewCount: 1856,
    sku: 'LE-WAT-001',
    isActive: true,
    createdAt: '2024-01-15T09:00:00Z',
    updatedAt: '2024-03-14T11:00:00Z',
  },
  {
    id: 'prod-003',
    name: 'AuraGlow LED Desk Lamp',
    description: 'Transform your workspace with smart ambient lighting. Features 16 million colors, adjustable brightness, and app control. Perfect for creating the ideal mood for work, relaxation, or entertainment.',
    price: 34.99,
    originalPrice: 59.99,
    category: 'Home & Living',
    stock: 234,
    images: [
      { id: 'img-4', url: 'https://images.pexels.com/photos/6167446/pexels-photo-6167446.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', isPrimary: true },
    ],
    rating: 4.9,
    reviewCount: 3102,
    sku: 'LE-LAM-001',
    isActive: true,
    createdAt: '2024-02-01T08:00:00Z',
    updatedAt: '2024-03-10T16:00:00Z',
  },
  {
    id: 'prod-004',
    name: 'VortexFit Resistance Band Set',
    description: 'Professional-grade resistance bands for home workouts. Includes 5 resistance levels, door anchor, ankle straps, and carrying bag. Perfect for strength training, physical therapy, and toning.',
    price: 29.99,
    originalPrice: 54.99,
    category: 'Wellness',
    stock: 8,
    images: [
      { id: 'img-5', url: 'https://images.pexels.com/photos/31541678/pexels-photo-31541678.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940', isPrimary: true },
    ],
    rating: 4.6,
    reviewCount: 1245,
    sku: 'LE-FIT-001',
    isActive: true,
    createdAt: '2024-02-10T12:00:00Z',
    updatedAt: '2024-03-12T09:00:00Z',
  },
  {
    id: 'prod-005',
    name: 'Luxe Minimalist Leather Wallet',
    description: 'Slim, elegant genuine leather wallet with RFID-blocking technology. Features 8 card slots, 2 bill compartments, and a slim profile that fits comfortably in any pocket. Available in black and brown.',
    price: 24.99,
    originalPrice: 44.99,
    category: 'Accessories',
    stock: 178,
    images: [
      { id: 'img-6', url: 'https://images.pexels.com/photos/35336360/pexels-photo-35336360.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', isPrimary: true },
    ],
    rating: 4.8,
    reviewCount: 987,
    sku: 'LE-WAL-001',
    isActive: true,
    createdAt: '2024-02-15T14:00:00Z',
    updatedAt: '2024-03-08T10:00:00Z',
  },
  {
    id: 'prod-006',
    name: 'CloudRest Memory Foam Pillow',
    description: 'Ergonomic cooling gel memory foam pillow designed for optimal neck and spine alignment. Features breathable bamboo cover and adjustable loft. Wake up refreshed every morning.',
    price: 39.99,
    originalPrice: 69.99,
    category: 'Home & Living',
    stock: 5,
    images: [
      { id: 'img-7', url: 'https://images.pexels.com/photos/34171708/pexels-photo-34171708.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', isPrimary: true },
    ],
    rating: 4.9,
    reviewCount: 2876,
    sku: 'LE-PIL-001',
    isActive: true,
    createdAt: '2024-02-20T11:00:00Z',
    updatedAt: '2024-03-15T08:00:00Z',
  },
  {
    id: 'prod-007',
    name: 'TechPro Laptop Stand',
    description: 'Adjustable aluminum laptop stand with ergonomic design. Improves posture, increases airflow, and creates a cleaner workspace. Compatible with all laptops 10-17 inches.',
    price: 32.99,
    originalPrice: 59.99,
    category: 'Tech & Gadgets',
    stock: 67,
    images: [
      { id: 'img-8', url: 'https://images.pexels.com/photos/12880803/pexels-photo-12880803.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940', isPrimary: true },
    ],
    rating: 4.7,
    reviewCount: 1534,
    sku: 'LE-STA-001',
    isActive: true,
    createdAt: '2024-03-01T10:00:00Z',
    updatedAt: '2024-03-14T15:00:00Z',
  },
  {
    id: 'prod-008',
    name: 'Signature Fragrance Collection',
    description: 'Premium unisex fragrance with long-lasting notes of sandalwood, bergamot, and vanilla. Elegant bottle design makes it perfect as a gift. 100ml Eau de Parfum.',
    price: 44.99,
    originalPrice: 79.99,
    category: 'Style',
    stock: 56,
    images: [
      { id: 'img-9', url: 'https://images.pexels.com/photos/36779952/pexels-photo-36779952.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', isPrimary: true },
    ],
    rating: 4.8,
    reviewCount: 765,
    sku: 'LE-FRA-001',
    isActive: true,
    createdAt: '2024-03-05T09:00:00Z',
    updatedAt: '2024-03-15T12:00:00Z',
  },
];

const initialCategories: Category[] = [
  { id: 'cat-1', name: 'Tech & Gadgets', productCount: 3 },
  { id: 'cat-2', name: 'Home & Living', productCount: 2 },
  { id: 'cat-3', name: 'Wellness', productCount: 1 },
  { id: 'cat-4', name: 'Accessories', productCount: 1 },
  { id: 'cat-5', name: 'Style', productCount: 1 },
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

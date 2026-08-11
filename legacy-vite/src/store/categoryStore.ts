import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parentId: string | null; // null = main category
  image?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface CategoryStore {
  categories: Category[];
  addCategory: (category: Omit<Category, 'id' | 'slug' | 'createdAt' | 'updatedAt'>) => void;
  updateCategory: (id: string, updates: Partial<Category>) => void;
  deleteCategory: (id: string) => void;
  toggleCategoryStatus: (id: string) => void;
  getMainCategories: () => Category[];
  getSubCategories: (parentId: string) => Category[];
  getActiveCategories: () => Category[];
  getCategoryById: (id: string) => Category | undefined;
  getCategoryBySlug: (slug: string) => Category | undefined;
  reorderCategories: (categoryIds: string[]) => void;
}

const initialCategories: Category[] = [
  {
    id: 'cat-1',
    name: 'Tech & Gadgets',
    slug: 'tech-gadgets',
    description: 'Latest technology and smart gadgets',
    parentId: null,
    isActive: true,
    sortOrder: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-1-1',
    name: 'Smartwatches',
    slug: 'smartwatches',
    description: 'Smart wearable devices',
    parentId: 'cat-1',
    isActive: true,
    sortOrder: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-1-2',
    name: 'Audio',
    slug: 'audio',
    description: 'Earbuds, headphones, and speakers',
    parentId: 'cat-1',
    isActive: true,
    sortOrder: 2,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-1-3',
    name: 'Accessories',
    slug: 'tech-accessories',
    description: 'Tech accessories and peripherals',
    parentId: 'cat-1',
    isActive: true,
    sortOrder: 3,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-2',
    name: 'Home & Living',
    slug: 'home-living',
    description: 'Home decor and lifestyle products',
    parentId: null,
    isActive: true,
    sortOrder: 2,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-2-1',
    name: 'Lighting',
    slug: 'lighting',
    description: 'Lamps and lighting solutions',
    parentId: 'cat-2',
    isActive: true,
    sortOrder: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-2-2',
    name: 'Bedding',
    slug: 'bedding',
    description: 'Pillows, sheets, and comfort',
    parentId: 'cat-2',
    isActive: true,
    sortOrder: 2,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-3',
    name: 'Wellness',
    slug: 'wellness',
    description: 'Health and fitness products',
    parentId: null,
    isActive: true,
    sortOrder: 3,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-4',
    name: 'Accessories',
    slug: 'accessories',
    description: 'Fashion and personal accessories',
    parentId: null,
    isActive: true,
    sortOrder: 4,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-5',
    name: 'Style',
    slug: 'style',
    description: 'Fashion and grooming',
    parentId: null,
    isActive: true,
    sortOrder: 5,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

const generateSlug = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
};

export const useCategoryStore = create<CategoryStore>()(
  persist(
    (set, get) => ({
      categories: initialCategories,

      addCategory: (categoryData) => {
        const newCategory: Category = {
          ...categoryData,
          id: `cat-${Date.now()}`,
          slug: generateSlug(categoryData.name),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set((state) => ({
          categories: [...state.categories, newCategory],
        }));
      },

      updateCategory: (id, updates) => {
        set((state) => ({
          categories: state.categories.map((cat) =>
            cat.id === id
              ? {
                  ...cat,
                  ...updates,
                  slug: updates.name ? generateSlug(updates.name) : cat.slug,
                  updatedAt: new Date().toISOString(),
                }
              : cat
          ),
        }));
      },

      deleteCategory: (id) => {
        // Also delete all subcategories
        set((state) => ({
          categories: state.categories.filter(
            (cat) => cat.id !== id && cat.parentId !== id
          ),
        }));
      },

      toggleCategoryStatus: (id) => {
        set((state) => ({
          categories: state.categories.map((cat) =>
            cat.id === id
              ? { ...cat, isActive: !cat.isActive, updatedAt: new Date().toISOString() }
              : cat
          ),
        }));
      },

      getMainCategories: () => {
        return get()
          .categories.filter((cat) => cat.parentId === null)
          .sort((a, b) => a.sortOrder - b.sortOrder);
      },

      getSubCategories: (parentId) => {
        return get()
          .categories.filter((cat) => cat.parentId === parentId)
          .sort((a, b) => a.sortOrder - b.sortOrder);
      },

      getActiveCategories: () => {
        return get()
          .categories.filter((cat) => cat.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder);
      },

      getCategoryById: (id) => {
        return get().categories.find((cat) => cat.id === id);
      },

      getCategoryBySlug: (slug) => {
        return get().categories.find((cat) => cat.slug === slug);
      },

      reorderCategories: (categoryIds) => {
        set((state) => ({
          categories: state.categories.map((cat) => {
            const newOrder = categoryIds.indexOf(cat.id);
            if (newOrder !== -1) {
              return { ...cat, sortOrder: newOrder + 1 };
            }
            return cat;
          }),
        }));
      },
    }),
    {
      name: 'luxedge-categories',
    }
  )
);

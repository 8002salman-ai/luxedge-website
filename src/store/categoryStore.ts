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
    name: 'Dog Supplies',
    slug: 'dog-supplies',
    description: 'Harnesses, training & dog essentials',
    parentId: null,
    isActive: true,
    sortOrder: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-1-1',
    name: 'Dogs',
    slug: 'dogs',
    description: 'Everyday dog essentials',
    parentId: 'cat-1',
    isActive: true,
    sortOrder: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-1-2',
    name: 'Puppies',
    slug: 'puppies',
    description: 'Starter supplies for new puppies',
    parentId: 'cat-1',
    isActive: true,
    sortOrder: 2,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-2',
    name: 'Cat Supplies',
    slug: 'cat-supplies',
    description: 'Scratchers, towers & cat must-haves',
    parentId: null,
    isActive: true,
    sortOrder: 2,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-2-1',
    name: 'Cats',
    slug: 'cats',
    description: 'Everyday cat essentials',
    parentId: 'cat-2',
    isActive: true,
    sortOrder: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-2-2',
    name: 'Kittens',
    slug: 'kittens',
    description: 'Starter supplies for new kittens',
    parentId: 'cat-2',
    isActive: true,
    sortOrder: 2,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-3',
    name: 'Pet Beds',
    slug: 'pet-beds',
    description: 'Orthopedic & cozy beds for deep sleep',
    parentId: null,
    isActive: true,
    sortOrder: 3,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-4',
    name: 'Pet Toys',
    slug: 'pet-toys',
    description: 'Interactive toys for play & enrichment',
    parentId: null,
    isActive: true,
    sortOrder: 4,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-5',
    name: 'Feeding & Water',
    slug: 'feeding-water',
    description: 'Bowls, fountains & smart feeders',
    parentId: null,
    isActive: true,
    sortOrder: 5,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-6',
    name: 'Grooming',
    slug: 'grooming',
    description: 'Brushes, clippers & coat care',
    parentId: null,
    isActive: true,
    sortOrder: 6,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-7',
    name: 'Pet Accessories',
    slug: 'pet-accessories',
    description: 'Travel, car care & everyday extras',
    parentId: null,
    isActive: true,
    sortOrder: 7,
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

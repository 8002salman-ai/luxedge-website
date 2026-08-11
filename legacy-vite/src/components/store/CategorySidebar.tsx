import { useState } from 'react';

import { ChevronRight, ChevronDown, Folder } from 'lucide-react';
import { useCategoryStore } from '../../store/categoryStore';

interface CategorySidebarProps {
  currentCategory?: string | null;
  onCategorySelect?: (categorySlug: string | null) => void;
}

export default function CategorySidebar({ currentCategory, onCategorySelect }: CategorySidebarProps) {
  const { getMainCategories, getSubCategories } = useCategoryStore();
  const mainCategories = getMainCategories().filter((c) => c.isActive);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const toggleExpand = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  const handleClick = (slug: string | null) => {
    if (onCategorySelect) {
      onCategorySelect(slug);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-luxe-cream/50">
        <h3 className="font-semibold text-luxe-dark text-sm uppercase tracking-wider">
          Categories
        </h3>
      </div>

      <div className="p-2">
        {/* All Products */}
        <button
          onClick={() => handleClick(null)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
            !currentCategory
              ? 'bg-luxe-gold/10 text-luxe-gold font-medium'
              : 'text-luxe-dark hover:bg-luxe-cream'
          }`}
        >
          <Folder size={16} />
          All Products
        </button>

        {/* Main Categories */}
        {mainCategories.map((category) => {
          const subCategories = getSubCategories(category.id).filter((c) => c.isActive);
          const hasSubCategories = subCategories.length > 0;
          const isExpanded = expandedCategories.has(category.id);
          const isActive = currentCategory === category.slug;

          return (
            <div key={category.id}>
              <div className="flex items-center">
                {hasSubCategories && (
                  <button
                    onClick={() => toggleExpand(category.id)}
                    className="p-1.5 hover:bg-gray-100 rounded"
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} className="text-gray-400" />
                    ) : (
                      <ChevronRight size={14} className="text-gray-400" />
                    )}
                  </button>
                )}
                <button
                  onClick={() => handleClick(category.slug)}
                  className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
                    !hasSubCategories ? 'ml-6' : ''
                  } ${
                    isActive
                      ? 'bg-luxe-gold/10 text-luxe-gold font-medium'
                      : 'text-luxe-dark hover:bg-luxe-cream'
                  }`}
                >
                  {category.name}
                </button>
              </div>

              {/* Subcategories */}
              {hasSubCategories && isExpanded && (
                <div className="ml-6 pl-3 border-l border-gray-100">
                  {subCategories.map((subCategory) => (
                    <button
                      key={subCategory.id}
                      onClick={() => handleClick(subCategory.slug)}
                      className={`w-full text-left block px-3 py-2 rounded-lg text-sm transition-colors ${
                        currentCategory === subCategory.slug
                          ? 'bg-luxe-gold/10 text-luxe-gold font-medium'
                          : 'text-luxe-gray hover:bg-luxe-cream hover:text-luxe-dark'
                      }`}
                    >
                      {subCategory.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

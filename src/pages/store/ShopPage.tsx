import { useState, useMemo } from 'react';
import { Search, ChevronDown, SlidersHorizontal, X, Grid3X3, LayoutList } from 'lucide-react';
import ProductCard from '../../components/store/ProductCard';
import CategorySidebar from '../../components/store/CategorySidebar';
import { useProductStore } from '../../store/productStore';
import { useCategoryStore } from '../../store/categoryStore';

export default function ShopPage() {
  const products = useProductStore((state) => state.products.filter((p) => p.isActive));
  const { getCategoryBySlug, getSubCategories } = useCategoryStore();
  
  const [categorySlug, setCategorySlug] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('featured');
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Get category for display
  const currentCategory = categorySlug ? getCategoryBySlug(categorySlug) : null;

  const filteredProducts = useMemo(() => {
    let result = [...products];

    // Category filter
    if (categorySlug && currentCategory) {
      const categoryNames = new Set<string>();
      categoryNames.add(currentCategory.name);
      
      const subCats = getSubCategories(currentCategory.id);
      subCats.forEach((sub) => categoryNames.add(sub.name));
      
      result = result.filter((p) => {
        return categoryNames.has(p.category) || 
               p.category.toLowerCase().replace(/[^a-z0-9]+/g, '-') === categorySlug;
      });
    }

    // Search filter
    if (search) {
      const query = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.category.toLowerCase().includes(query)
      );
    }

    // Sort
    switch (sortBy) {
      case 'price-low':
        result.sort((a, b) => a.price - b.price);
        break;
      case 'price-high':
        result.sort((a, b) => b.price - a.price);
        break;
      case 'rating':
        result.sort((a, b) => b.rating - a.rating);
        break;
      case 'newest':
        result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
    }

    return result;
  }, [products, categorySlug, currentCategory, search, sortBy, getSubCategories]);

  const handleCategorySelect = (slug: string | null) => {
    setCategorySlug(slug);
    setShowMobileFilters(false);
  };

  return (
    <div>
      {/* Hero */}
      <section className="bg-luxe-black py-12 lg:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-3">
            {currentCategory ? currentCategory.name : 'Our Collection'}
          </p>
          <h1 className="font-serif text-3xl lg:text-4xl font-bold text-white mb-3">
            {currentCategory ? `Shop ${currentCategory.name}` : 'Shop All Products'}
          </h1>
          <p className="text-luxe-silver max-w-xl mx-auto text-sm">
            {currentCategory?.description || 'Every item is handpicked for quality, style, and value.'}
          </p>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-8 lg:py-12 bg-luxe-cream/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-8">
            {/* Sidebar - Desktop */}
            <aside className="hidden lg:block w-64 shrink-0">
              <div className="sticky top-24 space-y-6">
                <CategorySidebar 
                  currentCategory={categorySlug} 
                  onCategorySelect={handleCategorySelect} 
                />
              </div>
            </aside>

            {/* Products */}
            <div className="flex-1">
              {/* Filter Bar */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
                <div className="flex flex-col lg:flex-row gap-4">
                  {/* Search */}
                  <div className="flex-1 relative">
                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-luxe-gray" />
                    <input
                      type="text"
                      placeholder="Search products..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-luxe-cream/50 border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-luxe-gold/20"
                    />
                  </div>

                  <div className="flex gap-3">
                    {/* Mobile filter toggle */}
                    <button
                      onClick={() => setShowMobileFilters(true)}
                      className="lg:hidden flex items-center gap-2 px-4 py-3 bg-luxe-cream/50 rounded-lg text-sm font-medium"
                    >
                      <SlidersHorizontal size={16} />
                      Filters
                    </button>

                    {/* Sort */}
                    <div className="relative">
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="appearance-none bg-luxe-cream/50 border-0 rounded-lg px-4 py-3 pr-10 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-luxe-gold/20 cursor-pointer min-w-[160px]"
                      >
                        <option value="featured">Featured</option>
                        <option value="newest">Newest</option>
                        <option value="price-low">Price: Low to High</option>
                        <option value="price-high">Price: High to Low</option>
                        <option value="rating">Highest Rated</option>
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-luxe-gray pointer-events-none" />
                    </div>

                    {/* View Mode */}
                    <div className="hidden sm:flex items-center bg-luxe-cream/50 rounded-lg p-1">
                      <button
                        onClick={() => setViewMode('grid')}
                        className={`p-2 rounded ${viewMode === 'grid' ? 'bg-white shadow-sm' : ''}`}
                      >
                        <Grid3X3 size={16} className={viewMode === 'grid' ? 'text-luxe-gold' : 'text-luxe-gray'} />
                      </button>
                      <button
                        onClick={() => setViewMode('list')}
                        className={`p-2 rounded ${viewMode === 'list' ? 'bg-white shadow-sm' : ''}`}
                      >
                        <LayoutList size={16} className={viewMode === 'list' ? 'text-luxe-gold' : 'text-luxe-gray'} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Active Filters */}
                {(currentCategory || search) && (
                  <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-100">
                    <span className="text-xs text-luxe-gray">Active filters:</span>
                    {currentCategory && (
                      <button
                        onClick={() => setCategorySlug(null)}
                        className="flex items-center gap-1 px-3 py-1 bg-luxe-gold/10 text-luxe-gold rounded-full text-xs font-medium hover:bg-luxe-gold/20 transition-colors"
                      >
                        {currentCategory.name}
                        <X size={12} />
                      </button>
                    )}
                    {search && (
                      <button
                        onClick={() => setSearch('')}
                        className="flex items-center gap-1 px-3 py-1 bg-luxe-gold/10 text-luxe-gold rounded-full text-xs font-medium hover:bg-luxe-gold/20 transition-colors"
                      >
                        "{search}"
                        <X size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Results count */}
              <p className="text-sm text-luxe-gray mb-4">
                {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''} found
              </p>

              {/* Products Grid */}
              {filteredProducts.length > 0 ? (
                <div className={`grid gap-6 ${
                  viewMode === 'grid' 
                    ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3' 
                    : 'grid-cols-1'
                }`}>
                  {filteredProducts.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
                  <p className="text-4xl mb-4">🔍</p>
                  <p className="text-lg font-medium text-luxe-dark mb-2">No products found</p>
                  <p className="text-sm text-luxe-gray">Try adjusting your search or filters</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Mobile Filters Drawer */}
      {showMobileFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileFilters(false)} />
          <div className="absolute right-0 top-0 h-full w-80 bg-white animate-slide-in-right overflow-y-auto">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-lg">Filters</h2>
              <button onClick={() => setShowMobileFilters(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              <CategorySidebar 
                currentCategory={categorySlug} 
                onCategorySelect={handleCategorySelect} 
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

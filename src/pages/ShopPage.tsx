import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import ProductCard from '../components/ProductCard';
import { products, categories } from '../data/products';
import type { Product } from '../data/products';
import { useInView } from '../hooks/useInView';

interface ShopPageProps {
  onAddToCart: (product: Product) => void;
  onQuickView: (product: Product) => void;
}

export default function ShopPage({ onAddToCart, onQuickView }: ShopPageProps) {
  const [activeCategory, setActiveCategory] = useState('All');
  const [sortBy, setSortBy] = useState('featured');
  const { ref, isInView } = useInView(0.05);

  const filteredProducts = activeCategory === 'All'
    ? [...products]
    : products.filter(p => p.category === activeCategory);

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    switch (sortBy) {
      case 'price-low': return a.price - b.price;
      case 'price-high': return b.price - a.price;
      case 'rating': return b.rating - a.rating;
      case 'reviews': return b.reviews - a.reviews;
      default: return 0;
    }
  });

  return (
    <div>
      {/* Hero Banner */}
      <section className="bg-luxe-black py-16 lg:py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '40px 40px'
          }} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Our Collection</p>
          <h1 className="font-serif text-4xl lg:text-5xl font-bold text-white mb-4">
            Shop All Products
          </h1>
          <p className="text-luxe-silver max-w-xl mx-auto">
            Every item is handpicked for quality, style, and value. Browse our curated collection and find your next favorite thing.
          </p>
        </div>
      </section>

      {/* Filters & Products */}
      <section className="py-12 lg:py-16 bg-luxe-cream/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Filter Bar */}
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 mb-10">
            {/* Categories */}
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wider transition-all duration-300 ${
                    activeCategory === cat
                      ? 'bg-luxe-black text-white'
                      : 'bg-white text-luxe-gray hover:bg-luxe-black hover:text-white border border-gray-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Sort */}
            <div className="flex items-center gap-4">
              <span className="text-xs text-luxe-gray">{sortedProducts.length} products</span>
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="appearance-none bg-white border border-gray-200 rounded-lg px-4 py-2 pr-8 text-xs font-medium text-luxe-dark focus:outline-none focus:border-luxe-gold cursor-pointer"
                >
                  <option value="featured">Featured</option>
                  <option value="price-low">Price: Low to High</option>
                  <option value="price-high">Price: High to Low</option>
                  <option value="rating">Highest Rated</option>
                  <option value="reviews">Most Reviews</option>
                </select>
                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-luxe-gray pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Products Grid */}
          <div
            ref={ref}
            className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 ${
              isInView ? 'animate-fade-in-up' : 'opacity-0'
            }`}
          >
            {sortedProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onAddToCart={onAddToCart}
                onQuickView={onQuickView}
              />
            ))}
          </div>

          {sortedProducts.length === 0 && (
            <div className="text-center py-20">
              <p className="text-2xl mb-2">🔍</p>
              <p className="text-luxe-gray">No products found in this category.</p>
            </div>
          )}
        </div>
      </section>

      {/* Value Props */}
      <section className="bg-white py-16 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                emoji: '📦',
                title: 'Free Shipping on $50+',
                desc: 'No surprises at checkout. Spend $50 and shipping is on us.',
              },
              {
                emoji: '🔄',
                title: '30-Day Easy Returns',
                desc: 'Changed your mind? No problem. Returns are free and hassle-free.',
              },
              {
                emoji: '🔒',
                title: 'Secure Payment',
                desc: '256-bit SSL encryption. Your data is always safe with us.',
              },
            ].map((item, i) => (
              <div key={i} className="text-center p-6">
                <span className="text-3xl mb-3 block">{item.emoji}</span>
                <h3 className="font-semibold text-luxe-dark mb-2">{item.title}</h3>
                <p className="text-sm text-luxe-gray">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

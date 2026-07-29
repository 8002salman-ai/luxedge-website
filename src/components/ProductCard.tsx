import { Star, ShoppingBag, Heart, Eye } from 'lucide-react';
import type { Product } from '../data/products';

interface ProductCardProps {
  product: Product;
  onAddToCart: (product: Product) => void;
  onQuickView: (product: Product) => void;
}

export default function ProductCard({ product, onAddToCart, onQuickView }: ProductCardProps) {
  const discount = Math.round((1 - product.price / product.originalPrice) * 100);

  return (
    <div className="group relative bg-white rounded-xl overflow-hidden border border-gray-100 hover:border-luxe-gold/30 hover:shadow-[0_8px_40px_rgba(201,169,110,0.1)] transition-all duration-500">
      {/* Image */}
      <div className="relative aspect-square overflow-hidden bg-luxe-cream">
        <img
          src={product.image}
          alt={product.name}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
          loading="lazy"
        />

        {/* Badge */}
        {product.badge && (
          <span className="absolute top-3 left-3 px-3 py-1 bg-luxe-black text-white text-[10px] uppercase tracking-wider font-semibold rounded-full">
            {product.badge}
          </span>
        )}

        {/* Discount */}
        <span className="absolute top-3 right-3 px-2 py-1 bg-luxe-danger text-white text-[10px] font-bold rounded-full">
          -{discount}%
        </span>

        {/* Hover Actions */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all duration-300 flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="flex gap-2 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
            <button
              onClick={() => onAddToCart(product)}
              className="p-3 bg-white rounded-full shadow-lg hover:bg-luxe-gold hover:text-white transition-all duration-300"
              title="Add to Cart"
            >
              <ShoppingBag size={18} />
            </button>
            <button
              onClick={() => onQuickView(product)}
              className="p-3 bg-white rounded-full shadow-lg hover:bg-luxe-gold hover:text-white transition-all duration-300"
              title="Quick View"
            >
              <Eye size={18} />
            </button>
            <button
              className="p-3 bg-white rounded-full shadow-lg hover:bg-luxe-gold hover:text-white transition-all duration-300"
              title="Add to Wishlist"
            >
              <Heart size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <p className="text-[10px] text-luxe-gold uppercase tracking-widest font-semibold mb-1">
          {product.category}
        </p>
        <h3 className="text-sm font-semibold text-luxe-dark leading-tight mb-2 line-clamp-2 min-h-[2.5rem]">
          {product.name}
        </h3>

        {/* Rating */}
        <div className="flex items-center gap-1 mb-3">
          <div className="flex">
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                size={12}
                className={i < Math.round(product.rating) ? 'text-luxe-gold fill-luxe-gold' : 'text-gray-200'}
              />
            ))}
          </div>
          <span className="text-[11px] text-luxe-gray ml-1">
            {product.rating} ({product.reviews.toLocaleString()})
          </span>
        </div>

        {/* Price */}
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-luxe-dark">${product.price}</span>
          <span className="text-sm text-luxe-gray line-through">${product.originalPrice}</span>
        </div>

        {/* Add to Cart Button */}
        <button
          onClick={() => onAddToCart(product)}
          className="mt-3 w-full py-2.5 bg-luxe-black hover:bg-luxe-gold text-white text-xs uppercase tracking-wider font-semibold rounded-lg transition-all duration-300 btn-shimmer"
        >
          Add to Cart
        </button>
      </div>
    </div>
  );
}

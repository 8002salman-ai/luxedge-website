import { Link } from 'react-router-dom';
import { Star, ShoppingBag, Heart, Eye } from 'lucide-react';
import type { Product } from '../../types';
import { useCartStore } from '../../store/cartStore';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const addToCart = useCartStore((state) => state.addToCart);
  const { isAuthenticated } = useAuthStore();
  const addNotification = useNotificationStore((state) => state.addNotification);
  
  const discount = Math.round((1 - product.price / product.originalPrice) * 100);
  const primaryImage = product.images.find((img) => img.isPrimary)?.url || product.images[0]?.url;

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      addNotification({ type: 'warning', message: 'Please log in to add items to cart' });
      return;
    }
    addToCart(product);
    addNotification({ type: 'success', message: `${product.name} added to cart!` });
  };

  return (
    <Link
      to={`/product/${product.id}`}
      className="group relative bg-white rounded-xl overflow-hidden border border-gray-100 hover:border-luxe-gold/30 hover:shadow-xl transition-all duration-500"
    >
      {/* Image */}
      <div className="relative aspect-square overflow-hidden bg-luxe-cream">
        <img
          src={primaryImage}
          alt={product.name}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
          loading="lazy"
        />

        {/* Badges */}
        {product.stock <= 10 && product.stock > 0 && (
          <span className="absolute top-3 left-3 px-2 py-1 bg-amber-500 text-white text-[10px] uppercase tracking-wider font-semibold rounded-full">
            Low Stock
          </span>
        )}
        {product.stock === 0 && (
          <span className="absolute top-3 left-3 px-2 py-1 bg-red-500 text-white text-[10px] uppercase tracking-wider font-semibold rounded-full">
            Sold Out
          </span>
        )}
        <span className="absolute top-3 right-3 px-2 py-1 bg-luxe-danger text-white text-[10px] font-bold rounded-full">
          -{discount}%
        </span>

        {/* Hover Actions */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all duration-300 flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="flex gap-2 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
            <button
              onClick={handleAddToCart}
              className="p-3 bg-white rounded-full shadow-lg hover:bg-luxe-gold hover:text-white transition-all"
              title="Add to Cart"
            >
              <ShoppingBag size={18} />
            </button>
            <button
              onClick={(e) => e.preventDefault()}
              className="p-3 bg-white rounded-full shadow-lg hover:bg-luxe-gold hover:text-white transition-all"
              title="Quick View"
            >
              <Eye size={18} />
            </button>
            <button
              onClick={(e) => e.preventDefault()}
              className="p-3 bg-white rounded-full shadow-lg hover:bg-luxe-gold hover:text-white transition-all"
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
            ({product.reviewCount.toLocaleString()})
          </span>
        </div>

        {/* Price */}
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-luxe-dark">${product.price.toFixed(2)}</span>
          <span className="text-sm text-luxe-gray line-through">${product.originalPrice.toFixed(2)}</span>
        </div>

        {/* Stock indicator */}
        {product.stock > 0 && product.stock <= 10 && (
          <p className="text-[10px] text-amber-600 mt-2">Only {product.stock} left in stock!</p>
        )}
      </div>
    </Link>
  );
}

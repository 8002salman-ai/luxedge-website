import { X, Star, ShoppingBag, Heart, Truck, Shield, RotateCcw } from 'lucide-react';
import type { Product } from '../data/products';
import { useState } from 'react';

interface QuickViewProps {
  product: Product | null;
  onClose: () => void;
  onAddToCart: (product: Product) => void;
}

export default function QuickView({ product, onClose, onAddToCart }: QuickViewProps) {
  const [quantity, setQuantity] = useState(1);

  if (!product) return null;

  const discount = Math.round((1 - product.price / product.originalPrice) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto animate-scale-in shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-white rounded-full shadow-md hover:bg-luxe-cream transition-colors"
        >
          <X size={18} />
        </button>

        <div className="grid md:grid-cols-2">
          {/* Image */}
          <div className="aspect-square bg-luxe-cream relative">
            <img
              src={product.image}
              alt={product.name}
              className="w-full h-full object-cover"
            />
            {product.badge && (
              <span className="absolute top-4 left-4 px-3 py-1 bg-luxe-black text-white text-[10px] uppercase tracking-wider font-semibold rounded-full">
                {product.badge}
              </span>
            )}
          </div>

          {/* Details */}
          <div className="p-6 lg:p-8 flex flex-col">
            <p className="text-[10px] text-luxe-gold uppercase tracking-widest font-semibold mb-2">
              {product.category}
            </p>
            <h2 className="font-serif text-2xl font-bold text-luxe-dark mb-3">
              {product.name}
            </h2>

            {/* Rating */}
            <div className="flex items-center gap-2 mb-4">
              <div className="flex">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    size={14}
                    className={i < Math.round(product.rating) ? 'text-luxe-gold fill-luxe-gold' : 'text-gray-200'}
                  />
                ))}
              </div>
              <span className="text-sm text-luxe-gray">
                {product.rating} · {product.reviews.toLocaleString()} reviews
              </span>
            </div>

            {/* Price */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-3xl font-bold text-luxe-dark">${product.price}</span>
              <span className="text-lg text-luxe-gray line-through">${product.originalPrice}</span>
              <span className="px-2 py-0.5 bg-red-50 text-luxe-danger text-xs font-bold rounded">
                SAVE {discount}%
              </span>
            </div>

            <p className="text-sm text-luxe-gray leading-relaxed mb-6">
              {product.description}
            </p>

            {/* Quantity & Add to Cart */}
            <div className="flex gap-3 mb-6">
              <div className="flex items-center border border-gray-200 rounded-lg">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="px-3 py-2 text-luxe-gray hover:text-luxe-dark transition-colors"
                >
                  −
                </button>
                <span className="px-3 py-2 text-sm font-semibold min-w-[2rem] text-center">
                  {quantity}
                </span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="px-3 py-2 text-luxe-gray hover:text-luxe-dark transition-colors"
                >
                  +
                </button>
              </div>
              <button
                onClick={() => {
                  onAddToCart(product);
                  onClose();
                }}
                className="flex-1 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg transition-all duration-300 flex items-center justify-center gap-2 uppercase text-sm tracking-wider btn-shimmer"
              >
                <ShoppingBag size={16} />
                Add to Cart
              </button>
              <button className="p-3 border border-gray-200 rounded-lg hover:border-luxe-gold hover:text-luxe-gold transition-colors">
                <Heart size={18} />
              </button>
            </div>

            {/* Trust Signals */}
            <div className="space-y-3 pt-4 border-t border-gray-100 mt-auto">
              <div className="flex items-center gap-3 text-sm text-luxe-gray">
                <Truck size={16} className="text-luxe-gold shrink-0" />
                <span>Free shipping on orders over $50</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-luxe-gray">
                <RotateCcw size={16} className="text-luxe-gold shrink-0" />
                <span>30-day hassle-free returns</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-luxe-gray">
                <Shield size={16} className="text-luxe-gold shrink-0" />
                <span>Quality guaranteed or money back</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

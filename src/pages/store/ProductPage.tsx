import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Star, ShoppingBag, Heart, Minus, Plus, Truck, Shield, RotateCcw, ChevronLeft } from 'lucide-react';
import { useProductStore } from '../../store/productStore';
import { useCartStore } from '../../store/cartStore';
import { useReviewStore } from '../../store/reviewStore';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const product = useProductStore((state) => state.getProduct(id || ''));
  const reviews = useReviewStore((state) => state.getApprovedReviews(id || ''));
  const addReview = useReviewStore((state) => state.addReview);
  const addToCart = useCartStore((state) => state.addToCart);
  const { isAuthenticated, user } = useAuthStore();
  const addNotification = useNotificationStore((state) => state.addNotification);

  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);
  const [reviewForm, setReviewForm] = useState({ rating: 5, title: '', comment: '' });
  const [showReviewForm, setShowReviewForm] = useState(false);

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-4">😕</p>
          <p className="text-lg font-medium text-luxe-dark mb-2">Product not found</p>
          <Link to="/shop" className="text-luxe-gold hover:underline">
            Back to Shop
          </Link>
        </div>
      </div>
    );
  }

  const discount = Math.round((1 - product.price / product.originalPrice) * 100);

  const handleAddToCart = () => {
    if (!isAuthenticated) {
      addNotification({ type: 'warning', message: 'Please log in to add items to cart' });
      navigate('/login');
      return;
    }
    addToCart(product, quantity);
    addNotification({ type: 'success', message: `${product.name} added to cart!` });
  };

  const handleSubmitReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated || !user) {
      addNotification({ type: 'warning', message: 'Please log in to submit a review' });
      return;
    }

    addReview({
      productId: product.id,
      productName: product.name,
      userId: user.id,
      userName: user.name,
      rating: reviewForm.rating,
      title: reviewForm.title,
      comment: reviewForm.comment,
    });

    addNotification({ type: 'success', message: 'Review submitted! It will be visible after approval.' });
    setReviewForm({ rating: 5, title: '', comment: '' });
    setShowReviewForm(false);
  };

  return (
    <div className="py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <Link to="/shop" className="inline-flex items-center gap-2 text-sm text-luxe-gray hover:text-luxe-gold mb-8">
          <ChevronLeft size={16} />
          Back to Shop
        </Link>

        {/* Product Details */}
        <div className="grid lg:grid-cols-2 gap-12">
          {/* Images */}
          <div>
            <div className="aspect-square rounded-2xl overflow-hidden bg-luxe-cream mb-4">
              <img
                src={product.images[selectedImage]?.url}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            </div>
            {product.images.length > 1 && (
              <div className="flex gap-3">
                {product.images.map((img, i) => (
                  <button
                    key={img.id}
                    onClick={() => setSelectedImage(i)}
                    className={`w-20 h-20 rounded-lg overflow-hidden border-2 transition-all ${
                      selectedImage === i ? 'border-luxe-gold' : 'border-transparent hover:border-gray-200'
                    }`}
                  >
                    <img src={img.url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div>
            <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-2">
              {product.category}
            </p>
            <h1 className="font-serif text-3xl lg:text-4xl font-bold text-luxe-dark mb-4">
              {product.name}
            </h1>

            {/* Rating */}
            <div className="flex items-center gap-3 mb-6">
              <div className="flex">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    size={16}
                    className={i < Math.round(product.rating) ? 'text-luxe-gold fill-luxe-gold' : 'text-gray-200'}
                  />
                ))}
              </div>
              <span className="text-sm text-luxe-gray">
                {product.rating} · {product.reviewCount.toLocaleString()} reviews
              </span>
            </div>

            {/* Price */}
            <div className="flex items-center gap-4 mb-6">
              <span className="text-3xl font-bold text-luxe-dark">${product.price.toFixed(2)}</span>
              <span className="text-xl text-luxe-gray line-through">${product.originalPrice.toFixed(2)}</span>
              <span className="px-3 py-1 bg-red-100 text-red-600 text-sm font-bold rounded-full">
                SAVE {discount}%
              </span>
            </div>

            <p className="text-luxe-gray leading-relaxed mb-8">{product.description}</p>

            {/* Stock */}
            {product.stock > 0 ? (
              product.stock <= 10 ? (
                <p className="text-amber-600 text-sm font-medium mb-4">
                  ⚡ Only {product.stock} left in stock - order soon!
                </p>
              ) : (
                <p className="text-green-600 text-sm font-medium mb-4">✓ In Stock</p>
              )
            ) : (
              <p className="text-red-600 text-sm font-medium mb-4">✕ Out of Stock</p>
            )}

            {/* Quantity & Add to Cart */}
            <div className="flex flex-wrap gap-4 mb-8">
              <div className="flex items-center border border-gray-200 rounded-lg">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="p-3 hover:bg-gray-50 transition-colors"
                >
                  <Minus size={16} />
                </button>
                <span className="px-4 py-3 text-sm font-semibold min-w-[3rem] text-center">
                  {quantity}
                </span>
                <button
                  onClick={() => setQuantity(Math.min(product.stock, quantity + 1))}
                  className="p-3 hover:bg-gray-50 transition-colors"
                >
                  <Plus size={16} />
                </button>
              </div>

              <button
                onClick={handleAddToCart}
                disabled={product.stock === 0}
                className="flex-1 min-w-[200px] py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ShoppingBag size={18} />
                {product.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
              </button>

              <button className="p-3 border border-gray-200 rounded-lg hover:border-luxe-gold hover:text-luxe-gold transition-colors">
                <Heart size={18} />
              </button>
            </div>

            {/* Trust Signals */}
            <div className="space-y-3 pt-6 border-t border-gray-100">
              <div className="flex items-center gap-3 text-sm text-luxe-gray">
                <Truck size={18} className="text-luxe-gold" />
                Free shipping on orders over $50
              </div>
              <div className="flex items-center gap-3 text-sm text-luxe-gray">
                <RotateCcw size={18} className="text-luxe-gold" />
                30-day hassle-free returns
              </div>
              <div className="flex items-center gap-3 text-sm text-luxe-gray">
                <Shield size={18} className="text-luxe-gold" />
                Quality guaranteed or money back
              </div>
            </div>
          </div>
        </div>

        {/* Reviews Section */}
        <div className="mt-16 pt-16 border-t border-gray-100">
          <div className="flex items-center justify-between mb-8">
            <h2 className="font-serif text-2xl font-bold text-luxe-dark">Customer Reviews</h2>
            {isAuthenticated && (
              <button
                onClick={() => setShowReviewForm(!showReviewForm)}
                className="px-4 py-2 bg-luxe-black text-white text-sm font-medium rounded-lg hover:bg-luxe-gold transition-colors"
              >
                Write a Review
              </button>
            )}
          </div>

          {/* Review Form */}
          {showReviewForm && (
            <form onSubmit={handleSubmitReview} className="bg-luxe-cream/50 rounded-xl p-6 mb-8">
              <div className="grid sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                    Rating
                  </label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setReviewForm({ ...reviewForm, rating: star })}
                      >
                        <Star
                          size={24}
                          className={star <= reviewForm.rating ? 'text-luxe-gold fill-luxe-gold' : 'text-gray-300'}
                        />
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                    Title
                  </label>
                  <input
                    type="text"
                    required
                    value={reviewForm.title}
                    onChange={(e) => setReviewForm({ ...reviewForm, title: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-luxe-gold"
                    placeholder="Summary of your review"
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                  Your Review
                </label>
                <textarea
                  required
                  rows={4}
                  value={reviewForm.comment}
                  onChange={(e) => setReviewForm({ ...reviewForm, comment: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-luxe-gold resize-none"
                  placeholder="Share your experience with this product..."
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="px-6 py-2 bg-luxe-gold text-white font-medium rounded-lg hover:bg-luxe-gold-dark transition-colors"
                >
                  Submit Review
                </button>
                <button
                  type="button"
                  onClick={() => setShowReviewForm(false)}
                  className="px-6 py-2 text-luxe-gray hover:text-luxe-dark transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Reviews List */}
          {reviews.length > 0 ? (
            <div className="space-y-6">
              {reviews.map((review) => (
                <div key={review.id} className="border-b border-gray-100 pb-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-luxe-gold/10 rounded-full flex items-center justify-center">
                      <span className="text-sm font-bold text-luxe-gold">
                        {review.userName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-luxe-dark">{review.userName}</p>
                      <div className="flex">
                        {[...Array(5)].map((_, i) => (
                          <Star
                            key={i}
                            size={12}
                            className={i < review.rating ? 'text-luxe-gold fill-luxe-gold' : 'text-gray-200'}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <h4 className="font-semibold text-luxe-dark mb-1">{review.title}</h4>
                  <p className="text-sm text-luxe-gray">{review.comment}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-luxe-gray py-8">No reviews yet. Be the first to review!</p>
          )}
        </div>
      </div>
    </div>
  );
}

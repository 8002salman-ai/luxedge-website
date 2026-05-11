import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Review, ReviewStatus } from '../types';

interface ReviewStore {
  reviews: Review[];
  addReview: (review: Omit<Review, 'id' | 'createdAt' | 'status'>) => void;
  updateReviewStatus: (reviewId: string, status: ReviewStatus) => void;
  deleteReview: (reviewId: string) => void;
  getReviewsByProduct: (productId: string) => Review[];
  getReviewsByUser: (userId: string) => Review[];
  getApprovedReviews: (productId: string) => Review[];
  getPendingReviews: () => Review[];
  getAllReviews: () => Review[];
}

const sampleReviews: Review[] = [
  {
    id: 'rev-001',
    productId: 'prod-001',
    productName: 'ProSound Elite Wireless Earbuds',
    userId: 'user-001',
    userName: 'John Smith',
    rating: 5,
    title: 'Best earbuds I\'ve ever owned!',
    comment: 'The sound quality is incredible and the noise cancellation actually works. Battery life is amazing too - I only charge them twice a week.',
    status: 'approved',
    createdAt: '2024-03-05T14:30:00Z',
  },
  {
    id: 'rev-002',
    productId: 'prod-002',
    productName: 'LuxeTime Pro Smartwatch',
    userId: 'user-002',
    userName: 'Sarah Johnson',
    rating: 4,
    title: 'Great features, minor learning curve',
    comment: 'Love all the health tracking features. Took a day to figure out all the settings but now I can\'t live without it.',
    status: 'approved',
    createdAt: '2024-03-08T10:15:00Z',
  },
  {
    id: 'rev-003',
    productId: 'prod-003',
    productName: 'AuraGlow LED Desk Lamp',
    userId: 'user-001',
    userName: 'John Smith',
    rating: 5,
    title: 'Perfect ambient lighting',
    comment: 'Exactly what I was looking for. The app control is smooth and the colors are vibrant. My workspace looks so much better now.',
    status: 'approved',
    createdAt: '2024-03-10T16:45:00Z',
  },
  {
    id: 'rev-004',
    productId: 'prod-005',
    productName: 'Luxe Minimalist Leather Wallet',
    userId: 'user-003',
    userName: 'Mike Williams',
    rating: 5,
    title: 'Sleek and functional',
    comment: 'Finally a wallet that\'s actually slim! The leather quality is excellent and it has just enough card slots.',
    status: 'pending',
    createdAt: '2024-03-14T09:00:00Z',
  },
  {
    id: 'rev-005',
    productId: 'prod-006',
    productName: 'CloudRest Memory Foam Pillow',
    userId: 'user-002',
    userName: 'Sarah Johnson',
    rating: 5,
    title: 'Sleep has never been better',
    comment: 'I wake up without neck pain now. The cooling feature actually works. Best pillow investment ever.',
    status: 'pending',
    createdAt: '2024-03-15T08:30:00Z',
  },
];

export const useReviewStore = create<ReviewStore>()(
  persist(
    (set, get) => ({
      reviews: sampleReviews,

      addReview: (reviewData) => {
        const newReview: Review = {
          ...reviewData,
          id: `rev-${Date.now()}`,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };

        set((state) => ({
          reviews: [newReview, ...state.reviews],
        }));
      },

      updateReviewStatus: (reviewId, status) => {
        set((state) => ({
          reviews: state.reviews.map((review) =>
            review.id === reviewId ? { ...review, status } : review
          ),
        }));
      },

      deleteReview: (reviewId) => {
        set((state) => ({
          reviews: state.reviews.filter((review) => review.id !== reviewId),
        }));
      },

      getReviewsByProduct: (productId) => {
        return get().reviews.filter((review) => review.productId === productId);
      },

      getReviewsByUser: (userId) => {
        return get().reviews.filter((review) => review.userId === userId);
      },

      getApprovedReviews: (productId) => {
        return get().reviews.filter(
          (review) => review.productId === productId && review.status === 'approved'
        );
      },

      getPendingReviews: () => {
        return get().reviews.filter((review) => review.status === 'pending');
      },

      getAllReviews: () => {
        return get().reviews;
      },
    }),
    {
      name: 'luxedge-reviews',
    }
  )
);

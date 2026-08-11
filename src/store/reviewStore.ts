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
    productName: 'Orthopedic Memory Foam Dog Bed',
    userId: 'user-001',
    userName: 'John Smith',
    rating: 5,
    title: 'Best dog bed we\'ve ever owned!',
    comment: 'My lab sleeps through the whole night now. The memory foam is firm but comfortable and the cover washes perfectly.',
    status: 'approved',
    createdAt: '2024-03-05T14:30:00Z',
  },
  {
    id: 'rev-002',
    productId: 'prod-002',
    productName: 'Interactive Cat Feather Toy',
    userId: 'user-002',
    userName: 'Sarah Johnson',
    rating: 4,
    title: 'Great toy, keeps my cat busy',
    comment: 'My cat can\'t get enough of it. It runs for hours and the motion sensor is clever. Batteries drain a bit fast, but worth it.',
    status: 'approved',
    createdAt: '2024-03-08T10:15:00Z',
  },
  {
    id: 'rev-003',
    productId: 'prod-003',
    productName: 'Stainless Steel Pet Water Fountain',
    userId: 'user-001',
    userName: 'John Smith',
    rating: 5,
    title: 'My cat drinks way more now',
    comment: 'Exactly what I was hoping for. The pump is nearly silent and the triple filter keeps the water fresh all day. Highly recommend.',
    status: 'approved',
    createdAt: '2024-03-10T16:45:00Z',
  },
  {
    id: 'rev-004',
    productId: 'prod-005',
    productName: 'Self-Cleaning Slicker Grooming Brush',
    userId: 'user-003',
    userName: 'Mike Williams',
    rating: 5,
    title: 'Sleek and functional',
    comment: 'Finally a brush that\'s actually easy to clean! Shedding is finally under control and my dog loves the massage feeling.',
    status: 'pending',
    createdAt: '2024-03-14T09:00:00Z',
  },
  {
    id: 'rev-005',
    productId: 'prod-006',
    productName: 'Premium Cat Scratching Post',
    userId: 'user-002',
    userName: 'Sarah Johnson',
    rating: 5,
    title: 'Sofa is finally safe',
    comment: 'My cat uses it all the time and loves the perch on top. The sisal is sturdy and it hasn\'t wobbled at all. Best purchase ever.',
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

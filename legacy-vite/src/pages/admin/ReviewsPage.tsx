import { useState } from 'react';
import { Search, Check, X, Trash2, Star, MessageSquare } from 'lucide-react';
import { useReviewStore } from '../../store/reviewStore';
import { useNotificationStore } from '../../store/notificationStore';
import Modal from '../../components/common/Modal';
import type { ReviewStatus } from '../../types';
import { format } from 'date-fns';

const statusColors: Record<ReviewStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function ReviewsPage() {
  const { reviews, updateReviewStatus, deleteReview } = useReviewStore();
  const addNotification = useNotificationStore((state) => state.addNotification);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filteredReviews = reviews.filter((review) => {
    const matchesSearch =
      review.productName.toLowerCase().includes(search.toLowerCase()) ||
      review.userName.toLowerCase().includes(search.toLowerCase()) ||
      review.comment.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || review.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const pendingCount = reviews.filter((r) => r.status === 'pending').length;

  const handleApprove = (reviewId: string) => {
    updateReviewStatus(reviewId, 'approved');
    addNotification({ type: 'success', message: 'Review approved' });
  };

  const handleReject = (reviewId: string) => {
    updateReviewStatus(reviewId, 'rejected');
    addNotification({ type: 'success', message: 'Review rejected' });
  };

  const handleDelete = (reviewId: string) => {
    deleteReview(reviewId);
    addNotification({ type: 'success', message: 'Review deleted' });
    setDeleteConfirm(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reviews</h1>
          <p className="text-gray-500 text-sm">Manage customer reviews and ratings</p>
        </div>
        {pendingCount > 0 && (
          <span className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-50 text-yellow-700 rounded-lg text-sm font-medium">
            <MessageSquare size={16} />
            {pendingCount} pending review{pendingCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search reviews..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {/* Reviews List */}
      <div className="space-y-4">
        {filteredReviews.map((review) => (
          <div
            key={review.id}
            className={`bg-white rounded-xl border p-5 ${
              review.status === 'pending' ? 'border-yellow-200' : 'border-gray-100'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-admin-primary/10 rounded-full flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-admin-primary">
                    {review.userName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{review.userName}</p>
                  <p className="text-xs text-gray-500">
                    Reviewed: <span className="text-admin-primary">{review.productName}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {format(new Date(review.createdAt), 'MMM d, yyyy · h:mm a')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 text-xs font-semibold rounded-full capitalize ${statusColors[review.status]}`}>
                  {review.status}
                </span>
              </div>
            </div>

            {/* Rating */}
            <div className="flex items-center gap-2 mb-3">
              <div className="flex">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    size={14}
                    className={i < review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}
                  />
                ))}
              </div>
              <span className="text-sm font-medium text-gray-700">{review.rating}/5</span>
            </div>

            {/* Review Content */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <h4 className="font-semibold text-gray-900 mb-1">{review.title}</h4>
              <p className="text-sm text-gray-600">{review.comment}</p>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {review.status === 'pending' && (
                <>
                  <button
                    onClick={() => handleApprove(review.id)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-green-50 text-green-600 hover:bg-green-100 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Check size={14} />
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(review.id)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-sm font-medium transition-colors"
                  >
                    <X size={14} />
                    Reject
                  </button>
                </>
              )}
              <button
                onClick={() => setDeleteConfirm(review.id)}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-50 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium transition-colors ml-auto"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredReviews.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <Star size={48} className="mx-auto text-gray-200 mb-4" />
          <p className="text-gray-500">No reviews found</p>
        </div>
      )}

      {/* Delete Confirmation */}
      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Review" size="sm">
        <div className="p-6">
          <p className="text-gray-600 mb-6">Are you sure you want to delete this review? This action cannot be undone.</p>
          <div className="flex gap-3">
            <button
              onClick={() => handleDelete(deleteConfirm!)}
              className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setDeleteConfirm(null)}
              className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

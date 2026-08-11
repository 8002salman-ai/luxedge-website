import { Link } from 'react-router-dom';
import { Package, ChevronRight } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useOrderStore } from '../../store/orderStore';
import { format } from 'date-fns';

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  shipped: 'bg-purple-100 text-purple-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function OrdersPage() {
  const { user } = useAuthStore();
  const orders = useOrderStore((state) => state.getOrdersByUser(user?.id || ''));

  if (orders.length === 0) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center py-20">
        <div className="text-center">
          <Package size={64} className="mx-auto text-gray-200 mb-6" />
          <h1 className="text-2xl font-bold text-luxe-dark mb-2">No Orders Yet</h1>
          <p className="text-luxe-gray mb-8">Start shopping to see your orders here.</p>
          <Link
            to="/shop"
            className="inline-flex items-center gap-2 px-8 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg transition-all"
          >
            Shop Now
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="py-12 bg-luxe-cream/30 min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="font-serif text-3xl font-bold text-luxe-dark mb-8">My Orders</h1>

        <div className="space-y-4">
          {orders.map((order) => (
            <div key={order.id} className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                <div>
                  <p className="font-semibold text-luxe-dark">Order #{order.id}</p>
                  <p className="text-sm text-luxe-gray">
                    {format(new Date(order.createdAt), 'MMM d, yyyy · h:mm a')}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${statusColors[order.status]}`}
                >
                  {order.status}
                </span>
              </div>

              <div className="border-t border-gray-100 pt-4">
                {order.items.slice(0, 2).map((item) => (
                  <div key={item.productId} className="flex items-center gap-4 mb-3">
                    <img
                      src={item.productImage}
                      alt={item.productName}
                      className="w-16 h-16 object-cover rounded-lg"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-luxe-dark truncate">{item.productName}</p>
                      <p className="text-xs text-luxe-gray">Qty: {item.quantity}</p>
                    </div>
                    <p className="text-sm font-semibold text-luxe-dark">
                      ${(item.price * item.quantity).toFixed(2)}
                    </p>
                  </div>
                ))}
                {order.items.length > 2 && (
                  <p className="text-xs text-luxe-gray">+{order.items.length - 2} more items</p>
                )}
              </div>

              <div className="border-t border-gray-100 pt-4 mt-4 flex items-center justify-between">
                <p className="font-semibold text-luxe-dark">
                  Total: <span className="text-luxe-gold">${order.total.toFixed(2)}</span>
                </p>
                <Link
                  to={`/orders/${order.id}`}
                  className="flex items-center gap-1 text-sm text-luxe-gold hover:text-luxe-gold-dark transition-colors"
                >
                  View Details
                  <ChevronRight size={14} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

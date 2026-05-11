import { Link } from 'react-router-dom';
import {
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useOrderStore } from '../../store/orderStore';
import { useProductStore } from '../../store/productStore';
import { useAuthStore } from '../../store/authStore';
import { useReviewStore } from '../../store/reviewStore';


const salesData = [
  { name: 'Mon', sales: 400 },
  { name: 'Tue', sales: 300 },
  { name: 'Wed', sales: 500 },
  { name: 'Thu', sales: 280 },
  { name: 'Fri', sales: 590 },
  { name: 'Sat', sales: 800 },
  { name: 'Sun', sales: 450 },
];

export default function DashboardPage() {
  const revenue = useOrderStore((state) => state.getTotalRevenue());
  const orderStats = useOrderStore((state) => state.getOrderStats());
  const recentOrders = useOrderStore((state) => state.getRecentOrders(5));
  const lowStockProducts = useProductStore((state) => state.getLowStockProducts());
  const totalProducts = useProductStore((state) => state.products.length);
  const users = useAuthStore((state) => state.getAllUsers());
  const pendingReviews = useReviewStore((state) => state.getPendingReviews());

  const stats = [
    {
      label: 'Total Revenue',
      value: `$${revenue.toFixed(2)}`,
      change: '+12.5%',
      icon: DollarSign,
      color: 'bg-green-500',
    },
    {
      label: 'Total Orders',
      value: orderStats.total,
      change: '+8.2%',
      icon: ShoppingCart,
      color: 'bg-blue-500',
    },
    {
      label: 'Total Customers',
      value: users.length,
      change: '+4.1%',
      icon: Users,
      color: 'bg-purple-500',
    },
    {
      label: 'Total Products',
      value: totalProducts,
      change: '+2',
      icon: Package,
      color: 'bg-amber-500',
    },
  ];

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    processing: 'bg-blue-100 text-blue-700',
    shipped: 'bg-purple-100 text-purple-700',
    delivered: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm">Welcome back! Here's what's happening today.</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`p-2 rounded-lg ${stat.color}`}>
                <stat.icon size={18} className="text-white" />
              </div>
              <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">
                {stat.change}
              </span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            <p className="text-sm text-gray-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Charts & Alerts */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Sales Chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-semibold text-gray-900">Sales Overview</h2>
              <p className="text-sm text-gray-500">Last 7 days performance</p>
            </div>
            <TrendingUp size={20} className="text-green-500" />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesData}>
                <defs>
                  <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="sales"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#salesGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Alerts */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-center gap-2 mb-6">
            <AlertTriangle size={18} className="text-amber-500" />
            <h2 className="font-semibold text-gray-900">Alerts</h2>
          </div>

          <div className="space-y-4">
            {lowStockProducts.length > 0 && (
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                <p className="text-sm font-medium text-amber-700">Low Stock Alert</p>
                <p className="text-xs text-amber-600">
                  {lowStockProducts.length} product(s) running low
                </p>
                <Link
                  to="/admin/products"
                  className="text-xs text-amber-700 font-medium hover:underline mt-1 inline-flex items-center gap-1"
                >
                  View Products <ArrowRight size={12} />
                </Link>
              </div>
            )}

            {orderStats.pending > 0 && (
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                <p className="text-sm font-medium text-blue-700">Pending Orders</p>
                <p className="text-xs text-blue-600">{orderStats.pending} order(s) awaiting action</p>
                <Link
                  to="/admin/orders"
                  className="text-xs text-blue-700 font-medium hover:underline mt-1 inline-flex items-center gap-1"
                >
                  View Orders <ArrowRight size={12} />
                </Link>
              </div>
            )}

            {pendingReviews.length > 0 && (
              <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                <p className="text-sm font-medium text-purple-700">Pending Reviews</p>
                <p className="text-xs text-purple-600">{pendingReviews.length} review(s) need approval</p>
                <Link
                  to="/admin/reviews"
                  className="text-xs text-purple-700 font-medium hover:underline mt-1 inline-flex items-center gap-1"
                >
                  View Reviews <ArrowRight size={12} />
                </Link>
              </div>
            )}

            {lowStockProducts.length === 0 && orderStats.pending === 0 && pendingReviews.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">No alerts at this time 🎉</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent Orders & Top Products */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Orders */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-semibold text-gray-900">Recent Orders</h2>
            <Link
              to="/admin/orders"
              className="text-sm text-admin-primary hover:underline flex items-center gap-1"
            >
              View All <ArrowRight size={14} />
            </Link>
          </div>

          <div className="space-y-4">
            {recentOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
                <div>
                  <p className="font-medium text-sm text-gray-900">{order.id}</p>
                  <p className="text-xs text-gray-500">{order.userName}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm text-gray-900">${order.total.toFixed(2)}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusColors[order.status]}`}>
                    {order.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Low Stock Products */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-semibold text-gray-900">Low Stock Products</h2>
            <Link
              to="/admin/products"
              className="text-sm text-admin-primary hover:underline flex items-center gap-1"
            >
              View All <ArrowRight size={14} />
            </Link>
          </div>

          {lowStockProducts.length > 0 ? (
            <div className="space-y-4">
              {lowStockProducts.slice(0, 5).map((product) => (
                <div key={product.id} className="flex items-center gap-4 py-3 border-b border-gray-50 last:border-0">
                  <img
                    src={product.images[0]?.url}
                    alt={product.name}
                    className="w-12 h-12 object-cover rounded-lg"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900 truncate">{product.name}</p>
                    <p className="text-xs text-gray-500">{product.category}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    product.stock === 0
                      ? 'bg-red-100 text-red-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {product.stock === 0 ? 'Out of stock' : `${product.stock} left`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-8">All products are well stocked! 📦</p>
          )}
        </div>
      </div>
    </div>
  );
}

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Order, OrderStatus, CartItem } from '../types';

interface OrderStore {
  orders: Order[];
  createOrder: (
    userId: string,
    userName: string,
    userEmail: string,
    items: CartItem[],
    shippingAddress: Order['shippingAddress'],
    paymentMethod: string
  ) => Order;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  getOrdersByUser: (userId: string) => Order[];
  getOrder: (orderId: string) => Order | undefined;
  getAllOrders: () => Order[];
  getRecentOrders: (limit?: number) => Order[];
  getTotalRevenue: () => number;
  getOrderStats: () => { total: number; pending: number; processing: number; shipped: number; delivered: number; cancelled: number };
}

const sampleOrders: Order[] = [
  {
    id: 'ORD-001',
    userId: 'user-001',
    userName: 'John Smith',
    userEmail: 'john@example.com',
    items: [
      { productId: 'prod-001', productName: 'ProSound Elite Wireless Earbuds', productImage: 'https://images.pexels.com/photos/37420781/pexels-photo-37420781.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940', quantity: 1, price: 49.99 },
      { productId: 'prod-002', productName: 'LuxeTime Pro Smartwatch', productImage: 'https://images.pexels.com/photos/12564670/pexels-photo-12564670.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940', quantity: 1, price: 79.99 },
    ],
    subtotal: 129.98,
    shipping: 0,
    total: 129.98,
    status: 'delivered',
    shippingAddress: { name: 'John Smith', address: '123 Main St', city: 'Austin', state: 'TX', zip: '78701', phone: '(555) 123-4567' },
    paymentMethod: 'Credit Card',
    createdAt: '2024-03-01T10:30:00Z',
    updatedAt: '2024-03-05T14:00:00Z',
  },
  {
    id: 'ORD-002',
    userId: 'user-002',
    userName: 'Sarah Johnson',
    userEmail: 'sarah@example.com',
    items: [
      { productId: 'prod-003', productName: 'AuraGlow LED Desk Lamp', productImage: 'https://images.pexels.com/photos/6167446/pexels-photo-6167446.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', quantity: 2, price: 34.99 },
    ],
    subtotal: 69.98,
    shipping: 0,
    total: 69.98,
    status: 'shipped',
    shippingAddress: { name: 'Sarah Johnson', address: '456 Oak Ave', city: 'Dallas', state: 'TX', zip: '75201', phone: '(555) 987-6543' },
    paymentMethod: 'PayPal',
    createdAt: '2024-03-10T15:45:00Z',
    updatedAt: '2024-03-12T09:00:00Z',
  },
  {
    id: 'ORD-003',
    userId: 'user-001',
    userName: 'John Smith',
    userEmail: 'john@example.com',
    items: [
      { productId: 'prod-005', productName: 'Luxe Minimalist Leather Wallet', productImage: 'https://images.pexels.com/photos/35336360/pexels-photo-35336360.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', quantity: 1, price: 24.99 },
    ],
    subtotal: 24.99,
    shipping: 4.99,
    total: 29.98,
    status: 'processing',
    shippingAddress: { name: 'John Smith', address: '123 Main St', city: 'Austin', state: 'TX', zip: '78701', phone: '(555) 123-4567' },
    paymentMethod: 'Credit Card',
    createdAt: '2024-03-14T08:20:00Z',
    updatedAt: '2024-03-14T08:20:00Z',
  },
  {
    id: 'ORD-004',
    userId: 'user-003',
    userName: 'Mike Williams',
    userEmail: 'mike@example.com',
    items: [
      { productId: 'prod-007', productName: 'TechPro Laptop Stand', productImage: 'https://images.pexels.com/photos/12880803/pexels-photo-12880803.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940', quantity: 1, price: 32.99 },
      { productId: 'prod-008', productName: 'Signature Fragrance Collection', productImage: 'https://images.pexels.com/photos/36779952/pexels-photo-36779952.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', quantity: 1, price: 44.99 },
    ],
    subtotal: 77.98,
    shipping: 0,
    total: 77.98,
    status: 'pending',
    shippingAddress: { name: 'Mike Williams', address: '789 Pine St', city: 'Houston', state: 'TX', zip: '77001', phone: '(555) 456-7890' },
    paymentMethod: 'Credit Card',
    createdAt: '2024-03-15T11:00:00Z',
    updatedAt: '2024-03-15T11:00:00Z',
  },
];

export const useOrderStore = create<OrderStore>()(
  persist(
    (set, get) => ({
      orders: sampleOrders,

      createOrder: (userId, userName, userEmail, items, shippingAddress, paymentMethod) => {
        const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
        const shipping = subtotal >= 50 ? 0 : 4.99;

        const newOrder: Order = {
          id: `ORD-${Date.now().toString().slice(-6)}`,
          userId,
          userName,
          userEmail,
          items: items.map((item) => ({
            productId: item.productId,
            productName: item.product.name,
            productImage: item.product.images[0]?.url || '',
            quantity: item.quantity,
            price: item.product.price,
          })),
          subtotal,
          shipping,
          total: subtotal + shipping,
          status: 'pending',
          shippingAddress,
          paymentMethod,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set((state) => ({
          orders: [newOrder, ...state.orders],
        }));

        return newOrder;
      },

      updateOrderStatus: (orderId, status) => {
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === orderId
              ? { ...order, status, updatedAt: new Date().toISOString() }
              : order
          ),
        }));
      },

      getOrdersByUser: (userId) => {
        return get().orders.filter((order) => order.userId === userId);
      },

      getOrder: (orderId) => {
        return get().orders.find((order) => order.id === orderId);
      },

      getAllOrders: () => {
        return get().orders;
      },

      getRecentOrders: (limit = 5) => {
        return [...get().orders]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, limit);
      },

      getTotalRevenue: () => {
        return get().orders
          .filter((order) => order.status !== 'cancelled')
          .reduce((sum, order) => sum + order.total, 0);
      },

      getOrderStats: () => {
        const orders = get().orders;
        return {
          total: orders.length,
          pending: orders.filter((o) => o.status === 'pending').length,
          processing: orders.filter((o) => o.status === 'processing').length,
          shipped: orders.filter((o) => o.status === 'shipped').length,
          delivered: orders.filter((o) => o.status === 'delivered').length,
          cancelled: orders.filter((o) => o.status === 'cancelled').length,
        };
      },
    }),
    {
      name: 'luxedge-orders',
    }
  )
);

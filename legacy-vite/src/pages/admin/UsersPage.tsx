import { useState } from 'react';
import { Search, UserX, UserCheck, Trash2, Users, Mail, Calendar, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useOrderStore } from '../../store/orderStore';
import { useNotificationStore } from '../../store/notificationStore';
import Modal from '../../components/common/Modal';
import { format } from 'date-fns';

export default function UsersPage() {
  const { getAllUsers, blockUser, unblockUser, deleteUser } = useAuthStore();
  const getOrdersByUser = useOrderStore((state) => state.getOrdersByUser);
  const addNotification = useNotificationStore((state) => state.addNotification);

  const users = getAllUsers();
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filteredUsers = users.filter(
    (user) =>
      user.name.toLowerCase().includes(search.toLowerCase()) ||
      user.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleBlock = (userId: string, isBlocked: boolean) => {
    if (isBlocked) {
      unblockUser(userId);
      addNotification({ type: 'success', message: 'User unblocked successfully' });
    } else {
      blockUser(userId);
      addNotification({ type: 'success', message: 'User blocked successfully' });
    }
  };

  const handleDelete = (userId: string) => {
    deleteUser(userId);
    addNotification({ type: 'success', message: 'User deleted successfully' });
    setDeleteConfirm(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="text-gray-500 text-sm">Manage registered customers</p>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="relative max-w-md">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search users by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary"
          />
        </div>
      </div>

      {/* Users Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredUsers.map((user) => {
          const userOrders = getOrdersByUser(user.id);
          const totalSpent = userOrders.reduce((sum, order) => sum + order.total, 0);

          return (
            <div
              key={user.id}
              className={`bg-white rounded-xl border p-5 ${
                user.isBlocked ? 'border-red-200 bg-red-50/30' : 'border-gray-100'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
                    user.isBlocked ? 'bg-red-100 text-red-600' : 'bg-admin-primary/10 text-admin-primary'
                  }`}>
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{user.name}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      <Mail size={10} />
                      {user.email}
                    </p>
                  </div>
                </div>
                {user.isBlocked && (
                  <span className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-600 text-[10px] font-semibold rounded-full">
                    <ShieldAlert size={10} />
                    Blocked
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4 text-center">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-lg font-bold text-gray-900">{userOrders.length}</p>
                  <p className="text-[10px] text-gray-500 uppercase">Orders</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-lg font-bold text-gray-900">${totalSpent.toFixed(2)}</p>
                  <p className="text-[10px] text-gray-500 uppercase">Total Spent</p>
                </div>
              </div>

              <div className="text-xs text-gray-500 space-y-1 mb-4">
                <p className="flex items-center gap-1">
                  <Calendar size={10} />
                  Joined: {format(new Date(user.createdAt), 'MMM d, yyyy')}
                </p>
                {user.lastLogin && (
                  <p className="flex items-center gap-1">
                    <Calendar size={10} />
                    Last login: {format(new Date(user.lastLogin), 'MMM d, yyyy')}
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-4 border-t border-gray-100">
                <button
                  onClick={() => handleBlock(user.id, user.isBlocked)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                    user.isBlocked
                      ? 'bg-green-50 text-green-600 hover:bg-green-100'
                      : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                  }`}
                >
                  {user.isBlocked ? <UserCheck size={14} /> : <UserX size={14} />}
                  {user.isBlocked ? 'Unblock' : 'Block'}
                </button>
                <button
                  onClick={() => setDeleteConfirm(user.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-medium transition-colors"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filteredUsers.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <Users size={48} className="mx-auto text-gray-200 mb-4" />
          <p className="text-gray-500">No users found</p>
        </div>
      )}

      {/* Delete Confirmation */}
      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete User" size="sm">
        <div className="p-6">
          <p className="text-gray-600 mb-6">
            Are you sure you want to delete this user? This will also remove their order history. This action cannot be undone.
          </p>
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

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  users: User[];
  login: (email: string, password: string) => { success: boolean; message: string; isAdmin?: boolean };
  adminLogin: (email: string, password: string) => { success: boolean; message: string };
  signup: (name: string, email: string, password: string) => { success: boolean; message: string };
  logout: () => void;
  updateProfile: (updates: Partial<User>) => void;
  changePassword: (currentPassword: string, newPassword: string) => { success: boolean; message: string };
  blockUser: (userId: string) => void;
  unblockUser: (userId: string) => void;
  deleteUser: (userId: string) => void;
  getAllUsers: () => User[];
}

// Initial admin account
const initialAdmin: User = {
  id: 'admin-001',
  email: 'admin@luxedge.us',
  password: 'admin123', // In production, this would be hashed
  name: 'Admin',
  role: 'admin',
  createdAt: new Date().toISOString(),
  isBlocked: false,
};

// Sample users for demo
const sampleUsers: User[] = [
  {
    id: 'user-001',
    email: 'john@example.com',
    password: 'password123',
    name: 'John Smith',
    role: 'buyer',
    phone: '(555) 123-4567',
    address: '123 Main St, Austin, TX 78701',
    createdAt: '2024-01-15T10:30:00Z',
    lastLogin: '2024-03-10T14:22:00Z',
    isBlocked: false,
  },
  {
    id: 'user-002',
    email: 'sarah@example.com',
    password: 'password123',
    name: 'Sarah Johnson',
    role: 'buyer',
    phone: '(555) 987-6543',
    address: '456 Oak Ave, Dallas, TX 75201',
    createdAt: '2024-02-20T08:15:00Z',
    lastLogin: '2024-03-12T09:45:00Z',
    isBlocked: false,
  },
  {
    id: 'user-003',
    email: 'mike@example.com',
    password: 'password123',
    name: 'Mike Williams',
    role: 'buyer',
    createdAt: '2024-03-01T16:00:00Z',
    isBlocked: false,
  },
];

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      users: [initialAdmin, ...sampleUsers],

      login: (email, password) => {
        const { users } = get();
        const user = users.find(
          (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
        );

        if (!user) {
          return { success: false, message: 'Invalid email or password' };
        }

        if (user.isBlocked) {
          return { success: false, message: 'Your account has been blocked. Please contact support.' };
        }

        // Update last login
        const updatedUsers = users.map((u) =>
          u.id === user.id ? { ...u, lastLogin: new Date().toISOString() } : u
        );

        set({
          user: { ...user, lastLogin: new Date().toISOString() },
          isAuthenticated: true,
          users: updatedUsers,
        });

        return { success: true, message: 'Login successful', isAdmin: user.role === 'admin' };
      },

      adminLogin: (email, password) => {
        const { users } = get();
        const admin = users.find(
          (u) =>
            u.email.toLowerCase() === email.toLowerCase() &&
            u.password === password &&
            u.role === 'admin'
        );

        if (!admin) {
          return { success: false, message: 'Invalid admin credentials' };
        }

        set({
          user: { ...admin, lastLogin: new Date().toISOString() },
          isAuthenticated: true,
        });

        return { success: true, message: 'Admin login successful' };
      },

      signup: (name, email, password) => {
        const { users } = get();
        
        if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
          return { success: false, message: 'Email already registered' };
        }

        if (password.length < 6) {
          return { success: false, message: 'Password must be at least 6 characters' };
        }

        const newUser: User = {
          id: `user-${Date.now()}`,
          email,
          password,
          name,
          role: 'buyer',
          createdAt: new Date().toISOString(),
          isBlocked: false,
        };

        set({
          users: [...users, newUser],
          user: newUser,
          isAuthenticated: true,
        });

        return { success: true, message: 'Account created successfully' };
      },

      logout: () => {
        set({ user: null, isAuthenticated: false });
      },

      updateProfile: (updates) => {
        const { user, users } = get();
        if (!user) return;

        const updatedUser = { ...user, ...updates };
        const updatedUsers = users.map((u) => (u.id === user.id ? updatedUser : u));

        set({ user: updatedUser, users: updatedUsers });
      },

      changePassword: (currentPassword, newPassword) => {
        const { user, users } = get();
        if (!user) return { success: false, message: 'Not authenticated' };

        if (user.password !== currentPassword) {
          return { success: false, message: 'Current password is incorrect' };
        }

        if (newPassword.length < 6) {
          return { success: false, message: 'New password must be at least 6 characters' };
        }

        const updatedUser = { ...user, password: newPassword };
        const updatedUsers = users.map((u) => (u.id === user.id ? updatedUser : u));

        set({ user: updatedUser, users: updatedUsers });
        return { success: true, message: 'Password changed successfully' };
      },

      blockUser: (userId) => {
        const { users } = get();
        const updatedUsers = users.map((u) =>
          u.id === userId ? { ...u, isBlocked: true } : u
        );
        set({ users: updatedUsers });
      },

      unblockUser: (userId) => {
        const { users } = get();
        const updatedUsers = users.map((u) =>
          u.id === userId ? { ...u, isBlocked: false } : u
        );
        set({ users: updatedUsers });
      },

      deleteUser: (userId) => {
        const { users } = get();
        set({ users: users.filter((u) => u.id !== userId) });
      },

      getAllUsers: () => {
        return get().users.filter((u) => u.role === 'buyer');
      },
    }),
    {
      name: 'luxedge-auth',
    }
  )
);

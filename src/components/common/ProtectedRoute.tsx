import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireAuth?: boolean;
}

export default function ProtectedRoute({ children, requireAdmin = false, requireAuth = false }: ProtectedRouteProps) {
  const { isAuthenticated, user, ready } = useAuthStore();
  const location = useLocation();

  // Wait for the initial Supabase session hydration so a page refresh does
  // not flash-redirect a signed-in user to the login page.
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">
        Checking session…
      </div>
    );
  }

  // Admin route protection
  if (requireAdmin) {
    if (!isAuthenticated) {
      return <Navigate to="/admin/login" state={{ from: location }} replace />;
    }
    if (user?.role !== 'admin') {
      return <Navigate to="/" replace />;
    }
  }

  // Regular auth protection (for buyer pages)
  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

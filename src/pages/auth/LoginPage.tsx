import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const addNotification = useNotificationStore((state) => state.addNotification);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    const result = login(email, password);

    if (result.success) {
      addNotification({ type: 'success', message: 'Welcome back!' });
      if (result.isAdmin) {
        navigate('/admin');
      } else {
        navigate('/');
      }
    } else {
      addNotification({ type: 'error', message: result.message });
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-luxe-cream to-white flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 bg-luxe-black rounded-lg flex items-center justify-center">
              <span className="text-white font-serif text-lg font-bold">L</span>
            </div>
            <span className="font-serif text-2xl font-bold text-luxe-red">LUXEDGE</span>
          </Link>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
          <h1 className="text-2xl font-bold text-luxe-dark text-center mb-2">Welcome Back</h1>
          <p className="text-luxe-gray text-center mb-8">Sign in to your account to continue</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-luxe-gray" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-luxe-cream/50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-luxe-gray" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-3 bg-luxe-cream/50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-luxe-gray hover:text-luxe-dark"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-luxe-gold focus:ring-luxe-gold" />
                <span className="text-sm text-luxe-gray">Remember me</span>
              </label>
              <a href="#" className="text-sm text-luxe-gold hover:text-luxe-gold-dark">
                Forgot password?
              </a>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  Sign In
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-luxe-gray">
              Don't have an account?{' '}
              <Link to="/signup" className="text-luxe-gold font-semibold hover:text-luxe-gold-dark">
                Sign up
              </Link>
            </p>
          </div>

          {/* Demo Credentials */}
          <div className="mt-6 p-4 bg-luxe-cream/50 rounded-xl">
            <p className="text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">Demo Credentials</p>
            <div className="space-y-1 text-xs text-luxe-gray">
              <p><span className="font-medium">User:</span> john@example.com / password123</p>
              <p><span className="font-medium">Admin:</span> admin@luxedge.us / admin123</p>
            </div>
          </div>
        </div>

        {/* Admin Login Link */}
        <p className="mt-6 text-center text-sm text-luxe-gray">
          Admin?{' '}
          <Link to="/admin/login" className="text-luxe-gold font-semibold hover:text-luxe-gold-dark">
            Go to Admin Login
          </Link>
        </p>
      </div>
    </div>
  );
}

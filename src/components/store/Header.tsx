import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShoppingBag, Menu, X, Search, User, LogOut, Heart, ChevronDown, Package, Shield, ChevronRight } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';
import { useCategoryStore } from '../../store/categoryStore';

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const location = useLocation();
  
  const { isAuthenticated, user, logout } = useAuthStore();
  const cartCount = useCartStore((state) => state.getCartCount());
  const { getMainCategories, getSubCategories } = useCategoryStore();
  
  const mainCategories = getMainCategories().filter((c) => c.isActive);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
    setCategoriesOpen(false);
  }, [location.pathname]);

  const navItems = [
    { path: '/', label: 'Home' },
    { path: '/shop', label: 'Shop', hasDropdown: true },
    { path: '/about', label: 'About' },
    { path: '/contact', label: 'Contact' },
  ];

  return (
    <>
      {/* Announcement Bar */}
      <div className="bg-luxe-black text-white text-center py-2 px-4 text-xs tracking-widest uppercase font-light">
        ✦ Free Shipping on Orders Over $50 &nbsp;|&nbsp; 30-Day Easy Returns ✦
      </div>

      {/* Main Header */}
      <header
        className={`sticky top-0 z-50 transition-all duration-500 ${
          isScrolled ? 'bg-white/95 backdrop-blur-xl shadow-sm' : 'bg-white'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 lg:h-20">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-2 text-luxe-dark hover:text-luxe-gold transition-colors"
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>

            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 bg-luxe-red rounded-sm flex items-center justify-center group-hover:bg-luxe-gold transition-colors duration-300">
                <span className="text-white font-serif text-sm font-bold">L</span>
              </div>
              <span className="font-serif text-xl lg:text-2xl font-bold tracking-tight text-luxe-red">
                LUXEDGE
              </span>
            </Link>

            {/* Desktop Nav */}
            <nav className="hidden lg:flex items-center gap-8">
              {navItems.map((item) => (
                <div key={item.path} className="relative group">
                  {item.hasDropdown ? (
                    <div
                      onMouseEnter={() => setCategoriesOpen(true)}
                      onMouseLeave={() => setCategoriesOpen(false)}
                    >
                      <Link
                        to="/shop"
                        className={`relative text-sm tracking-wide uppercase font-medium transition-colors duration-300 pb-1 flex items-center gap-1 ${
                          location.pathname.startsWith('/shop')
                            ? 'text-luxe-gold'
                            : 'text-luxe-dark hover:text-luxe-gold'
                        }`}
                      >
                        {item.label}
                        <ChevronDown size={12} className={`transition-transform ${categoriesOpen ? 'rotate-180' : ''}`} />
                        {location.pathname.startsWith('/shop') && (
                          <span className="absolute bottom-0 left-0 w-full h-0.5 bg-luxe-gold" />
                        )}
                      </Link>

                      {/* Categories Mega Menu */}
                      <div
                        className={`absolute left-1/2 -translate-x-1/2 top-full pt-4 transition-all duration-200 ${
                          categoriesOpen ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'
                        }`}
                      >
                        <div className="bg-white rounded-xl shadow-2xl border border-gray-100 p-6 min-w-[450px]">
                          <div className="grid grid-cols-3 gap-6">
                            {/* All Products */}
                            <div>
                              <Link
                                to="/shop"
                                className="flex items-center gap-2 font-semibold text-luxe-dark hover:text-luxe-gold mb-3 text-sm"
                              >
                                All Products
                                <ChevronRight size={14} />
                              </Link>
                              <p className="text-xs text-luxe-gray">Browse our complete collection</p>
                            </div>

                            {/* Categories */}
                            {mainCategories.slice(0, 5).map((category) => {
                              const subCats = getSubCategories(category.id).filter((c) => c.isActive);
                              return (
                                <div key={category.id}>
                                  <Link
                                    to="/shop"
                                    className="font-semibold text-luxe-dark hover:text-luxe-gold text-sm block mb-2"
                                  >
                                    {category.name}
                                  </Link>
                                  {subCats.length > 0 && (
                                    <ul className="space-y-1">
                                      {subCats.slice(0, 4).map((sub) => (
                                        <li key={sub.id}>
                                          <Link
                                            to="/shop"
                                            className="text-xs text-luxe-gray hover:text-luxe-gold transition-colors"
                                          >
                                            {sub.name}
                                          </Link>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Link
                      to={item.path}
                      className={`relative text-sm tracking-wide uppercase font-medium transition-colors duration-300 pb-1 ${
                        location.pathname === item.path
                          ? 'text-luxe-gold'
                          : 'text-luxe-dark hover:text-luxe-gold'
                      }`}
                    >
                      {item.label}
                      {location.pathname === item.path && (
                        <span className="absolute bottom-0 left-0 w-full h-0.5 bg-luxe-gold" />
                      )}
                    </Link>
                  )}
                </div>
              ))}
            </nav>

            {/* Actions */}
            <div className="flex items-center gap-1 sm:gap-2">
              {/* Search */}
              <Link to="/shop" className="p-2 text-luxe-dark hover:text-luxe-gold transition-colors">
                <Search size={20} />
              </Link>

              {/* User Menu / Login */}
              {isAuthenticated && user ? (
                <div className="relative">
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="flex items-center gap-2 p-2 text-luxe-dark hover:text-luxe-gold transition-colors"
                  >
                    <div className="w-8 h-8 bg-luxe-gold/10 rounded-full flex items-center justify-center">
                      <span className="text-xs font-bold text-luxe-gold">
                        {user.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <ChevronDown size={14} className={`hidden sm:block transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {userMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50 animate-scale-in">
                        <div className="px-4 py-2 border-b border-gray-100">
                          <p className="font-semibold text-sm text-luxe-dark">{user.name}</p>
                          <p className="text-xs text-luxe-gray truncate">{user.email}</p>
                        </div>
                        <Link
                          to="/profile"
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-luxe-dark hover:bg-luxe-cream transition-colors"
                        >
                          <User size={16} />
                          My Profile
                        </Link>
                        <Link
                          to="/orders"
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-luxe-dark hover:bg-luxe-cream transition-colors"
                        >
                          <Package size={16} />
                          My Orders
                        </Link>
                        <Link
                          to="/wishlist"
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-luxe-dark hover:bg-luxe-cream transition-colors"
                        >
                          <Heart size={16} />
                          Wishlist
                        </Link>
                        <div className="border-t border-gray-100 mt-2 pt-2">
                          <button
                            onClick={() => {
                              logout();
                              setUserMenuOpen(false);
                            }}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors w-full"
                          >
                            <LogOut size={16} />
                            Log Out
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                /* Login Button - Visible for guests */
                <Link
                  to="/login"
                  className="flex items-center gap-1.5 p-2 sm:px-4 sm:py-2 text-luxe-dark hover:text-luxe-gold transition-colors group"
                  title="Sign In / Sign Up"
                >
                  <User size={20} className="group-hover:scale-110 transition-transform" />
                  <span className="hidden sm:inline text-sm font-medium">Sign In</span>
                </Link>
              )}

              {/* Cart */}
              <Link
                to="/cart"
                className="p-2 text-luxe-dark hover:text-luxe-gold transition-colors relative"
              >
                <ShoppingBag size={20} />
                {cartCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-luxe-gold text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {cartCount > 9 ? '9+' : cartCount}
                  </span>
                )}
              </Link>

              {/* Admin Link - Visible */}
              <Link
                to="/admin/login"
                className="hidden sm:flex items-center gap-1.5 ml-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg transition-colors"
                title="Admin Panel"
              >
                <Shield size={14} />
                Admin
              </Link>
            </div>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileOpen && (
          <div className="lg:hidden border-t border-gray-100 bg-white animate-fade-in">
            <div className="px-4 py-6 space-y-1">
              {navItems.map((item) => (
                <div key={item.path}>
                  <Link
                    to={item.path}
                    className={`block px-4 py-3 rounded-lg text-sm uppercase tracking-wide font-medium transition-colors ${
                      location.pathname === item.path
                        ? 'bg-luxe-cream text-luxe-gold'
                        : 'text-luxe-dark hover:bg-luxe-cream'
                    }`}
                  >
                    {item.label}
                  </Link>
                  
                  {/* Mobile Categories */}
                  {item.hasDropdown && (
                    <div className="ml-4 mt-1 space-y-1">
                      {mainCategories.map((category) => (
                        <Link
                          key={category.id}
                          to="/shop"
                          className="block px-4 py-2 text-sm text-luxe-gray hover:text-luxe-gold transition-colors"
                        >
                          {category.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              
              {/* Mobile Sign In */}
              {!isAuthenticated && (
                <Link
                  to="/login"
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm uppercase tracking-wide font-medium text-luxe-dark hover:bg-luxe-cream transition-colors"
                >
                  <User size={18} />
                  Sign In / Sign Up
                </Link>
              )}

              {/* Mobile Admin Link */}
              <Link
                to="/admin/login"
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm uppercase tracking-wide font-medium bg-slate-800 text-white hover:bg-slate-700 transition-colors mt-4"
              >
                <Shield size={18} />
                Admin Panel
              </Link>
            </div>
          </div>
        )}
      </header>
    </>
  );
}

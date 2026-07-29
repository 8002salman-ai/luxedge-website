import { useState, useEffect } from 'react';
import { ShoppingBag, Menu, X, Search, Heart } from 'lucide-react';

interface HeaderProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  cartCount: number;
  onCartOpen: () => void;
}

export default function Header({ currentPage, onNavigate, cartCount, onCartOpen }: HeaderProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'shop', label: 'Shop' },
    { id: 'about', label: 'About' },
    { id: 'contact', label: 'Contact' },
  ];

  return (
    <>
      {/* Announcement Bar */}
      <div className="bg-luxe-black text-luxe-white text-center py-2 px-4 text-xs tracking-widest uppercase font-light">
        ✦ Free Shipping on Orders Over $50 &nbsp;|&nbsp; 30-Day Easy Returns &nbsp;|&nbsp; Premium Quality Guaranteed ✦
      </div>

      {/* Main Header */}
      <header
        className={`sticky top-0 z-50 transition-all duration-500 ${
          isScrolled
            ? 'bg-white/95 backdrop-blur-xl shadow-[0_1px_20px_rgba(0,0,0,0.06)]'
            : 'bg-white'
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
            <button
              onClick={() => onNavigate('home')}
              className="flex items-center gap-2 group"
            >
              <div className="w-8 h-8 bg-luxe-black rounded-sm flex items-center justify-center group-hover:bg-luxe-gold transition-colors duration-300">
                <span className="text-white font-serif text-sm font-bold">L</span>
              </div>
              <span className="font-serif text-xl lg:text-2xl font-bold tracking-tight text-luxe-black">
                LUXEDGE
              </span>
            </button>

            {/* Desktop Nav */}
            <nav className="hidden lg:flex items-center gap-8">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`relative text-sm tracking-wide uppercase font-medium transition-colors duration-300 pb-1 ${
                    currentPage === item.id
                      ? 'text-luxe-gold'
                      : 'text-luxe-dark hover:text-luxe-gold'
                  }`}
                >
                  {item.label}
                  {currentPage === item.id && (
                    <span className="absolute bottom-0 left-0 w-full h-0.5 bg-luxe-gold" />
                  )}
                </button>
              ))}
            </nav>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSearchOpen(!searchOpen)}
                className="p-2 text-luxe-dark hover:text-luxe-gold transition-colors"
              >
                <Search size={20} />
              </button>
              <button className="hidden sm:block p-2 text-luxe-dark hover:text-luxe-gold transition-colors relative">
                <Heart size={20} />
              </button>
              <button
                onClick={onCartOpen}
                className="p-2 text-luxe-dark hover:text-luxe-gold transition-colors relative"
              >
                <ShoppingBag size={20} />
                {cartCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-luxe-gold text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {cartCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        {searchOpen && (
          <div className="border-t border-gray-100 animate-fade-in">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-luxe-gray" size={18} />
                <input
                  type="text"
                  placeholder="Search for products..."
                  className="w-full pl-12 pr-4 py-3 bg-luxe-cream rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-luxe-gold/30 text-sm"
                  autoFocus
                />
              </div>
            </div>
          </div>
        )}

        {/* Mobile Nav */}
        {mobileOpen && (
          <div className="lg:hidden border-t border-gray-100 bg-white animate-fade-in">
            <div className="px-4 py-6 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    onNavigate(item.id);
                    setMobileOpen(false);
                  }}
                  className={`block w-full text-left px-4 py-3 rounded-lg text-sm uppercase tracking-wide font-medium transition-colors ${
                    currentPage === item.id
                      ? 'bg-luxe-cream text-luxe-gold'
                      : 'text-luxe-dark hover:bg-luxe-cream'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>
    </>
  );
}

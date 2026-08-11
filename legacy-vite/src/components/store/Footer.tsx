import { Link } from 'react-router-dom';
import { Mail, Phone, MapPin, ArrowRight } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-luxe-black text-white">
      {/* Newsletter */}
      <div className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-2xl mx-auto text-center">
            <h3 className="font-serif text-2xl font-bold mb-3">
              Join the <span className="text-luxe-gold">Luxedge</span> Inner Circle
            </h3>
            <p className="text-luxe-silver text-sm mb-6">
              First access to new arrivals, exclusive deals, and curated picks.
            </p>
            <div className="flex gap-2 max-w-md mx-auto">
              <input
                type="email"
                placeholder="Enter your email"
                className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-luxe-silver focus:outline-none focus:border-luxe-gold/50"
              />
              <button className="px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-light text-white text-sm font-semibold rounded-lg transition-all flex items-center gap-2">
                Subscribe <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Links */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-luxe-gold rounded-sm flex items-center justify-center">
                <span className="text-white font-serif text-sm font-bold">L</span>
              </div>
              <span className="font-serif text-lg font-bold">LUXEDGE</span>
            </div>
            <p className="text-luxe-silver text-sm leading-relaxed">
              Curating premium products so you shop with confidence.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider mb-4">Shop</h4>
            <ul className="space-y-2">
              {['All Products', 'New Arrivals', 'Best Sellers', 'Sale'].map((item) => (
                <li key={item}>
                  <Link to="/shop" className="text-luxe-silver hover:text-luxe-gold text-sm transition-colors">
                    {item}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider mb-4">Support</h4>
            <ul className="space-y-2">
              {['Contact Us', 'FAQ', 'Shipping', 'Returns'].map((item) => (
                <li key={item}>
                  <Link to="/contact" className="text-luxe-silver hover:text-luxe-gold text-sm transition-colors">
                    {item}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider mb-4">Account</h4>
            <ul className="space-y-2">
              <li>
                <Link to="/login" className="text-luxe-silver hover:text-luxe-gold text-sm transition-colors">
                  Sign In
                </Link>
              </li>
              <li>
                <Link to="/signup" className="text-luxe-silver hover:text-luxe-gold text-sm transition-colors">
                  Create Account
                </Link>
              </li>
              <li>
                <Link to="/orders" className="text-luxe-silver hover:text-luxe-gold text-sm transition-colors">
                  Track Order
                </Link>
              </li>
              <li>
                <Link to="/admin/login" className="text-luxe-gold hover:text-luxe-gold-light text-sm transition-colors font-medium">
                  🔐 Admin Login
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider mb-4">Contact</h4>
            <ul className="space-y-3">
              <li className="flex items-center gap-2 text-luxe-silver text-sm">
                <MapPin size={14} className="text-luxe-gold" />
                Irving, TX
              </li>
              <li className="flex items-center gap-2 text-luxe-silver text-sm">
                <Phone size={14} className="text-luxe-gold" />
                (440) 941-8002
              </li>
              <li className="flex items-center gap-2 text-luxe-silver text-sm">
                <Mail size={14} className="text-luxe-gold" />
                hello@luxedge.us
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom */}
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-luxe-silver text-xs">© 2025 Luxedge. All rights reserved.</p>
            <div className="flex gap-4">
              {['Visa', 'MC', 'Amex', 'PayPal'].map((card) => (
                <span key={card} className="px-2 py-1 bg-white/5 rounded text-[10px] text-luxe-silver">
                  {card}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

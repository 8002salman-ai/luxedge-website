import { Mail, Phone, MapPin, ArrowRight } from 'lucide-react';

interface FooterProps {
  onNavigate: (page: string) => void;
}

export default function Footer({ onNavigate }: FooterProps) {
  return (
    <footer className="bg-luxe-black text-white">
      {/* Newsletter Section */}
      <div className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="max-w-2xl mx-auto text-center">
            <h3 className="font-serif text-2xl lg:text-3xl font-bold mb-3">
              Join the <span className="text-luxe-gold">Luxedge</span> Inner Circle
            </h3>
            <p className="text-luxe-silver text-sm mb-6">
              Get first access to new arrivals, exclusive deals, and curated picks — delivered straight to your inbox.
            </p>
            <div className="flex gap-2 max-w-md mx-auto">
              <input
                type="email"
                placeholder="Enter your email"
                className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-luxe-silver focus:outline-none focus:border-luxe-gold/50 transition-colors"
              />
              <button className="px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-light text-white text-sm font-semibold rounded-lg transition-all duration-300 flex items-center gap-2 btn-shimmer">
                Subscribe <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-luxe-gold rounded-sm flex items-center justify-center">
                <span className="text-white font-serif text-sm font-bold">L</span>
              </div>
              <span className="font-serif text-xl font-bold tracking-tight">LUXEDGE</span>
            </div>
            <p className="text-luxe-silver text-sm leading-relaxed mb-6">
              Curating the world's best products so you don't have to search. Premium quality, honest prices, delivered to your door.
            </p>
            <div className="flex gap-4">
              {['facebook', 'instagram', 'twitter', 'tiktok'].map((social) => (
                <a
                  key={social}
                  href="#"
                  className="w-9 h-9 bg-white/5 hover:bg-luxe-gold rounded-full flex items-center justify-center transition-all duration-300 text-luxe-silver hover:text-white text-xs uppercase font-bold"
                >
                  {social[0].toUpperCase()}
                </a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider mb-6">Quick Links</h4>
            <ul className="space-y-3">
              {[
                { label: 'Home', page: 'home' },
                { label: 'Shop All', page: 'shop' },
                { label: 'About Us', page: 'about' },
                { label: 'Contact', page: 'contact' },
              ].map((link) => (
                <li key={link.page}>
                  <button
                    onClick={() => onNavigate(link.page)}
                    className="text-luxe-silver hover:text-luxe-gold text-sm transition-colors duration-300"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Customer Care */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider mb-6">Customer Care</h4>
            <ul className="space-y-3">
              {[
                'Shipping & Delivery',
                'Returns & Exchanges',
                'FAQ',
                'Size Guide',
                'Track Your Order',
                'Privacy Policy',
              ].map((link) => (
                <li key={link}>
                  <a href="#" className="text-luxe-silver hover:text-luxe-gold text-sm transition-colors duration-300">
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Info */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider mb-6">Get in Touch</h4>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <MapPin size={16} className="text-luxe-gold mt-0.5 shrink-0" />
                <span className="text-luxe-silver text-sm">Irving, TX, United States</span>
              </li>
              <li className="flex items-start gap-3">
                <Phone size={16} className="text-luxe-gold mt-0.5 shrink-0" />
                <span className="text-luxe-silver text-sm">(440) 941-8002</span>
              </li>
              <li className="flex items-start gap-3">
                <Mail size={16} className="text-luxe-gold mt-0.5 shrink-0" />
                <span className="text-luxe-silver text-sm">hello@luxedge.us</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-luxe-silver text-xs">
              © 2025 Luxedge. All rights reserved. | Irving, TX
            </p>
            <div className="flex items-center gap-6">
              <span className="text-luxe-silver text-xs">We accept:</span>
              <div className="flex gap-3">
                {['Visa', 'MC', 'Amex', 'PayPal'].map((card) => (
                  <span
                    key={card}
                    className="px-2 py-1 bg-white/5 rounded text-[10px] text-luxe-silver font-medium"
                  >
                    {card}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

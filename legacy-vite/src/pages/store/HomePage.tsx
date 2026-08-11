import { Link } from 'react-router-dom';
import { ArrowRight, Star, Truck, Shield, RotateCcw, Award, Zap } from 'lucide-react';
import ProductCard from '../../components/store/ProductCard';
import { useProductStore } from '../../store/productStore';

export default function HomePage() {
  const products = useProductStore((state) => state.products.filter((p) => p.isActive).slice(0, 8));

  return (
    <div>
      {/* Hero Section */}
      <section className="relative min-h-[85vh] flex items-center overflow-hidden bg-luxe-black">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '40px 40px'
          }} />
        </div>
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-luxe-gold/10 rounded-full blur-[120px]" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 relative z-10">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full text-luxe-gold text-xs tracking-widest uppercase font-semibold mb-8">
              <Zap size={12} />
              New Arrivals Weekly
            </div>

            <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold text-white leading-[1.1] mb-6">
              Discover Products
              <br />
              <span className="text-gold-gradient">Worth Owning.</span>
            </h1>

            <p className="text-lg text-luxe-silver max-w-xl leading-relaxed mb-8">
              We curate the world's best products so you don't have to search. Premium quality, honest prices, delivered to your door.
            </p>

            <div className="flex flex-wrap gap-4 mb-12">
              <Link
                to="/shop"
                className="group px-8 py-4 bg-luxe-gold hover:bg-luxe-gold-light text-white font-semibold rounded-lg transition-all flex items-center gap-3 text-sm uppercase tracking-wider"
              >
                Shop Now
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                to="/about"
                className="px-8 py-4 border border-white/20 hover:border-luxe-gold text-white hover:text-luxe-gold rounded-lg transition-all text-sm uppercase tracking-wider"
              >
                Our Story
              </Link>
            </div>

            {/* Social Proof */}
            <div className="flex items-center gap-6">
              <div className="flex -space-x-3">
                {['S', 'J', 'E', 'M'].map((letter, i) => (
                  <div
                    key={i}
                    className="w-10 h-10 rounded-full border-2 border-luxe-black flex items-center justify-center text-xs font-bold bg-luxe-charcoal text-luxe-silver"
                  >
                    {letter}
                  </div>
                ))}
                <div className="w-10 h-10 rounded-full border-2 border-luxe-black flex items-center justify-center text-[10px] font-bold bg-luxe-gold text-white">
                  2k+
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={12} className="text-luxe-gold fill-luxe-gold" />
                  ))}
                </div>
                <p className="text-luxe-silver text-xs mt-0.5">Trusted by 2,000+ happy customers</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Bar */}
      <section className="bg-luxe-cream border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: Truck, label: 'Free Shipping', desc: 'On orders $50+' },
              { icon: RotateCcw, label: '30-Day Returns', desc: 'No questions asked' },
              { icon: Shield, label: 'Secure Checkout', desc: '100% encrypted' },
              { icon: Award, label: 'Quality Promise', desc: 'Handpicked items' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-10 h-10 bg-luxe-gold/10 rounded-lg flex items-center justify-center shrink-0">
                  <item.icon size={18} className="text-luxe-gold" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-luxe-dark">{item.label}</p>
                  <p className="text-[10px] text-luxe-gray">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Handpicked For You</p>
            <h2 className="font-serif text-3xl lg:text-4xl font-bold text-luxe-dark mb-4">
              Trending This Week
            </h2>
            <p className="text-luxe-gray max-w-xl mx-auto">
              Our editors' top picks — products that are flying off the shelves.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>

          <div className="text-center mt-12">
            <Link
              to="/shop"
              className="group inline-flex items-center gap-2 px-8 py-4 bg-luxe-black hover:bg-luxe-gold text-white font-semibold rounded-lg transition-all text-sm uppercase tracking-wider"
            >
              View All Products
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-luxe-black relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-luxe-gold/5 rounded-full blur-[120px]" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6">
            Ready to Upgrade Your Life?
          </h2>
          <p className="text-luxe-silver max-w-xl mx-auto mb-10">
            Join over 2,000 customers who've discovered the Luxedge difference.
          </p>
          <Link
            to="/signup"
            className="group inline-flex items-center gap-3 px-10 py-4 bg-luxe-gold hover:bg-luxe-gold-light text-white font-semibold rounded-lg transition-all text-sm uppercase tracking-wider"
          >
            Create Your Account
            <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </section>
    </div>
  );
}

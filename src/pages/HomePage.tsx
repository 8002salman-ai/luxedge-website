import { ArrowRight, Star, Truck, Shield, RotateCcw, Zap, Award, Users, Package, ChevronRight, Quote } from 'lucide-react';
import { useInView } from '../hooks/useInView';
import ProductCard from '../components/ProductCard';
import { products, testimonials, categories } from '../data/products';
import type { Product } from '../data/products';
import { useState } from 'react';

interface HomePageProps {
  onNavigate: (page: string) => void;
  onAddToCart: (product: Product) => void;
  onQuickView: (product: Product) => void;
}

function AnimatedSection({ children, className = '', delay = '' }: { children: React.ReactNode; className?: string; delay?: string }) {
  const { ref, isInView } = useInView(0.1);
  return (
    <div
      ref={ref}
      className={`${className} ${isInView ? `animate-fade-in-up ${delay}` : 'opacity-0'}`}
    >
      {children}
    </div>
  );
}

export default function HomePage({ onNavigate, onAddToCart, onQuickView }: HomePageProps) {
  const [activeCategory, setActiveCategory] = useState('All');

  const filteredProducts = activeCategory === 'All'
    ? products
    : products.filter(p => p.category === activeCategory);

  return (
    <div>
      {/* ========== HERO SECTION ========== */}
      <section className="relative min-h-[90vh] flex items-center overflow-hidden bg-luxe-black">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '40px 40px'
          }} />
        </div>

        {/* Gradient Orbs */}
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-luxe-gold/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 left-1/4 w-72 h-72 bg-luxe-gold/5 rounded-full blur-[100px]" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full text-luxe-gold text-xs tracking-widest uppercase font-semibold animate-fade-in">
                <Zap size={12} />
                Curated Excellence — New Arrivals Weekly
              </div>

              <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold text-white leading-[1.1] animate-fade-in-up">
                Discover Products
                <br />
                <span className="text-gold-gradient">Worth Owning.</span>
              </h1>

              <p className="text-lg text-luxe-silver max-w-lg leading-relaxed animate-fade-in-up delay-200">
                We sift through thousands of products so you don't have to. Every item on Luxedge is handpicked for quality, design, and value — then delivered straight to your door.
              </p>

              <div className="flex flex-wrap gap-4 animate-fade-in-up delay-300">
                <button
                  onClick={() => onNavigate('shop')}
                  className="group px-8 py-4 bg-luxe-gold hover:bg-luxe-gold-light text-white font-semibold rounded-lg transition-all duration-300 flex items-center gap-3 text-sm uppercase tracking-wider btn-shimmer"
                >
                  Shop Now
                  <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </button>
                <button
                  onClick={() => onNavigate('about')}
                  className="px-8 py-4 border border-white/20 hover:border-luxe-gold text-white hover:text-luxe-gold rounded-lg transition-all duration-300 text-sm uppercase tracking-wider"
                >
                  Our Story
                </button>
              </div>

              {/* Social Proof */}
              <div className="flex items-center gap-6 pt-4 animate-fade-in-up delay-400">
                <div className="flex -space-x-3">
                  {['S', 'J', 'E', 'M', '+'].map((letter, i) => (
                    <div
                      key={i}
                      className={`w-10 h-10 rounded-full border-2 border-luxe-black flex items-center justify-center text-xs font-bold ${
                        i === 4 ? 'bg-luxe-gold text-white' : 'bg-luxe-charcoal text-luxe-silver'
                      }`}
                    >
                      {letter === '+' ? '2k+' : letter}
                    </div>
                  ))}
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

            {/* Right - Featured Products Grid */}
            <div className="hidden lg:grid grid-cols-2 gap-4 animate-fade-in delay-300">
              {products.slice(0, 4).map((product, i) => (
                <div
                  key={product.id}
                  className={`relative rounded-2xl overflow-hidden cursor-pointer group ${
                    i === 0 ? 'row-span-2' : ''
                  }`}
                  onClick={() => onQuickView(product)}
                >
                  <img
                    src={product.image}
                    alt={product.name}
                    className={`w-full object-cover group-hover:scale-105 transition-transform duration-700 ${
                      i === 0 ? 'h-full' : 'h-48'
                    }`}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4">
                    <p className="text-white text-sm font-semibold">{product.name}</p>
                    <p className="text-luxe-gold text-sm font-bold">${product.price}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce">
          <span className="text-luxe-silver text-[10px] uppercase tracking-widest">Scroll</span>
          <div className="w-5 h-8 border border-white/20 rounded-full flex items-start justify-center p-1">
            <div className="w-1.5 h-1.5 bg-luxe-gold rounded-full" />
          </div>
        </div>
      </section>

      {/* ========== TRUST BAR ========== */}
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

      {/* ========== PROBLEM → SOLUTION ========== */}
      <section className="py-20 lg:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Why Luxedge Exists</p>
            <h2 className="font-serif text-3xl lg:text-4xl font-bold text-luxe-dark mb-6">
              Tired of Online Shopping Roulette?
            </h2>
            <p className="text-luxe-gray leading-relaxed">
              You've been there: hours of scrolling, confusing reviews, and products that look nothing like the photos. You deserve better than that. Luxedge was built to end the guesswork.
            </p>
          </AnimatedSection>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                emoji: '😤',
                problem: 'The Problem',
                title: 'Overwhelmed by Choice',
                desc: 'Thousands of products, fake reviews, and inconsistent quality make online shopping exhausting and risky.',
              },
              {
                emoji: '🔍',
                problem: 'Our Approach',
                title: 'We Do the Research',
                desc: 'Our team tests, reviews, and curates only the top 1% of products. If it doesn\'t meet our standards, it doesn\'t make the cut.',
              },
              {
                emoji: '✨',
                problem: 'Your Result',
                title: 'Shop with Confidence',
                desc: 'Every product on Luxedge is vetted for quality, value, and style. You get premium products without the premium markup.',
              },
            ].map((item, i) => (
              <AnimatedSection key={i} delay={`delay-${(i + 1) * 200}`}>
                <div className="text-center p-8 rounded-2xl border border-gray-100 hover:border-luxe-gold/30 hover:shadow-[0_8px_40px_rgba(201,169,110,0.08)] transition-all duration-500">
                  <span className="text-4xl mb-4 block">{item.emoji}</span>
                  <p className="text-luxe-gold text-[10px] uppercase tracking-widest font-semibold mb-2">{item.problem}</p>
                  <h3 className="font-serif text-xl font-bold text-luxe-dark mb-3">{item.title}</h3>
                  <p className="text-sm text-luxe-gray leading-relaxed">{item.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ========== FEATURED PRODUCTS ========== */}
      <section className="py-20 lg:py-28 bg-luxe-cream/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-12">
            <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Handpicked For You</p>
            <h2 className="font-serif text-3xl lg:text-4xl font-bold text-luxe-dark mb-4">
              Trending This Week
            </h2>
            <p className="text-luxe-gray max-w-xl mx-auto">
              Our editors' top picks — products that are flying off the shelves. Don't miss out.
            </p>
          </AnimatedSection>

          {/* Category Filter */}
          <div className="flex flex-wrap justify-center gap-2 mb-12">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wider transition-all duration-300 ${
                  activeCategory === cat
                    ? 'bg-luxe-black text-white'
                    : 'bg-white text-luxe-gray hover:bg-luxe-black hover:text-white border border-gray-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Products Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onAddToCart={onAddToCart}
                onQuickView={onQuickView}
              />
            ))}
          </div>

          <div className="text-center mt-12">
            <button
              onClick={() => onNavigate('shop')}
              className="group inline-flex items-center gap-2 px-8 py-4 bg-luxe-black hover:bg-luxe-gold text-white font-semibold rounded-lg transition-all duration-300 text-sm uppercase tracking-wider btn-shimmer"
            >
              View All Products
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      {/* ========== STATS BAR ========== */}
      <section className="bg-luxe-black py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { value: '2,000+', label: 'Happy Customers', icon: Users },
              { value: '500+', label: 'Products Curated', icon: Package },
              { value: '4.8/5', label: 'Average Rating', icon: Star },
              { value: '99%', label: 'Satisfaction Rate', icon: Award },
            ].map((stat, i) => (
              <AnimatedSection key={i} className="text-center" delay={`delay-${(i + 1) * 100}`}>
                <stat.icon size={24} className="mx-auto text-luxe-gold mb-3" />
                <p className="text-3xl lg:text-4xl font-bold text-white mb-1">{stat.value}</p>
                <p className="text-luxe-silver text-sm">{stat.label}</p>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ========== BENEFITS ========== */}
      <section className="py-20 lg:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <AnimatedSection>
              <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">The Luxedge Difference</p>
              <h2 className="font-serif text-3xl lg:text-4xl font-bold text-luxe-dark mb-6">
                Premium Products.<br />Honest Prices.<br />Zero Guesswork.
              </h2>
              <p className="text-luxe-gray leading-relaxed mb-8">
                We're not just another online store. We're your personal product curator — finding the best items the internet has to offer, verifying their quality, and bringing them to you at prices that make sense.
              </p>

              <div className="space-y-6">
                {[
                  {
                    title: 'Hand-Curated Selection',
                    desc: 'Every product passes our 15-point quality check. Only the best make it to our store.',
                  },
                  {
                    title: 'Transparent Pricing',
                    desc: 'No hidden fees, no markups. We negotiate directly to bring you the best value.',
                  },
                  {
                    title: 'Risk-Free Guarantee',
                    desc: '30-day returns, no questions asked. Your satisfaction is literally our business.',
                  },
                ].map((benefit, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="w-8 h-8 bg-luxe-gold/10 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                      <ChevronRight size={14} className="text-luxe-gold" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-luxe-dark mb-1">{benefit.title}</h4>
                      <p className="text-sm text-luxe-gray">{benefit.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </AnimatedSection>

            <AnimatedSection delay="delay-200">
              <div className="relative">
                <div className="aspect-[4/5] rounded-2xl overflow-hidden">
                  <img
                    src="https://images.pexels.com/photos/2453658/pexels-photo-2453658.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200"
                    alt="Premium curated products"
                    className="w-full h-full object-cover"
                  />
                </div>
                {/* Floating Card */}
                <div className="absolute -bottom-6 -left-6 bg-white rounded-xl p-5 shadow-xl border border-gray-100 max-w-[200px]">
                  <div className="flex items-center gap-1 mb-2">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} size={12} className="text-luxe-gold fill-luxe-gold" />
                    ))}
                  </div>
                  <p className="text-xs text-luxe-gray leading-relaxed">
                    "Best online store I've ever shopped at. Period."
                  </p>
                  <p className="text-[10px] text-luxe-gold font-semibold mt-2">— Sarah M., Austin TX</p>
                </div>
                {/* Stats Card */}
                <div className="absolute -top-4 -right-4 bg-luxe-gold text-white rounded-xl p-4 shadow-xl">
                  <p className="text-2xl font-bold">99%</p>
                  <p className="text-[10px] uppercase tracking-wider">Satisfaction</p>
                </div>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* ========== TESTIMONIALS ========== */}
      <section className="py-20 lg:py-28 bg-luxe-cream/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Social Proof</p>
            <h2 className="font-serif text-3xl lg:text-4xl font-bold text-luxe-dark mb-4">
              Don't Take Our Word For It
            </h2>
            <p className="text-luxe-gray max-w-xl mx-auto">
              Here's what real customers are saying about their Luxedge experience.
            </p>
          </AnimatedSection>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {testimonials.map((testimonial, i) => (
              <AnimatedSection key={testimonial.id} delay={`delay-${(i + 1) * 100}`}>
                <div className="bg-white p-6 rounded-2xl border border-gray-100 hover:border-luxe-gold/20 transition-all duration-300 h-full flex flex-col">
                  <Quote size={20} className="text-luxe-gold/30 mb-4" />
                  <p className="text-sm text-luxe-gray leading-relaxed flex-1 mb-4">
                    "{testimonial.text}"
                  </p>
                  <div className="flex items-center gap-1 mb-3">
                    {[...Array(testimonial.rating)].map((_, j) => (
                      <Star key={j} size={12} className="text-luxe-gold fill-luxe-gold" />
                    ))}
                  </div>
                  <div className="flex items-center gap-3 pt-3 border-t border-gray-50">
                    <div className="w-9 h-9 bg-luxe-gold/10 rounded-full flex items-center justify-center text-xs font-bold text-luxe-gold">
                      {testimonial.avatar}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-luxe-dark">{testimonial.name}</p>
                      <p className="text-[10px] text-luxe-gray">{testimonial.location}</p>
                    </div>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ========== OBJECTION HANDLING / FAQ ========== */}
      <section className="py-20 lg:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Common Questions</p>
            <h2 className="font-serif text-3xl lg:text-4xl font-bold text-luxe-dark mb-4">
              Still on the Fence? Let's Fix That.
            </h2>
          </AnimatedSection>

          <div className="max-w-3xl mx-auto space-y-4">
            {[
              {
                q: 'How is the product quality?',
                a: 'Every product goes through our 15-point quality check. We order samples, test them ourselves, and only list products that meet our premium standards. If you\'re not satisfied, we\'ll refund you — no questions asked.',
              },
              {
                q: 'How long does shipping take?',
                a: 'Most orders ship within 1-3 business days. Standard delivery takes 7-14 business days depending on your location. We also offer express shipping options at checkout.',
              },
              {
                q: 'What if I don\'t like my purchase?',
                a: 'We offer a 30-day hassle-free return policy. Simply reach out to our support team, and we\'ll arrange a return or exchange. Your satisfaction is our top priority.',
              },
              {
                q: 'Is my payment information secure?',
                a: 'Absolutely. We use 256-bit SSL encryption and work with trusted payment processors (Stripe, PayPal). Your payment data never touches our servers.',
              },
              {
                q: 'Do you offer tracking?',
                a: 'Yes! Every order comes with a tracking number. You\'ll get email updates at every step — from the moment we ship to the moment it arrives at your door.',
              },
            ].map((faq, i) => (
              <AnimatedSection key={i} delay={`delay-${(i + 1) * 100}`}>
                <details className="group bg-luxe-cream/50 rounded-xl border border-gray-100 hover:border-luxe-gold/20 transition-colors">
                  <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
                    <h3 className="font-semibold text-luxe-dark text-sm pr-4">{faq.q}</h3>
                    <ChevronRight size={16} className="text-luxe-gold shrink-0 group-open:rotate-90 transition-transform duration-300" />
                  </summary>
                  <div className="px-5 pb-5">
                    <p className="text-sm text-luxe-gray leading-relaxed">{faq.a}</p>
                  </div>
                </details>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ========== FINAL CTA ========== */}
      <section className="py-20 lg:py-28 bg-luxe-black relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-luxe-gold/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-luxe-gold/5 rounded-full blur-[100px]" />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <AnimatedSection>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full text-luxe-gold text-xs tracking-widest uppercase font-semibold mb-8">
              <Zap size={12} />
              Limited Time — Save Up to 60%
            </div>

            <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight">
              Ready to Upgrade Your Life?
              <br />
              <span className="text-gold-gradient">Start Shopping Smarter.</span>
            </h2>

            <p className="text-luxe-silver max-w-xl mx-auto mb-10 leading-relaxed">
              Join over 2,000 customers who've discovered the Luxedge difference. Premium products, honest prices, and a shopping experience you'll actually enjoy.
            </p>

            <div className="flex flex-wrap justify-center gap-4">
              <button
                onClick={() => onNavigate('shop')}
                className="group px-10 py-4 bg-luxe-gold hover:bg-luxe-gold-light text-white font-semibold rounded-lg transition-all duration-300 flex items-center gap-3 text-sm uppercase tracking-wider btn-shimmer"
              >
                Shop the Collection
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap justify-center gap-6 mt-10 pt-10 border-t border-white/10">
              {['Free Shipping $50+', '30-Day Returns', 'Secure Checkout', '24/7 Support'].map((badge) => (
                <span key={badge} className="text-luxe-silver text-xs flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-luxe-gold rounded-full" />
                  {badge}
                </span>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </section>
    </div>
  );
}

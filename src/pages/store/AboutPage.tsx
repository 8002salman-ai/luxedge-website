import { Link } from 'react-router-dom';
import { ArrowRight, Target, Eye, Heart } from 'lucide-react';

export default function AboutPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-luxe-black py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Our Story</p>
            <h1 className="font-serif text-4xl lg:text-5xl font-bold text-white mb-6">
              We Believe Shopping Online
              <br />
              <span className="text-gold-gradient">Should Be Simple.</span>
            </h1>
            <p className="text-luxe-silver text-lg">
              Luxedge was born from a simple frustration: finding quality products online shouldn't feel like a treasure hunt.
            </p>
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <img
                src="https://images.pexels.com/photos/2453658/pexels-photo-2453658.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200"
                alt="Luxedge products"
                className="rounded-2xl"
              />
            </div>
            <div>
              <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Where It Started</p>
              <h2 className="font-serif text-3xl font-bold text-luxe-dark mb-6">From Frustration to a Movement</h2>
              <div className="space-y-4 text-luxe-gray leading-relaxed">
                <p>
                  It started with a bad purchase. Then another. Endless scrolling through mediocre products with exaggerated descriptions.
                </p>
                <p>
                  What if someone actually tested these products? What if there was a store where every item was vetted and genuinely worth buying?
                </p>
                <p className="font-semibold text-luxe-dark">
                  That's exactly what Luxedge is. Based in Irving, Texas, we find the best items and bring them to you at honest prices.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-20 bg-luxe-cream/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="font-serif text-3xl font-bold text-luxe-dark">What Drives Us</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Target, title: 'Our Mission', desc: 'Make premium-quality products accessible to everyone.' },
              { icon: Eye, title: 'Our Vision', desc: 'Become the most trusted curated e-commerce destination.' },
              { icon: Heart, title: 'Our Promise', desc: 'Every product meets our standards. If you\'re not happy, neither are we.' },
            ].map((item, i) => (
              <div key={i} className="bg-white p-8 rounded-2xl border border-gray-100 text-center">
                <div className="w-14 h-14 bg-luxe-gold/10 rounded-xl flex items-center justify-center mx-auto mb-6">
                  <item.icon size={24} className="text-luxe-gold" />
                </div>
                <h3 className="font-serif text-xl font-bold text-luxe-dark mb-4">{item.title}</h3>
                <p className="text-sm text-luxe-gray">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-luxe-black">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="font-serif text-3xl font-bold text-white mb-6">Ready to Experience the Difference?</h2>
          <Link
            to="/shop"
            className="inline-flex items-center gap-3 px-10 py-4 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg transition-all"
          >
            Start Shopping
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </div>
  );
}

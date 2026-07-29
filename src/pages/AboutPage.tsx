import { ArrowRight, Target, Eye, Heart, CheckCircle, Users, Award, Package, Globe } from 'lucide-react';
import { useInView } from '../hooks/useInView';

interface AboutPageProps {
  onNavigate: (page: string) => void;
}

function AnimatedSection({ children, className = '', delay = '' }: { children: React.ReactNode; className?: string; delay?: string }) {
  const { ref, isInView } = useInView(0.1);
  return (
    <div ref={ref} className={`${className} ${isInView ? `animate-fade-in-up ${delay}` : 'opacity-0'}`}>
      {children}
    </div>
  );
}

export default function AboutPage({ onNavigate }: AboutPageProps) {
  return (
    <div>
      {/* Hero */}
      <section className="bg-luxe-black py-20 lg:py-32 relative overflow-hidden">
        <div className="absolute top-1/4 right-1/3 w-96 h-96 bg-luxe-gold/5 rounded-full blur-[120px]" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Our Story</p>
            <h1 className="font-serif text-4xl lg:text-5xl xl:text-6xl font-bold text-white mb-6 leading-tight">
              We Believe Shopping Online
              <br />
              <span className="text-gold-gradient">Should Be Simple.</span>
            </h1>
            <p className="text-luxe-silver text-lg leading-relaxed">
              Luxedge was born from a simple frustration: finding quality products online shouldn't feel like a treasure hunt. So we built something better.
            </p>
          </div>
        </div>
      </section>

      {/* Origin Story */}
      <section className="py-20 lg:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <AnimatedSection>
              <div className="relative">
                <div className="aspect-[4/3] rounded-2xl overflow-hidden">
                  <img
                    src="https://images.pexels.com/photos/2453658/pexels-photo-2453658.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200"
                    alt="Luxedge curated products"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="absolute -bottom-6 -right-6 bg-luxe-gold text-white p-6 rounded-xl shadow-xl">
                  <p className="text-3xl font-bold">2024</p>
                  <p className="text-xs uppercase tracking-wider">Founded</p>
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection delay="delay-200">
              <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Where It Started</p>
              <h2 className="font-serif text-3xl lg:text-4xl font-bold text-luxe-dark mb-6">
                From Frustration to a Movement
              </h2>
              <div className="space-y-4 text-luxe-gray leading-relaxed">
                <p>
                  It started with a bad purchase. Then another. And another. Endless scrolling through mediocre products with exaggerated descriptions and questionable quality.
                </p>
                <p>
                  We knew there had to be a better way. What if someone actually tested these products? What if there was a store where every single item was vetted, verified, and genuinely worth buying?
                </p>
                <p>
                  That's exactly what Luxedge is. Based in Irving, Texas, we're a team of product enthusiasts who obsess over finding the best items from around the world — then bring them to you at honest prices.
                </p>
                <p className="font-semibold text-luxe-dark">
                  No filler. No fluff. Just products worth owning.
                </p>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* Mission, Vision, Values */}
      <section className="py-20 lg:py-28 bg-luxe-cream/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">What Drives Us</p>
            <h2 className="font-serif text-3xl lg:text-4xl font-bold text-luxe-dark">
              Built on Three Pillars
            </h2>
          </AnimatedSection>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Target,
                title: 'Our Mission',
                desc: 'To make premium-quality products accessible to everyone by cutting through the noise of online shopping and delivering only the best.',
              },
              {
                icon: Eye,
                title: 'Our Vision',
                desc: 'To become the most trusted curated e-commerce destination — where every purchase feels like a smart decision, not a gamble.',
              },
              {
                icon: Heart,
                title: 'Our Promise',
                desc: 'Every product meets our quality standards. Every price is fair. Every customer is treated like family. If you\'re not happy, neither are we.',
              },
            ].map((item, i) => (
              <AnimatedSection key={i} delay={`delay-${(i + 1) * 200}`}>
                <div className="bg-white p-8 rounded-2xl border border-gray-100 hover:border-luxe-gold/20 hover:shadow-lg transition-all duration-500 text-center h-full">
                  <div className="w-14 h-14 bg-luxe-gold/10 rounded-xl flex items-center justify-center mx-auto mb-6">
                    <item.icon size={24} className="text-luxe-gold" />
                  </div>
                  <h3 className="font-serif text-xl font-bold text-luxe-dark mb-4">{item.title}</h3>
                  <p className="text-sm text-luxe-gray leading-relaxed">{item.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* How We Curate */}
      <section className="py-20 lg:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Our Process</p>
            <h2 className="font-serif text-3xl lg:text-4xl font-bold text-luxe-dark mb-4">
              How Products Make the Cut
            </h2>
            <p className="text-luxe-gray max-w-xl mx-auto">
              Not everything makes it to Luxedge. In fact, most products don't. Here's our curation process.
            </p>
          </AnimatedSection>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                step: '01',
                title: 'Scout',
                desc: 'We scan thousands of products daily, looking for items with exceptional value and design.',
              },
              {
                step: '02',
                title: 'Test',
                desc: 'We order samples and put them through real-world testing. Quality, durability, and value are non-negotiable.',
              },
              {
                step: '03',
                title: 'Verify',
                desc: 'We cross-reference reviews, check supplier reliability, and verify materials and specifications.',
              },
              {
                step: '04',
                title: 'Deliver',
                desc: 'Only the top 1% make it to our store. Then we ship them to you with our full satisfaction guarantee.',
              },
            ].map((item, i) => (
              <AnimatedSection key={i} delay={`delay-${(i + 1) * 100}`}>
                <div className="relative">
                  <span className="text-6xl font-bold text-luxe-gold/10 font-serif">{item.step}</span>
                  <h3 className="text-lg font-bold text-luxe-dark -mt-3 mb-2">{item.title}</h3>
                  <p className="text-sm text-luxe-gray leading-relaxed">{item.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Why Trust Us */}
      <section className="py-20 lg:py-28 bg-luxe-black">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">By the Numbers</p>
            <h2 className="font-serif text-3xl lg:text-4xl font-bold text-white">
              Trust Built on Results
            </h2>
          </AnimatedSection>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { icon: Users, value: '2,000+', label: 'Customers Served' },
              { icon: Package, value: '5,000+', label: 'Orders Fulfilled' },
              { icon: Award, value: '99%', label: 'Satisfaction Rate' },
              { icon: Globe, value: '50+', label: 'States Reached' },
            ].map((stat, i) => (
              <AnimatedSection key={i} className="text-center" delay={`delay-${(i + 1) * 100}`}>
                <stat.icon size={28} className="mx-auto text-luxe-gold mb-4" />
                <p className="text-3xl lg:text-4xl font-bold text-white mb-1">{stat.value}</p>
                <p className="text-luxe-silver text-sm">{stat.label}</p>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Values List */}
      <section className="py-20 lg:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <AnimatedSection>
              <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">What We Stand For</p>
              <h2 className="font-serif text-3xl lg:text-4xl font-bold text-luxe-dark mb-8">
                Our Values Aren't Just Words on a Wall
              </h2>

              <div className="space-y-5">
                {[
                  { title: 'Quality Over Quantity', desc: 'We\'d rather stock 100 amazing products than 10,000 mediocre ones.' },
                  { title: 'Radical Transparency', desc: 'What you see is what you get. Real photos, honest descriptions, true pricing.' },
                  { title: 'Customer Obsession', desc: 'Every decision we make starts with one question: "Is this good for the customer?"' },
                  { title: 'Continuous Improvement', desc: 'We listen to every review, every complaint, every suggestion. Then we act on it.' },
                ].map((value, i) => (
                  <div key={i} className="flex gap-4">
                    <CheckCircle size={20} className="text-luxe-gold shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-luxe-dark mb-1">{value.title}</h4>
                      <p className="text-sm text-luxe-gray">{value.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </AnimatedSection>

            <AnimatedSection delay="delay-200">
              <div className="bg-luxe-cream rounded-2xl p-8 lg:p-12">
                <blockquote className="font-serif text-2xl text-luxe-dark leading-relaxed mb-6 italic">
                  "We don't sell products. We solve the problem of not knowing what to buy."
                </blockquote>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-luxe-gold rounded-full flex items-center justify-center text-white font-bold text-sm">
                    LE
                  </div>
                  <div>
                    <p className="font-semibold text-luxe-dark">Luxedge Team</p>
                    <p className="text-xs text-luxe-gray">Irving, Texas</p>
                  </div>
                </div>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-luxe-cream">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <AnimatedSection>
            <h2 className="font-serif text-3xl lg:text-4xl font-bold text-luxe-dark mb-4">
              Ready to Experience the Difference?
            </h2>
            <p className="text-luxe-gray max-w-xl mx-auto mb-8">
              Browse our curated collection and see why thousands of customers trust Luxedge for their online shopping needs.
            </p>
            <button
              onClick={() => onNavigate('shop')}
              className="group inline-flex items-center gap-3 px-10 py-4 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg transition-all duration-300 text-sm uppercase tracking-wider btn-shimmer"
            >
              Start Shopping
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </AnimatedSection>
        </div>
      </section>
    </div>
  );
}

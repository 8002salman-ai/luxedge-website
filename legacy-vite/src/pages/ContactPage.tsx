import { useState } from 'react';
import { Mail, Phone, MapPin, Clock, Send, MessageCircle, HelpCircle, ArrowRight } from 'lucide-react';
import { useInView } from '../hooks/useInView';

function AnimatedSection({ children, className = '', delay = '' }: { children: React.ReactNode; className?: string; delay?: string }) {
  const { ref, isInView } = useInView(0.1);
  return (
    <div ref={ref} className={`${className} ${isInView ? `animate-fade-in-up ${delay}` : 'opacity-0'}`}>
      {children}
    </div>
  );
}

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 5000);
    setFormData({ name: '', email: '', subject: '', message: '' });
  };

  return (
    <div>
      {/* Hero */}
      <section className="bg-luxe-black py-16 lg:py-24 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-luxe-gold/5 rounded-full blur-[120px]" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Get In Touch</p>
          <h1 className="font-serif text-4xl lg:text-5xl font-bold text-white mb-4">
            We'd Love to Hear From You
          </h1>
          <p className="text-luxe-silver max-w-xl mx-auto">
            Questions, feedback, or just want to say hi? Our team is here to help — and we respond fast.
          </p>
        </div>
      </section>

      {/* Contact Info Cards */}
      <section className="py-12 bg-luxe-cream/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 -mt-20 relative z-10">
            {[
              {
                icon: Phone,
                label: 'Call Us',
                value: '(440) 941-8002',
                sub: 'Mon-Fri, 9AM-6PM CT',
              },
              {
                icon: Mail,
                label: 'Email Us',
                value: 'hello@luxedge.us',
                sub: 'We reply within 24 hours',
              },
              {
                icon: MapPin,
                label: 'Location',
                value: 'Irving, TX',
                sub: 'United States',
              },
              {
                icon: Clock,
                label: 'Business Hours',
                value: 'Mon - Fri',
                sub: '9:00 AM - 6:00 PM CT',
              },
            ].map((item, i) => (
              <AnimatedSection key={i} delay={`delay-${(i + 1) * 100}`}>
                <div className="bg-white p-6 rounded-xl border border-gray-100 hover:border-luxe-gold/20 hover:shadow-lg transition-all duration-500 text-center">
                  <div className="w-12 h-12 bg-luxe-gold/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                    <item.icon size={20} className="text-luxe-gold" />
                  </div>
                  <p className="text-[10px] text-luxe-gold uppercase tracking-widest font-semibold mb-1">{item.label}</p>
                  <p className="font-semibold text-luxe-dark">{item.value}</p>
                  <p className="text-xs text-luxe-gray mt-1">{item.sub}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Form & FAQ */}
      <section className="py-20 lg:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16">
            {/* Form */}
            <AnimatedSection>
              <div className="bg-luxe-cream/50 p-8 lg:p-10 rounded-2xl border border-gray-100">
                <div className="flex items-center gap-3 mb-6">
                  <MessageCircle size={20} className="text-luxe-gold" />
                  <h2 className="font-serif text-2xl font-bold text-luxe-dark">Send Us a Message</h2>
                </div>
                <p className="text-sm text-luxe-gray mb-8">
                  Fill out the form below and we'll get back to you within 24 hours. We read and respond to every single message.
                </p>

                {submitted ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-luxe-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Send size={24} className="text-luxe-success" />
                    </div>
                    <h3 className="font-serif text-xl font-bold text-luxe-dark mb-2">Message Sent!</h3>
                    <p className="text-sm text-luxe-gray">
                      Thank you for reaching out. We'll get back to you within 24 hours.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid sm:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                          Full Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-luxe-gold transition-colors"
                          placeholder="John Doe"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                          Email *
                        </label>
                        <input
                          type="email"
                          required
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-luxe-gold transition-colors"
                          placeholder="john@example.com"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                        Subject *
                      </label>
                      <select
                        required
                        value={formData.subject}
                        onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-luxe-gold transition-colors appearance-none cursor-pointer"
                      >
                        <option value="">Select a topic</option>
                        <option value="order">Order Question</option>
                        <option value="shipping">Shipping & Tracking</option>
                        <option value="return">Returns & Refunds</option>
                        <option value="product">Product Inquiry</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                        Message *
                      </label>
                      <textarea
                        required
                        rows={5}
                        value={formData.message}
                        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-luxe-gold transition-colors resize-none"
                        placeholder="Tell us how we can help..."
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg transition-all duration-300 flex items-center justify-center gap-2 uppercase text-sm tracking-wider btn-shimmer"
                    >
                      <Send size={16} />
                      Send Message
                    </button>
                  </form>
                )}
              </div>
            </AnimatedSection>

            {/* FAQ */}
            <AnimatedSection delay="delay-200">
              <div className="flex items-center gap-3 mb-6">
                <HelpCircle size={20} className="text-luxe-gold" />
                <h2 className="font-serif text-2xl font-bold text-luxe-dark">Frequently Asked</h2>
              </div>
              <p className="text-sm text-luxe-gray mb-8">
                Quick answers to common questions. Can't find what you need? Use the form and we'll help.
              </p>

              <div className="space-y-4">
                {[
                  {
                    q: 'Where do your products come from?',
                    a: 'We source products from verified global suppliers and manufacturers. Every product is quality-tested before being listed on our store.',
                  },
                  {
                    q: 'How long does shipping take?',
                    a: 'Most orders ship within 1-3 business days. Standard delivery takes 7-14 business days. Express options are available at checkout.',
                  },
                  {
                    q: 'Can I return or exchange an item?',
                    a: 'Yes! We offer a 30-day hassle-free return policy. If you\'re not satisfied, contact us and we\'ll arrange a return or exchange at no cost.',
                  },
                  {
                    q: 'Do you offer international shipping?',
                    a: 'Currently, we ship within the United States. International shipping is coming soon — sign up for our newsletter to be notified.',
                  },
                  {
                    q: 'How can I track my order?',
                    a: 'Once your order ships, you\'ll receive a tracking number via email. You can also contact us with your order number for updates.',
                  },
                  {
                    q: 'Is it safe to shop on Luxedge?',
                    a: 'Absolutely. We use 256-bit SSL encryption and trusted payment processors (Stripe, PayPal). Your personal and payment data is always secure.',
                  },
                ].map((faq, i) => (
                  <details key={i} className="group bg-luxe-cream/50 rounded-xl border border-gray-100 hover:border-luxe-gold/20 transition-colors">
                    <summary className="flex items-center justify-between p-4 cursor-pointer list-none">
                      <h3 className="font-semibold text-luxe-dark text-sm pr-4">{faq.q}</h3>
                      <ArrowRight size={14} className="text-luxe-gold shrink-0 group-open:rotate-90 transition-transform duration-300" />
                    </summary>
                    <div className="px-4 pb-4">
                      <p className="text-sm text-luxe-gray leading-relaxed">{faq.a}</p>
                    </div>
                  </details>
                ))}
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* Map / Location */}
      <section className="py-16 bg-luxe-cream/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <AnimatedSection>
            <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Based In Texas</p>
            <h2 className="font-serif text-2xl lg:text-3xl font-bold text-luxe-dark mb-4">
              Proudly Serving From Irving, TX 🇺🇸
            </h2>
            <p className="text-luxe-gray max-w-xl mx-auto mb-8">
              We're a US-based business committed to providing exceptional service and quality products to customers nationwide.
            </p>
            <div className="grid sm:grid-cols-3 gap-6 max-w-2xl mx-auto">
              {[
                { label: 'Response Time', value: '< 24 Hours' },
                { label: 'Support', value: 'Mon-Fri, 9-6 CT' },
                { label: 'Satisfaction', value: '99% Happy' },
              ].map((stat, i) => (
                <div key={i} className="bg-white p-4 rounded-xl border border-gray-100">
                  <p className="text-xs text-luxe-gray mb-1">{stat.label}</p>
                  <p className="font-bold text-luxe-dark">{stat.value}</p>
                </div>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </section>
    </div>
  );
}

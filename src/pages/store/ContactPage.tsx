import { useState } from 'react';
import { Mail, Phone, MapPin, Clock, Send } from 'lucide-react';
import { useNotificationStore } from '../../store/notificationStore';

export default function ContactPage() {
  const addNotification = useNotificationStore((state) => state.addNotification);
  const [formData, setFormData] = useState({ name: '', email: '', subject: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    addNotification({ type: 'success', message: 'Message sent! We\'ll get back to you soon.' });
    setFormData({ name: '', email: '', subject: '', message: '' });
    setTimeout(() => setSubmitted(false), 5000);
  };

  return (
    <div>
      {/* Hero */}
      <section className="bg-luxe-black py-16 lg:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-luxe-gold text-xs uppercase tracking-widest font-semibold mb-4">Get In Touch</p>
          <h1 className="font-serif text-4xl lg:text-5xl font-bold text-white mb-4">
            We'd Love to Hear From You
          </h1>
          <p className="text-luxe-silver max-w-xl mx-auto">
            Questions, feedback, or just want to say hi? Our team is here to help.
          </p>
        </div>
      </section>

      {/* Contact Info */}
      <section className="py-12 bg-luxe-cream/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 -mt-16">
            {[
              { icon: Phone, label: 'Call Us', value: '(440) 941-8002', sub: 'Mon-Fri, 9AM-6PM CT' },
              { icon: Mail, label: 'Email Us', value: 'hello@luxedge.us', sub: 'We reply within 24 hours' },
              { icon: MapPin, label: 'Location', value: 'Irving, TX', sub: 'United States' },
              { icon: Clock, label: 'Business Hours', value: 'Mon - Fri', sub: '9:00 AM - 6:00 PM CT' },
            ].map((item, i) => (
              <div key={i} className="bg-white p-6 rounded-xl border border-gray-100 text-center">
                <div className="w-12 h-12 bg-luxe-gold/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <item.icon size={20} className="text-luxe-gold" />
                </div>
                <p className="text-[10px] text-luxe-gold uppercase tracking-widest font-semibold mb-1">{item.label}</p>
                <p className="font-semibold text-luxe-dark">{item.value}</p>
                <p className="text-xs text-luxe-gray mt-1">{item.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Form */}
      <section className="py-20 bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-luxe-cream/50 p-8 lg:p-10 rounded-2xl border border-gray-100">
            <h2 className="font-serif text-2xl font-bold text-luxe-dark mb-6 text-center">Send Us a Message</h2>

            {submitted ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Send size={24} className="text-green-500" />
                </div>
                <h3 className="font-serif text-xl font-bold text-luxe-dark mb-2">Message Sent!</h3>
                <p className="text-sm text-luxe-gray">We'll get back to you within 24 hours.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-luxe-gold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-luxe-gold"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                    Subject
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-luxe-gold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-luxe-dark uppercase tracking-wider mb-2">
                    Message
                  </label>
                  <textarea
                    required
                    rows={5}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-luxe-gold resize-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                >
                  <Send size={16} />
                  Send Message
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

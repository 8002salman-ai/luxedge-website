import { useEffect } from 'react';
import { ChatTeardropDots } from '@phosphor-icons/react';

const WA_LINK = 'https://wa.me/14409418002'; // owner's WhatsApp: +1 440-941-8002

// Floating WhatsApp button (bottom-left, away from the assistant bubble).
// Opens wa.me with a pre-filled inquiry and fires a CRM lead (source=whatsapp)
// so every inquiry lands in the admin CRM.
export default function WhatsAppButton() {
  useEffect(() => {
    try {
      fetch('/api/crm/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'whatsapp', pageUrl: window.location.pathname, name: 'WhatsApp visitor', optedIn: false }),
      }).catch(() => undefined);
    } catch {
      /* best-effort lead capture */
    }
  }, []);

  const openChat = () => {
    const text = encodeURIComponent('Hi Luxedge! I have a question about your pet products. 🐾');
    window.open(`${WA_LINK}?text=${text}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <button onClick={openChat} aria-label="Chat on WhatsApp"
      className="fixed bottom-5 left-5 z-[125] flex items-center gap-2.5 pl-2 pr-4 py-2 rounded-full bg-[#25D366] hover:bg-[#1ebe5b] text-white shadow-xl shadow-emerald-500/30 transition-all hover:scale-105 group">
      <span className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
        <ChatTeardropDots size={20} weight="fill" />
      </span>
      <span className="text-[13px] font-bold leading-tight text-left">
        WhatsApp
        <span className="block text-[10px] font-medium text-white/85">Chat with us</span>
      </span>
    </button>
  );
}

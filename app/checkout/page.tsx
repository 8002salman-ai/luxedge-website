import { LockKeyhole } from "lucide-react";

export default function CheckoutPage() {
  return <section className="empty-page"><LockKeyhole size={38} strokeWidth={1.3} /><p className="eyebrow"><span /> Secure checkout</p><h1>Payments are not<br />enabled yet.</h1><p>Checkout will open only after server pricing, order security and Stripe test-mode verification pass.</p></section>;
}

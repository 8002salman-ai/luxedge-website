import Link from "next/link";

export function Footer() {
  return <footer className="footer">
    <div><p className="brand footer-brand">LUX<span>EDGE</span></p><p>Considered essentials for life with pets.</p></div>
    <div className="footer-links"><Link href="/shop">Shop</Link><Link href="/#standard">Our standard</Link><a href="mailto:hello@luxedge.us">hello@luxedge.us</a></div>
    <p className="copyright">© 2026 LuxEdge. All rights reserved.</p>
  </footer>;
}

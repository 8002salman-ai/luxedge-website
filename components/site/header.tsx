import Link from "next/link";
import { Menu, Search, ShoppingBag, UserRound } from "lucide-react";

export function Header() {
  return <header className="site-header">
    <Link className="brand" href="/" aria-label="LuxEdge home">LUX<span>EDGE</span></Link>
    <nav aria-label="Primary navigation"><Link href="/shop">Shop</Link><Link href="/#standard">Our standard</Link><Link href="/#journal">Journal</Link></nav>
    <div className="header-actions"><Link href="/shop" aria-label="Search products"><Search size={19} /></Link><Link href="/login" aria-label="Your account"><UserRound size={19} /></Link><Link href="/cart" aria-label="Shopping bag"><ShoppingBag size={19} /></Link><button className="menu-button" aria-label="Open menu"><Menu size={20} /></button></div>
  </header>;
}

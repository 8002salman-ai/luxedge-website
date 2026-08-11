import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, ClipboardCheck, PackageSearch } from "lucide-react";

export const metadata: Metadata = { title: "Collection" };

export default function ShopPage() {
  return <section className="shop-page section"><p className="eyebrow"><span /> Launch collection</p><div className="shop-intro"><h1>Only what passes<br /><em>the standard.</em></h1><p>Our launch catalog is being verified now. We will not publish placeholder prices, copied supplier claims or products we have not approved.</p></div><div className="gate-card"><div className="gate-icon"><PackageSearch size={34} /></div><div><p className="gate-label">Catalog review in progress</p><h2>The storefront is ready.<br />The products are earning their place.</h2></div><div className="gate-steps"><span><ClipboardCheck size={18} /> Supplier and channel permission</span><span><BadgeCheck size={18} /> Cost, delivery and quality checks</span></div></div><Link className="text-link back-link" href="/"><ArrowLeft size={15} /> Back to home</Link></section>;
}

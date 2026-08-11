import type { Metadata } from "next";
import { PackageSearch, ShieldCheck } from "lucide-react";
import { AddToCartButton } from "@/components/commerce/add-to-cart-button";
import { formatMoney } from "@/lib/commerce/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Collection" };
export const dynamic = "force-dynamic";

type CatalogProduct = {
  id: string;
  slug: string;
  title: string;
  description: string;
  short_description: string;
  image_url: string | null;
  currency: string;
  product_variants: { id: string; sku: string; title: string; price_amount: number; status: string }[];
};

export default async function ShopPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select("id,slug,title,description,short_description,image_url,currency,product_variants(id,sku,title,price_amount,status)").eq("status", "published").order("created_at", { ascending: false });
  const products = (data || []) as CatalogProduct[];

  return <section className="shop-page section"><p className="eyebrow"><span /> The LuxEdge collection</p><div className="shop-intro"><h1>Only what passes<br /><em>the standard.</em></h1><p>Considered essentials for life with pets. Every published price is verified again by our server before an order is created.</p></div>
    {error ? <div className="notice error">The collection could not be loaded. Please try again shortly.</div> : products.length ? <div className="product-grid">{products.map((product) => { const variant = product.product_variants.find((entry) => entry.status === "published"); if (!variant) return null; return <article className="product-card" key={product.id}><div className="product-media">{product.image_url ? <img src={product.image_url} alt="" /> : <PackageSearch size={46} strokeWidth={1.1} />}</div><div className="product-copy"><p className="product-kicker"><ShieldCheck size={13} /> LuxEdge approved</p><h2>{product.title}</h2><p>{product.short_description || product.description || "A considered essential selected for everyday life with pets."}</p><div className="product-buy"><strong>{formatMoney(variant.price_amount, product.currency)}</strong><AddToCartButton item={{ variantId: variant.id, productId: product.id, slug: product.slug, title: product.title, variantTitle: variant.title, sku: variant.sku, priceAmount: variant.price_amount, currency: product.currency, imageUrl: product.image_url }} /></div></div></article>; })}</div> : <div className="gate-card"><div className="gate-icon"><PackageSearch size={34} /></div><div><p className="gate-label">Catalog review in progress</p><h2>The storefront is ready.<br />Products appear after admin approval.</h2></div><div className="gate-steps"><span><ShieldCheck size={18} /> Drafts never appear publicly</span><span><ShieldCheck size={18} /> Prices are verified on the server</span></div></div>}
  </section>;
}

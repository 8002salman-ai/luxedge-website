import type { Metadata } from "next";
import Link from "next/link";
import { PackageSearch, ShieldCheck } from "lucide-react";
import { ProductPurchase } from "@/components/commerce/product-purchase";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Collection" };
export const dynamic = "force-dynamic";

export default async function ShopPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select("id,slug,title,description,short_description,image_url,currency,product_images(public_url,alt_text,sort_order),product_variants(id,sku,title,price_amount,compare_at_amount,status,option_values)").eq("status", "published").order("created_at", { ascending: false });
  const products = (data || []) as any[];
  return <section className="shop-page section"><p className="eyebrow"><span /> The LuxEdge collection</p><div className="shop-intro"><h1>Only what passes<br /><em>the standard.</em></h1><p>Considered essentials for life with pets. Every published price and available quantity is verified again by our server before an order is created.</p></div>
    {error ? <div className="notice error">The collection could not be loaded. Please try again shortly.</div> : products.length ? <div className="product-grid">{products.map((product) => { const variants = (product.product_variants || []).filter((entry: any) => entry.status === "published").map((entry: any) => ({ id: entry.id, sku: entry.sku, title: entry.title, priceAmount: entry.price_amount, compareAtAmount: entry.compare_at_amount, optionValues: entry.option_values || {} })); if (!variants.length) return null; const images = [...(product.product_images || [])].sort((a: any, b: any) => a.sort_order - b.sort_order); const imageUrl = product.image_url || images[0]?.public_url || null; return <article className="product-card" key={product.id}><Link className="product-media" href={`/shop/${product.slug}`}>{imageUrl ? <img src={imageUrl} alt={images.find((image: any) => image.public_url === imageUrl)?.alt_text || product.title} /> : <PackageSearch size={46} strokeWidth={1.1} />}</Link><div className="product-copy"><p className="product-kicker"><ShieldCheck size={13} /> LuxEdge approved</p><Link href={`/shop/${product.slug}`}><h2>{product.title}</h2></Link><p>{product.short_description || product.description || "A considered essential selected for everyday life with pets."}</p><ProductPurchase product={{ id: product.id, slug: product.slug, title: product.title, currency: product.currency, imageUrl }} variants={variants} /></div></article>; })}</div> : <div className="gate-card"><div className="gate-icon"><PackageSearch size={34} /></div><div><p className="gate-label">Catalog review in progress</p><h2>The storefront is ready.<br />Products appear after admin approval.</h2></div><div className="gate-steps"><span><ShieldCheck size={18} /> Drafts never appear publicly</span><span><ShieldCheck size={18} /> Prices are verified on the server</span></div></div>}
  </section>;
}

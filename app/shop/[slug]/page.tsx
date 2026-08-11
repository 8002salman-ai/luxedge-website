import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, PackageSearch, ShieldCheck } from "lucide-react";
import { ProductPurchase } from "@/components/commerce/product-purchase";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const getProduct = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("id,slug,title,description,short_description,image_url,currency,seo_title,seo_description,product_images(public_url,alt_text,sort_order),product_variants(id,sku,title,price_amount,compare_at_amount,status,option_values)").eq("slug", slug).eq("status", "published").single();
  return data as any;
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params; const product = await getProduct(slug);
  if (!product) return { title: "Product not found" };
  return { title: product.seo_title || product.title, description: product.seo_description || product.short_description || product.description, openGraph: { title: product.seo_title || product.title, description: product.seo_description || product.short_description || product.description, images: product.image_url ? [{ url: product.image_url }] : undefined } };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const product = await getProduct(slug); if (!product) notFound();
  const variants = (product.product_variants || []).filter((entry: any) => entry.status === "published").map((entry: any) => ({ id: entry.id, sku: entry.sku, title: entry.title, priceAmount: entry.price_amount, compareAtAmount: entry.compare_at_amount, optionValues: entry.option_values || {} }));
  if (!variants.length) notFound();
  const images = [...(product.product_images || [])].sort((a: any, b: any) => a.sort_order - b.sort_order); const imageUrl = product.image_url || images[0]?.public_url || null;
  return <section className="product-detail section"><Link className="text-link" href="/shop"><ArrowLeft size={14} /> Back to collection</Link><div className="product-detail-grid"><div className="product-gallery">{images.length ? images.map((image: any) => <img key={image.public_url} src={image.public_url} alt={image.alt_text || product.title} />) : <div className="product-media"><PackageSearch size={54} /></div>}</div><div className="product-detail-copy"><p className="product-kicker"><ShieldCheck size={14} /> LuxEdge approved</p><h1>{product.title}</h1><p className="product-detail-lede">{product.short_description}</p><div className="product-description">{product.description}</div><ProductPurchase product={{ id: product.id, slug: product.slug, title: product.title, currency: product.currency, imageUrl }} variants={variants} /><div className="product-assurance"><span>Server-verified pricing</span><span>Secure Stripe-ready payment</span><span>Tracked fulfillment workflow</span></div></div></div></section>;
}

import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createProduct } from "./actions";

export default async function AdminProducts({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: products }, { data: categories }] = await Promise.all([
    supabase.from("products").select("id,title,slug,status,created_at,category:categories(name),product_variants(id,price_amount,status,inventory(available))").order("created_at", { ascending: false }).limit(100),
    supabase.from("categories").select("id,name").order("sort_order").order("name"),
  ]);
  return <><div className="admin-title"><div><p>Catalog</p><h1>Products</h1></div><a className="admin-primary" href="#new"><Plus size={15} /> Add product</a></div>
    {params.error ? <div className="notice error">Product could not be created. Check unique SKU/slug, prices, supplier fields, and required values.</div> : null}
    <section className="admin-panel"><div className="panel-heading"><div><p>Current catalog</p><h2>{products?.length || 0} products</h2></div><span>Open a product to manage media, variants, supplier data, SEO, and publishing.</span></div><div className="advanced-product-list">{products?.length ? products.map((product: any) => { const active = (product.product_variants || []).filter((variant: any) => variant.status !== "archived"); const prices = active.map((variant: any) => variant.price_amount); const stock = active.reduce((sum: number, variant: any) => sum + (variant.inventory?.available || 0), 0); return <article key={product.id}><div><b>{product.title}</b><small>/{product.slug} · {product.category?.name || "Uncategorized"}</small></div><span>{active.length} variant{active.length === 1 ? "" : "s"}</span><span>{prices.length ? `$${(Math.min(...prices) / 100).toFixed(2)}${new Set(prices).size > 1 ? "+" : ""}` : "No price"}</span><span>{stock} in stock</span><span className={`status-pill ${product.status}`}>{product.status}</span><Link className="admin-secondary" href={`/admin/products/${product.id}`}><Pencil size={13} /> Edit</Link></article>; }) : <p className="admin-empty">No products yet. Create the first verified catalog item below.</p>}</div></section>
    <section className="admin-panel" id="new"><div className="panel-heading"><div><p>New product</p><h2>Create product and first variant</h2></div><span>It stays draft until you publish it from the editor.</span></div><form action={createProduct} className="admin-form product-create-form">
      <label>Product title<input name="title" required minLength={2} maxLength={160} /></label><label>URL slug<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="dog-car-seat-cover" /></label><label>Category<select name="categoryId"><option value="">Uncategorized</option>{categories?.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
      <label className="field-wide">Short description<input name="shortDescription" maxLength={300} /></label><label className="field-wide">Full description<textarea name="description" rows={5} /></label>
      <label>Weight (oz)<input name="weightOz" type="number" min="0.1" max="2400" step="0.1" defaultValue="16" required /></label><label>Tax code<input name="taxCode" pattern="txcd_[0-9]{8}" defaultValue="txcd_99999999" required /></label><span className="admin-field-note">Use the Stripe product tax code; the default is general tangible goods.</span>
      <label>Variant name<input name="variantTitle" defaultValue="Default" /></label><label>Color<input name="color" /></label><label>Size<input name="size" /></label><label>SKU<input name="sku" required minLength={2} /></label><label>Price (USD)<input name="price" type="number" required min="0" step="0.01" /></label><label>Compare-at price<input name="compareAt" type="number" min="0" step="0.01" /></label><label>Opening inventory<input name="inventory" type="number" required min="0" step="1" defaultValue="0" /></label>
      <label>Supplier code<input name="supplierCode" placeholder="cj" /></label><label>Supplier SKU<input name="supplierSku" /></label><label>Landed cost (USD)<input name="landedCost" type="number" min="0" step="0.01" /></label><label className="admin-check"><input name="channelApproved" type="checkbox" /> Supplier/channel approved</label>
      <label>SEO title<input name="seoTitle" maxLength={70} /></label><label className="field-wide">SEO description<textarea name="seoDescription" maxLength={170} rows={3} /></label><div className="field-wide"><button className="admin-primary" type="submit">Create product draft</button></div>
    </form></section></>;
}

-- ---------------------------------------------------------------------------
-- 0011 — Fix storefront read of images/variants for ACTIVE products
--
-- 0010 changed storefront product visibility from `status = 'published'` to
-- `status in ('published','active')`, but the product_images/product_variants
-- SELECT policies from 0004 still require `status = 'published'`. As a result
-- an anonymous visitor could see ACTIVE products but NOT their images or
-- variants (RLS returned [] and the storefront fell back to a branded SVG).
--
-- This migration aligns the image/variant read policies with 0010's visibility.
-- ---------------------------------------------------------------------------

drop policy if exists "public read product images" on public.product_images;
create policy "public read product images" on public.product_images for select using (
  exists (select 1 from public.products p where p.id = product_images.product_id and p.status in ('published','active'))
);

drop policy if exists "public read product variants" on public.product_variants;
create policy "public read product variants" on public.product_variants for select using (
  exists (select 1 from public.products p where p.id = product_variants.product_id and p.status in ('published','active'))
);

-- Same alignment for any collection-level reads used by the storefront.
drop policy if exists "public read collection_products" on public.collection_products;
create policy "public read collection_products" on public.collection_products for select using (
  exists (select 1 from public.products p where p.id = collection_products.product_id and p.status in ('published','active'))
  and exists (select 1 from public.collections c where c.id = collection_products.collection_id and c.is_active = true)
);

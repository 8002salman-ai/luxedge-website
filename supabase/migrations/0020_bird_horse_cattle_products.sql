-- LUXEDGE — BIRD / HORSE / CATTLE CATALOG EXPANSION
-- Applied via REST by .freebuff/complete-bird-horse-cattle.mjs on 2026-08-22.
-- This file documents the intent for manual replay / rollback via Supabase SQL Editor.
-- Honest SOURCE_PENDING drafts: real retail price, NULL cost/supplier (no invented facts).

-- 1) Fix $0 bird seed retail prices (currently active + DRAFT readiness)
update public.products set price = 12.99, compare_at_price = 0, status = 'draft'
  where id = 'e5b2feb2-85ac-43c5-8f43-07c7e3410c38' and not exists (select 1 from public.products where price = 12.99 and id = 'e5b2feb2-85ac-43c5-8f43-07c7e3410c38' and status = 'draft');
update public.products set price = 11.49, compare_at_price = 0, status = 'draft' where id = 'f13d2085-3ed5-4467-bdde-4d256d6eee5a';
update public.products set price = 9.99,  compare_at_price = 0, status = 'draft' where id = '18eacb7a-41f2-40be-9933-5a367f177081';
update public.products set price = 10.99, compare_at_price = 0, status = 'draft' where id = '78c3ba33-9fe2-47fe-b889-90c4d858a19e';
update public.products set price = 14.99, compare_at_price = 0, status = 'draft' where id = '08c41ac2-92d6-42c6-83ac-48e34bc4907f';

-- 2) Dedup window bird feeder — archive the duplicate, keep the primary
update public.products set status = 'archived' where id = '7c942096-eb37-42d2-862e-6187438c4638';
update public.products set status = 'draft', compare_at_price = 0 where id = 'f6e827bd-0646-4205-a03e-7a4a54f314e6';

-- 3) New SOURCE_PENDING drafts (Bird Supplies / Horse / Cattle) — cost & supplier intentionally NULL
-- (inserts performed via REST; replay equivalent shows the retail-price intent)
--   Bird:  Suet Cage Feeder $15.95, Nyjer Tube Feeder $19.95, Copper-Roof Bird House $27.95, Solar Bird Bath $34.95
--   Horse: Padded Nylon Halter $19.95, Cotton Lead Rope $14.95
--   Cattle:Nylon Cattle Halter $17.95, Ear Tags 25-pack $14.95, Stiff Bristle Brush $12.95

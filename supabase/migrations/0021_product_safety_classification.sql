-- Explicit product safety review fields. Existing rows remain unchanged and
-- unclassified until reviewed; no data is invented or deleted.
alter table public.products
  add column if not exists safety_class text
    check (safety_class in (
      'NON_INGESTIBLE', 'HIMALAYAN_SALT', 'ANIMAL_SALT_LICK',
      'ANIMAL_FOOD_FEED', 'ANIMAL_TREAT_CHEW', 'ANIMAL_SUPPLEMENT',
      'SEED_OR_FORAGING_FEED', 'MEDICATED_OR_THERAPEUTIC', 'UNKNOWN_INGESTIBLE')),
  add column if not exists safety_review_status text
    check (safety_review_status in ('PENDING_REVIEW', 'APPROVED_FOR_SALE', 'HOLD', 'BLOCKED')),
  add column if not exists intended_species text;

create index if not exists products_safety_class_idx on public.products (safety_class);
create index if not exists products_safety_review_status_idx on public.products (safety_review_status);

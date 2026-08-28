export type ProductSafetyClass =
  | 'NON_INGESTIBLE'
  | 'HIMALAYAN_SALT'
  | 'ANIMAL_SALT_LICK'
  | 'ANIMAL_FOOD_FEED'
  | 'ANIMAL_TREAT_CHEW'
  | 'ANIMAL_SUPPLEMENT'
  | 'SEED_OR_FORAGING_FEED'
  | 'MEDICATED_OR_THERAPEUTIC'
  | 'UNKNOWN_INGESTIBLE';

export type ProductSafetyReviewStatus = 'PENDING_REVIEW' | 'APPROVED_FOR_SALE' | 'HOLD' | 'BLOCKED';

export interface ProductSafetyFacts {
  classification?: ProductSafetyClass | null;
  reviewStatus?: ProductSafetyReviewStatus | null;
  name?: string;
  category?: string;
  tags?: readonly string[];
  description?: string;
  supplierSource?: string | null;
  supplierProductRef?: string | null;
  supplierUrl?: string | null;
  intendedSpecies?: string | null;
  evidenceNotes?: string | null;
}

const INGESTIBLE_RE = /\b(food|feed|treats?|chews?|supplement|nutrition|nutritional|seed|foraging|ration|electrolyte|edible|mineral\s+(?:block|lick|supplement)|salt\s+lick|livestock\s+block|bird\s+mix|himalayan\s+(?:pink\s+)?salt)\b/i;
const THERAPEUTIC_RE = /\b(cures?|treats?\s+(?:disease|arthritis|infection|deficiency|urinary)|prevents?\s+(?:disease|infection|urinary)|guaranteed\s+treatment|fda\s+(?:approved|certified)|veterinarian(?:y)?\s+approved)\b/i;

export function classifyProductSafety(f: ProductSafetyFacts): ProductSafetyClass {
  if (f.classification) return f.classification;
  const text = `${f.name || ''} ${f.category || ''} ${(f.tags || []).join(' ')} ${f.description || ''}`;
  if (/medicat|therapeutic|antibiotic|prescription/i.test(text) || THERAPEUTIC_RE.test(text)) return 'MEDICATED_OR_THERAPEUTIC';
  if (!INGESTIBLE_RE.test(text)) return 'NON_INGESTIBLE';
  if (/himalayan\s+(?:pink\s+)?salt/i.test(text)) return 'HIMALAYAN_SALT';
  if (/salt\s+lick|mineral\s+(?:block|lick)|livestock\s+block/i.test(text)) return 'ANIMAL_SALT_LICK';
  if (/treat|chew|edible/i.test(text)) return 'ANIMAL_TREAT_CHEW';
  if (/supplement|nutrition|electrolyte/i.test(text)) return 'ANIMAL_SUPPLEMENT';
  if (/seed|foraging|bird\s+mix/i.test(text)) return 'SEED_OR_FORAGING_FEED';
  if (/food|feed|ration/i.test(text)) return 'ANIMAL_FOOD_FEED';
  return 'UNKNOWN_INGESTIBLE';
}

export function prohibitedClaimWarnings(f: Pick<ProductSafetyFacts, 'name' | 'description' | 'tags'>): string[] {
  const text = `${f.name || ''} ${f.description || ''} ${(f.tags || []).join(' ')}`;
  const warnings: string[] = [];
  if (/\bcures?\b|\btreats?\s+(?:disease|arthritis|infection|deficiency|urinary)/i.test(text)) warnings.push('Disease or treatment claim');
  if (/\bprevents?\s+(?:disease|infection|urinary)/i.test(text)) warnings.push('Disease-prevention claim');
  if (/guaranteed\s+treatment/i.test(text)) warnings.push('Guaranteed treatment claim');
  if (/fda\s+(?:approved|certified)/i.test(text)) warnings.push('FDA approval/certification claim');
  if (/veterinarian(?:y)?\s+approved/i.test(text)) warnings.push('Veterinary approval claim');
  return warnings;
}

export function hasSupplierEvidence(f: ProductSafetyFacts): boolean {
  return Boolean(f.supplierSource?.trim() && f.supplierProductRef?.trim() && f.supplierUrl?.trim());
}

export function isProductSafetyEligible(f: ProductSafetyFacts): boolean {
  const classification = classifyProductSafety(f);
  if (classification === 'NON_INGESTIBLE') return true;
  if (f.reviewStatus !== 'APPROVED_FOR_SALE') return false;
  if (!hasSupplierEvidence(f) || !f.intendedSpecies?.trim()) return false;
  if (prohibitedClaimWarnings(f).length > 0) return false;
  return classification === 'HIMALAYAN_SALT' || classification === 'ANIMAL_SALT_LICK';
}

export function safetyStatusLabel(status: ProductSafetyReviewStatus | null | undefined): string {
  return status === 'APPROVED_FOR_SALE' ? 'Manually reviewed by Luxedge' : status === 'BLOCKED' ? 'Safety blocked' : status === 'HOLD' ? 'Safety hold' : 'Pending safety review';
}

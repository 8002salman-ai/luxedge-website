import { describe, expect, it } from 'vitest';
import {
  classifyProductSafety,
  isProductSafetyEligible,
  prohibitedClaimWarnings,
} from '../productSafety';

const evidence = {
  supplierSource: 'Verified supplier',
  supplierProductRef: 'SKU-1',
  supplierUrl: 'https://supplier.example/item/1',
  intendedSpecies: 'Horse',
  reviewStatus: 'APPROVED_FOR_SALE' as const,
};

describe('product safety classification', () => {
  it.each([
    [{ name: 'CJ dog halter', tags: ['dog'], category: 'Horse' }, 'NON_INGESTIBLE'],
    [{ name: 'Himalayan Pink Salt Block', tags: [], category: 'Horse' }, 'HIMALAYAN_SALT'],
    [{ name: 'Livestock mineral lick', tags: [], category: 'Cattle' }, 'ANIMAL_SALT_LICK'],
    [{ name: 'Wild bird seed mix', tags: [], category: 'Bird Supplies' }, 'SEED_OR_FORAGING_FEED'],
    [{ name: 'Dog dental chew', tags: [], category: 'Dog' }, 'ANIMAL_TREAT_CHEW'],
    [{ name: 'Animal nutritional supplement', tags: [], category: 'Cattle' }, 'ANIMAL_SUPPLEMENT'],
    [{ name: 'Medicated livestock treatment', tags: [], category: 'Cattle' }, 'MEDICATED_OR_THERAPEUTIC'],
  ] as const)('classifies %o as %s', (facts, expected) => {
    expect(classifyProductSafety(facts)).toBe(expected);
  });

  it('honors explicit classification for a brand-only listing', () => {
    expect(classifyProductSafety({ classification: 'HIMALAYAN_SALT', name: 'Koh' })).toBe('HIMALAYAN_SALT');
  });

  it('allows only manually approved salt products with complete evidence', () => {
    expect(isProductSafetyEligible({ ...evidence, classification: 'HIMALAYAN_SALT' })).toBe(true);
    expect(isProductSafetyEligible({ ...evidence, classification: 'ANIMAL_SALT_LICK' })).toBe(true);
    expect(isProductSafetyEligible({ ...evidence, classification: 'ANIMAL_SALT_LICK', reviewStatus: 'PENDING_REVIEW' })).toBe(false);
    expect(isProductSafetyEligible({ ...evidence, classification: 'ANIMAL_SALT_LICK', supplierUrl: null })).toBe(false);
  });

  it('holds other ingestibles and flags prohibited claims', () => {
    expect(isProductSafetyEligible({ ...evidence, classification: 'SEED_OR_FORAGING_FEED' })).toBe(false);
    expect(prohibitedClaimWarnings({ name: 'FDA Approved supplement cures arthritis', description: '', tags: [] })).toHaveLength(2);
  });
});

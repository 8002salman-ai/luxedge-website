import { describe, it, expect } from 'vitest';
import {
  parseCsv, parseCsvImport, normalizeTitle, findDuplicate, classifyDuplicates,
  type CsvImportRow, type DupCandidate,
} from '../csvImport';

const CSV = [
  'Title,Selling Price,Compare Price,Supplier Cost,Images,Supplier URL,Item ID,Source,Description,Variants,Stock',
  '"Premium Dog Toy, Chew Edition",14.99,19.99,4.50,"https://img.example/a.jpg | https://img.example/b.jpg",https://zeedrop.example/item/123,AE-123456,Zeedrop,"A durable, ""squeaky"" toy with a comma, and a newline\ninside the description.",Color:Red; Size:M,25',
  'Cat Feather Wand,9.99,,2.10,https://img.example/c.jpg,https://zeedrop.example/item/456,AE-456789,Zeedrop,Simple cat toy,,',
].join('\n');

const existing: DupCandidate[] = [
  { id: 'p1', name: 'Premium Dog Toy Chew Edition', supplierUrl: 'https://zeedrop.example/item/123', supplierProductRef: 'AE-123456' },
  { id: 'p2', name: 'Cat Feather Wand', supplierUrl: 'https://zeedrop.example/item/456', supplierProductRef: null },
];

describe('parseCsv (RFC-4180)', () => {
  it('splits rows and keeps quoted commas/newlines', () => {
    const rows = parseCsv('a,"b,c","d\ne",f\n"x ""y""",z');
    expect(rows).toEqual([
      ['a', 'b,c', 'd\ne', 'f'],
      ['x "y"', 'z'],
    ]);
  });

  it('ignores a trailing empty line', () => {
    const rows = parseCsv('a,b\n1,2\n');
    expect(rows).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseCsvImport', () => {
  it('maps common column aliases and parses fields honestly', () => {
    const res = parseCsvImport(CSV);
    expect(res.rows.length).toBe(2);
    const [r1, r2] = res.rows;

    expect(r1.name).toBe('Premium Dog Toy, Chew Edition');
    expect(r1.price).toBe(14.99);
    expect(r1.compareAtPrice).toBe(19.99);
    expect(r1.costPrice).toBe(4.5);
    expect(r1.images).toEqual(['https://img.example/a.jpg', 'https://img.example/b.jpg']);
    expect(r1.supplierUrl).toBe('https://zeedrop.example/item/123');
    expect(r1.supplierProductRef).toBe('AE-123456');
    expect(r1.supplierSource).toBe('Zeedrop');
    expect(r1.inventoryQty).toBe(25);
    expect(r1.description).toContain('"squeaky"');
    expect(r1.description).toContain('comma');
    expect(r1.description).toContain('newline\ninside');
    expect(r1.variants).toEqual([{ attributes: { Color: 'Red', Size: 'M' } }]);

    expect(r2.compareAtPrice).toBeUndefined();
    expect(r2.costPrice).toBe(2.1);
    expect(r2.variants).toEqual([]);
  });

  it('ignores compare price that is not above the selling price (no fake compare)', () => {
    const res = parseCsvImport('Title,Price,Compare Price\nThing,10,8\n');
    expect(res.rows[0].compareAtPrice).toBeUndefined();
    expect(res.warnings.some((w) => w.includes('compare price'))).toBe(true);
  });

  it('skips rows without a title and reports them', () => {
    const res = parseCsvImport('Title,Price\n\n,5\n,,\nReal Product,9\n');
    expect(res.rows.map((r) => r.name)).toEqual(['Real Product']);
    expect(res.skipped.length).toBe(2);
    expect(res.skipped[0].reason).toContain('Missing title');
  });

  it('keeps stock UNKNOWN (undefined) when the CSV has no stock column', () => {
    const res = parseCsvImport('Title,Price\nThing,9\n');
    expect(res.rows[0].inventoryQty).toBeUndefined();
  });

  it('does not fabricate images from non-URL text', () => {
    const res = parseCsvImport('Title,Images\nThing,"see attached photos"\n');
    expect(res.rows[0].images).toEqual([]);
  });
});

describe('duplicate detection', () => {
  it('prioritizes supplier item ID over URL over title', () => {
    // item ID match wins even when URL differs
    const dup = findDuplicate(
      { name: 'Completely Different Name', supplierProductRef: 'AE-123456', supplierUrl: 'https://other.example/x', images: [], tags: [], variants: [], raw: {} } as CsvImportRow,
      existing,
    );
    expect(dup?.field).toBe('supplierProductRef');
    expect(dup?.product.id).toBe('p1');

    // URL match when no item ID
    const dup2 = findDuplicate(
      { name: 'Cat Feather Wand', supplierProductRef: undefined, supplierUrl: 'https://zeedrop.example/item/456', images: [], tags: [], variants: [], raw: {} } as CsvImportRow,
      existing,
    );
    expect(dup2?.field).toBe('supplierUrl');
    expect(dup2?.product.id).toBe('p2');

    // normalized title as last resort
    const dup3 = findDuplicate(
      { name: 'Premium Dog Toy — Chew Edition!', supplierProductRef: undefined, supplierUrl: undefined, images: [], tags: [], variants: [], raw: {} } as CsvImportRow,
      existing,
    );
    expect(dup3?.field).toBe('title');
  });

  it('returns null when nothing matches', () => {
    const dup = findDuplicate(
      { name: 'Brand New Hamster Wheel', supplierProductRef: 'AE-999', supplierUrl: 'https://zeedrop.example/item/999', images: [], tags: [], variants: [], raw: {} } as CsvImportRow,
      existing,
    );
    expect(dup).toBeNull();
  });
});

describe('normalizeTitle', () => {
  it('lowercases, strips punctuation and collapses spaces', () => {
    expect(normalizeTitle('Premium Dog Toy — Chew Edition!   (NEW)')).toBe('premium dog toy chew edition new');
  });
});

describe('classifyDuplicates', () => {
  it('flags per-row duplicates and leaves clean rows unmarked', () => {
    const rows = parseCsvImport(CSV).rows;
    const classified = classifyDuplicates(rows, existing);
    expect(classified[0].duplicate?.field).toBe('supplierProductRef');
    expect(classified[1].duplicate?.field).toBe('supplierUrl');
  });
});

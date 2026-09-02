import { describe, expect, it } from 'vitest';
import { parseTagList } from '../tags';

describe('parseTagList', () => {
  it('accepts all live shapes with one consistent rule (jsonb, JSON string, text)', () => {
    expect(parseTagList(['horse', 'grooming', 'brush'])).toEqual(['horse', 'grooming', 'brush']);
    expect(parseTagList('["cat","toys"]')).toEqual(['cat', 'toys']);
    expect(parseTagList('horse,grooming,brush,tack,equestrian')).toEqual(['horse', 'grooming', 'brush', 'tack', 'equestrian']);
  });

  it('trims elements and supports comma/semicolon/pipe separators', () => {
    expect(parseTagList(' bird , feeder , outdoor ')).toEqual(['bird', 'feeder', 'outdoor']);
    expect(parseTagList('dog;cat|bird,fish')).toEqual(['dog', 'cat', 'bird', 'fish']);
  });

  it('dedupes while preserving first-occurrence order', () => {
    expect(parseTagList(['dog', 'dog', 'bed'])).toEqual(['dog', 'bed']);
    expect(parseTagList('dog,dog,bed,bed')).toEqual(['dog', 'bed']);
    expect(parseTagList('["a","b","a"]')).toEqual(['a', 'b']);
  });

  it('filters non-string array elements', () => {
    expect(parseTagList(['a', 5, null, 'b'])).toEqual(['a', 'b']);
    expect(parseTagList('["a",5,"b"]')).toEqual(['a', 'b']);
  });

  it('degrades absent/malformed/non-string values to [] without throwing', () => {
    const cases: ReadonlyArray<readonly [unknown, string[]]> = [
      [null, []],
      [undefined, []],
      ['', []],
      ['   ', []],
      [42, []],
      [true, []],
      [{}, []],
      // Array intent with broken JSON must not surface junk tag text.
      ['["broken', []],
      ['[a,b]', []],
    ];
    for (const [shape, expected] of cases) {
      expect(parseTagList(shape)).toEqual(expected);
    }
  });
});
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalStorageAdapter, getDbMode, resetDbForTests } from '../db';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('LocalStorageAdapter', () => {
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    adapter = new LocalStorageAdapter(memoryStorage());
  });

  it('inserts, lists, gets, updates and removes', async () => {
    type P = { id: string; name: string; price: number };
    const row: P = { id: 'p1', name: 'Dog Bed', price: 49.99 };
    await adapter.insert<P>('products', row);
    expect((await adapter.list<P>('products')).length).toBe(1);

    const got = await adapter.get<P>('products', 'p1');
    expect(got?.name).toBe('Dog Bed');

    await adapter.update<P>('products', 'p1', { price: 39.99 });
    const updated = await adapter.get<P>('products', 'p1');
    expect(updated?.price).toBe(39.99);
    expect(updated?.name).toBe('Dog Bed'); // patch merges

    await adapter.remove('products', 'p1');
    expect(await adapter.get<P>('products', 'p1')).toBeNull();
    expect((await adapter.list<P>('products')).length).toBe(0);
  });

  it('returns null for missing rows', async () => {
    expect(await adapter.get('products', 'nope')).toBeNull();
  });

  it('is namespace-isolated per table', async () => {
    await adapter.insert('products', { id: 'x', name: 'X' });
    await adapter.insert('reviews', { id: 'r1', rating: 5 });
    expect((await adapter.list('products')).length).toBe(1);
    expect((await adapter.list('reviews')).length).toBe(1);
  });
});

describe('getDbMode', () => {
  beforeEach(() => resetDbForTests());

  it('reports local when Supabase env vars are absent', () => {
    expect(getDbMode()).toBe('local');
  });
});

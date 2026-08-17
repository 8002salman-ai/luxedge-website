// ============================================================================
// LUXEDGE V2 — DATA LAYER BOUNDARY
//
// Single interface for persistence. Today the app persists to localStorage
// (matching current behavior); when a Supabase project is configured via
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, the same calls route to
// Supabase's PostgREST API (no SDK dependency required).
//
// The schema the Supabase adapter expects is defined in
// supabase/migrations/0001_initial_schema.sql.
//
// SECURITY: this module never holds secrets. Supabase anon key is client-safe
// by design (RLS protects the tables); the service-role key stays server-side.
// ============================================================================

export type DbMode = 'local' | 'supabase' | 'unconfigured';

export interface DbAdapter {
  mode: DbMode;
  list<T>(table: string, opts?: { orderBy?: string; limit?: number }): Promise<T[]>;
  get<T>(table: string, id: string): Promise<T | null>;
  insert<T extends { id: string }>(table: string, row: T): Promise<T>;
  update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null>;
  remove(table: string, id: string): Promise<void>;
}

const KEY_PREFIX = 'luxedge_db_v2';

// ---------------------------------------------------------------------------
// Local storage adapter (current behavior)
// ---------------------------------------------------------------------------
export class LocalStorageAdapter implements DbAdapter {
  readonly mode: DbMode = 'local';
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

  constructor(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
    this.storage = storage || (typeof window !== 'undefined' ? window.localStorage : nullStorage);
  }

  private tableKey(table: string): string {
    return `${KEY_PREFIX}:${table}`;
  }

  private readTable<T>(table: string): T[] {
    try {
      const raw = this.storage.getItem(this.tableKey(table));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private writeTable<T>(table: string, rows: T[]): void {
    this.storage.setItem(this.tableKey(table), JSON.stringify(rows));
  }

  async list<T>(table: string): Promise<T[]> {
    return this.readTable<T>(table);
  }

  async get<T>(table: string, id: string): Promise<T | null> {
    const rows = this.readTable<{ id: string } & T>(table);
    return rows.find((r) => r.id === id) || null;
  }

  async insert<T extends { id: string }>(table: string, row: T): Promise<T> {
    const rows = this.readTable<T>(table);
    rows.push(row);
    this.writeTable(table, rows);
    return row;
  }

  async update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null> {
    const rows = this.readTable<T>(table);
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    rows[idx] = { ...rows[idx], ...patch, id } as T;
    this.writeTable(table, rows);
    return rows[idx];
  }

  async remove(table: string, id: string): Promise<void> {
    const rows = this.readTable<{ id: string }>(table);
    this.writeTable(table, rows.filter((r) => r.id !== id));
  }
}

const nullStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

// ---------------------------------------------------------------------------
// Supabase adapter (PostgREST over fetch — activates only when configured)
// ---------------------------------------------------------------------------
export class SupabaseAdapter implements DbAdapter {
  readonly mode: DbMode = 'supabase';
  private url: string;
  private anonKey: string;

  constructor(url: string, anonKey: string) {
    this.url = url.replace(/\/$/, '');
    this.anonKey = anonKey;
  }

  private endpoint(table: string, id?: string): string {
    return `${this.url}/rest/v1/${table}${id ? `?id=eq.${encodeURIComponent(id)}` : ''}`;
  }

  private headers(method: string): Record<string, string> {
    return {
      apikey: this.anonKey,
      Authorization: `Bearer ${this.anonKey}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=representation',
    };
  }

  private async handle<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async list<T>(table: string, opts?: { orderBy?: string; limit?: number }): Promise<T[]> {
    const url = new URL(this.endpoint(table));
    if (opts?.orderBy) url.searchParams.set('order', opts.orderBy);
    if (opts?.limit) url.searchParams.set('limit', String(opts.limit));
    const res = await fetch(url.toString(), { headers: this.headers('GET') });
    const rows = await this.handle<T[]>(res);
    return Array.isArray(rows) ? rows : [];
  }

  async get<T>(table: string, id: string): Promise<T | null> {
    const res = await fetch(this.endpoint(table, id), { headers: this.headers('GET') });
    const rows = await this.handle<T[]>(res);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async insert<T extends { id: string }>(table: string, row: T): Promise<T> {
    const res = await fetch(this.endpoint(table), {
      method: 'POST',
      headers: this.headers('POST'),
      body: JSON.stringify(row),
    });
    const rows = await this.handle<T[]>(res);
    return rows[0] || row;
  }

  async update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null> {
    const res = await fetch(this.endpoint(table, id), {
      method: 'PATCH',
      headers: this.headers('PATCH'),
      body: JSON.stringify(patch),
    });
    const rows = await this.handle<T[]>(res);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async remove(table: string, id: string): Promise<void> {
    await fetch(this.endpoint(table, id), { method: 'DELETE', headers: this.headers('DELETE') });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function resolveDbConfig(): { url: string; anonKey: string } {
  const url = (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL || '';
  const anonKey = (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_ANON_KEY || '';
  return { url, anonKey };
}

let cachedAdapter: DbAdapter | null = null;

/** Returns the active adapter. Defaults to localStorage; upgrades to Supabase when configured. */
export function getDb(): DbAdapter {
  if (cachedAdapter) return cachedAdapter;
  const { url, anonKey } = resolveDbConfig();
  cachedAdapter = url && anonKey ? new SupabaseAdapter(url, anonKey) : new LocalStorageAdapter();
  return cachedAdapter;
}

/** Which persistence mode is active — used for honest UI status. */
export function getDbMode(): DbMode {
  const { url, anonKey } = resolveDbConfig();
  if (url && anonKey) return 'supabase';
  return 'local';
}

export function resetDbForTests(): void {
  cachedAdapter = null;
}

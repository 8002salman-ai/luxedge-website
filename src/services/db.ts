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

export interface DbConnectionResult {
  ok: boolean;
  mode: DbMode;
  detail?: string;
}

export interface DbAdapter {
  mode: DbMode;
  list<T>(table: string, opts?: { orderBy?: string; limit?: number }): Promise<T[]>;
  get<T>(table: string, id: string): Promise<T | null>;
  /** First row matching `column = value`, or null. Used for identity lookups. */
  findFirst<T>(table: string, column: string, value: string): Promise<T | null>;
  insert<T extends { id: string }>(table: string, row: T): Promise<T>;
  /** Insert a row whose PK is NOT `id` (e.g. store_settings.key). */
  insertRaw<T>(table: string, row: T): Promise<T>;
  update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null>;
  /** Update the first row where `column = value` (tables whose PK is not `id`). */
  updateBy<T>(table: string, column: string, value: string, patch: Partial<T>): Promise<T | null>;
  remove(table: string, id: string): Promise<void>;
  /** Honest connectivity check — never claims success it cannot prove. */
  testConnection(): Promise<DbConnectionResult>;
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

  async findFirst<T>(table: string, column: string, value: string): Promise<T | null> {
    const rows = this.readTable<Record<string, unknown> & T>(table);
    const hit = rows.find((r) => r[column] === value);
    return hit || null;
  }

  async insert<T extends { id: string }>(table: string, row: T): Promise<T> {
    const rows = this.readTable<T>(table);
    rows.push(row);
    this.writeTable(table, rows);
    return row;
  }

  async insertRaw<T>(table: string, row: T): Promise<T> {
    const rows = this.readTable<T>(table);
    rows.push(row);
    this.writeTable(table, rows);
    return row;
  }

  async update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null> {
    return this.updateBy(table, 'id', id, patch);
  }

  async updateBy<T>(table: string, column: string, value: string, patch: Partial<T>): Promise<T | null> {
    const rows = this.readTable<T>(table);
    const idx = rows.findIndex((r) => (r as Record<string, unknown>)[column] === value);
    if (idx < 0) return null;
    rows[idx] = { ...rows[idx], ...patch } as T;
    this.writeTable(table, rows);
    return rows[idx];
  }

  async remove(table: string, id: string): Promise<void> {
    const rows = this.readTable<{ id: string }>(table);
    this.writeTable(table, rows.filter((r) => r.id !== id));
  }

  async testConnection(): Promise<DbConnectionResult> {
    return { ok: true, mode: 'local', detail: 'localStorage adapter (active)' };
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
  /** Signed-in user's access token — used (when present) instead of the anon key. */
  private accessToken: string | null = null;

  constructor(url: string, anonKey: string) {
    this.url = url.replace(/\/$/, '');
    this.anonKey = anonKey;
  }

  /**
   * Use the signed-in user's JWT for requests (RLS then sees their role).
   * The token is the caller's own session token, never a secret we mint.
   */
  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  private endpoint(table: string, id?: string): string {
    return `${this.url}/rest/v1/${table}${id ? `?id=eq.${encodeURIComponent(id)}` : ''}`;
  }

  private headers(_method: string): Record<string, string> {
    // New-style Supabase keys: the publishable/anon key goes in the `apikey`
    // header ONLY (sending it as a Bearer token is rejected). A signed-in
    // user's access token is added as the Bearer token so RLS sees their
    // role; without it the request runs as the public anon role.
    const h: Record<string, string> = {
      apikey: this.anonKey,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    if (this.accessToken) h.Authorization = `Bearer ${this.accessToken}`;
    return h;
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

  async findFirst<T>(table: string, column: string, value: string): Promise<T | null> {
    const url = new URL(this.endpoint(table));
    url.searchParams.append(column, `eq.${value}`);
    const res = await fetch(url.toString(), { headers: this.headers('GET') });
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

  async insertRaw<T>(table: string, row: T): Promise<T> {
    const res = await fetch(this.endpoint(table), {
      method: 'POST',
      headers: this.headers('POST'),
      body: JSON.stringify(row),
    });
    const rows = await this.handle<T[]>(res);
    return rows[0] || row;
  }

  async update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null> {
    return this.updateBy(table, 'id', id, patch);
  }

  async updateBy<T>(table: string, column: string, value: string, patch: Partial<T>): Promise<T | null> {
    const url = new URL(this.endpoint(table));
    url.searchParams.append(column, `eq.${value}`);
    const res = await fetch(url.toString(), {
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

  /**
   * Real connectivity probe: reads one published category through the anon
   * key exactly like the storefront does. Returns ok:false (no silent
   * fallback to localStorage) when Supabase is configured but unreachable.
   */
  async testConnection(): Promise<DbConnectionResult> {
    try {
      const res = await fetch(this.endpoint('categories') + '?limit=1', {
        headers: this.headers('GET'),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, mode: 'supabase', detail: `Supabase HTTP ${res.status}: ${text.slice(0, 120)}` };
      }
      return { ok: true, mode: 'supabase', detail: 'Supabase reachable (anon read OK)' };
    } catch (e) {
      return { ok: false, mode: 'supabase', detail: (e as Error).message || 'Supabase unreachable' };
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
let dbConfigOverride: { url: string; anonKey: string } | null | undefined = undefined;

/**
 * Test-only hook: override resolved config (null = unconfigured, undefined =
 * restore real env resolution). Never called by app code.
 */
export function __setDbConfigForTests(config: { url: string; anonKey: string } | null | undefined): void {
  dbConfigOverride = config;
}

export function resolveDbConfig(): { url: string; anonKey: string } | null {
  if (dbConfigOverride !== undefined) return dbConfigOverride;
  const url = (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL || '';
  const anonKey = (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

let cachedAdapter: DbAdapter | null = null;

/** Returns the active adapter. Defaults to localStorage; upgrades to Supabase when configured. */
export function getDb(): DbAdapter {
  if (cachedAdapter) return cachedAdapter;
  const cfg = resolveDbConfig();
  cachedAdapter = cfg ? new SupabaseAdapter(cfg.url, cfg.anonKey) : new LocalStorageAdapter();
  return cachedAdapter;
}

/** Which persistence mode is active — used for honest UI status. */
export function getDbMode(): DbMode {
  return resolveDbConfig() ? 'supabase' : 'local';
}

export function resetDbForTests(): void {
  cachedAdapter = null;
}

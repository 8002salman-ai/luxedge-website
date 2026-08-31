// ============================================================================
// ADSENSE EARNINGS — REAL Google AdSense data in Luxedge Admin
//
// Reads /api/adsense/* (server-side, admin-auth) which calls the official
// AdSense Management API v2 and caches results. This is REAL Google data —
// never a page-view estimate. States are honest: not connected → Connect,
// token expired → Reconnect, API down → temporary unavailable, no earnings →
// $0.00. Payment balance/payouts are NOT exposed by the AdSense API, so we
// link to the Google Payments page instead of fabricating a balance.
// ============================================================================
import { useEffect, useState, useCallback } from 'react';
import { getAccessToken } from '../services/supabase';
import { ArrowClockwise, LinkSimple, Megaphone, CheckCircle, Warning, SpinnerGap } from '@phosphor-icons/react';

interface EarningsRange {
  earnings: number;
  pageViews: number;
  impressions: number;
  clicks: number;
  pageRpm: number;
  impressionRpm: number;
}

interface EarningsCache {
  syncedAt: string;
  currency: string;
  ranges: {
    today: EarningsRange;
    yesterday: EarningsRange;
    last7: EarningsRange;
    thisMonth: EarningsRange;
    prevMonth: EarningsRange;
  };
}

interface Status {
  connected: boolean;
  clientConfigured: boolean;
  publisherId: string;
  site: string;
  lastSync: string | null;
}

function money(n: number | undefined, currency = 'USD'): string {
  const v = Number(n ?? 0);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

function num(n: number | undefined): string {
  return (Number(n ?? 0)).toLocaleString('en-US');
}

const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : '—';

export default function AdSenseEarnings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [cache, setCache] = useState<EarningsCache | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const token = getAccessToken();
    const res = await fetch(path, {
      ...init,
      headers: { ...(init?.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    return res;
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [sRes, eRes] = await Promise.all([api('/api/adsense/status'), api('/api/adsense/earnings')]);
      if (sRes.ok) setStatus(await sRes.json() as Status);
      if (eRes.ok) {
        const e = await eRes.json() as { connected?: boolean; stale?: boolean; data?: EarningsCache | null };
        setCache(e.data ?? null);
      }
    } catch {
      setError('Google AdSense data temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api('/api/adsense/auth-url');
      const d = await res.json() as { authUrl?: string; error?: string };
      if (d.authUrl) {
        // Open the Google consent screen in a new tab. Owner authorizes once;
        // Google redirects back to /api/adsense/oauth/callback which stores the
        // refresh token server-side and returns to /admin/marketing-traffic.
        window.open(d.authUrl, '_blank', 'noopener,noreferrer');
        setNote('Google authorization opened in a new tab. After you approve, return here and click "Refresh earnings".');
      } else {
        setError(d.error || 'Could not start Google authorization.');
      }
    } catch {
      setError('Could not start Google authorization.');
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await api('/api/adsense/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await res.json() as { connected?: boolean; data?: EarningsCache | null; message?: string; error?: string };
      if (d.data) {
        setCache(d.data);
        setNote('Synced from Google AdSense.');
      } else if (d.error === 'not-connected') {
        setNote('Not connected yet — click "Connect Google AdSense" first.');
      } else {
        setError(d.message || d.error || 'Sync failed.');
      }
    } catch {
      setError('Google AdSense data temporarily unavailable.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await api('/api/adsense/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      setStatus((s) => (s ? { ...s, connected: false, lastSync: null } : s));
      setCache(null);
      setNote('Disconnected from Google AdSense.');
    } catch {
      setError('Could not disconnect.');
    } finally {
      setBusy(false);
    }
  };

  const connected = !!status?.connected;

  const R = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">{label}</p>
      <p className="text-lg font-bold text-gray-900 tabular-nums">{value}</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
          <Megaphone size={14} className="text-blue-600" />
          Real Google AdSense — actual Google data via the AdSense Management API
          {status?.lastSync && <span className="font-normal text-gray-400">· last synced {fmtTime(status.lastSync)}</span>}
        </p>
        <div className="flex items-center gap-1.5">
          <button onClick={sync} disabled={busy || !connected}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
            <ArrowClockwise size={13} className={busy ? 'animate-spin' : ''} /> Refresh earnings
          </button>
          {connected && (
            <a href="https://www.google.com/adsense/new/u/0/pub-5473713135927706/payments" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
              <LinkSimple size={13} /> Open Google AdSense Payments
            </a>
          )}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          <SpinnerGap size={16} className="inline animate-spin mr-1.5" />Loading AdSense data…
        </div>
      ) : (
        <>
          {error && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
              <Warning size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {note && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 flex items-start gap-2">
              <CheckCircle size={16} className="mt-0.5 shrink-0" />
              <span>{note}</span>
            </div>
          )}

          {!status?.clientConfigured && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Google OAuth is not configured yet. The owner must set <code className="bg-amber-100 px-1 rounded">GOOGLE_ADSENSE_CLIENT_ID</code> and{' '}
              <code className="bg-amber-100 px-1 rounded">GOOGLE_ADSENSE_CLIENT_SECRET</code> as wrangler secrets, then this panel becomes connectable.
            </div>
          )}

          {!connected ? (
            <div className="rounded-xl border border-gray-200 bg-white p-5 text-center">
              <p className="text-sm font-semibold text-gray-700 mb-1">Connect Google AdSense</p>
              <p className="text-xs text-gray-400 mb-3">
                Authorize once with your Google account that owns <span className="font-medium text-gray-600">{status?.publisherId || 'pub-5473713135927706'}</span>.
                Refresh tokens are stored server-side and never reach the browser.
              </p>
              <button onClick={connect} disabled={busy || !status?.clientConfigured}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
                {busy ? <SpinnerGap size={15} className="animate-spin" /> : <LinkSimple size={15} />} Connect Google AdSense
              </button>
            </div>
          ) : (
            <>
              {!cache ? (
                <div className="rounded-xl border border-gray-200 bg-white p-5 text-center text-sm text-gray-500">
                  No earnings synced yet — click "Refresh earnings".
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                    <R label="Today" value={money(cache.ranges.today.earnings, cache.currency)} />
                    <R label="Yesterday" value={money(cache.ranges.yesterday.earnings, cache.currency)} />
                    <R label="Last 7 days" value={money(cache.ranges.last7.earnings, cache.currency)} />
                    <R label="This month" value={money(cache.ranges.thisMonth.earnings, cache.currency)} />
                    <R label="Previous month" value={money(cache.ranges.prevMonth.earnings, cache.currency)} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
                    <R label="Page views" value={num(cache.ranges.thisMonth.pageViews)} />
                    <R label="Ad impressions" value={num(cache.ranges.thisMonth.impressions)} />
                    <R label="Clicks" value={num(cache.ranges.thisMonth.clicks)} />
                    <R label="Page RPM" value={money(cache.ranges.thisMonth.pageRpm, cache.currency)} />
                    <R label="Impression RPM" value={money(cache.ranges.thisMonth.impressionRpm, cache.currency)} />
                  </div>
                </>
              )}
              <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                <p className="text-[11px] text-gray-400">
                  Data source: Google AdSense · {status?.site} · {status?.publisherId} · synced {fmtTime(status.lastSync)}
                </p>
                <button onClick={disconnect} disabled={busy}
                  className="text-[11px] text-gray-400 hover:text-red-600 underline underline-offset-2 disabled:opacity-40">
                  Disconnect
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// LUXEDGE — Admin Payments Setup (multi-provider)
//
// Shows all configured payment providers (Square, PayPal, Braintree, Stripe,
// Payoneer, Authorize.Net) with status, test, enable/disable, primary/backup
// selection. Secrets are NEVER exposed — only masked values are shown.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plug, CheckCircle, XCircle, ArrowClockwise,
  ShieldCheck, CreditCard, Globe,
} from '@phosphor-icons/react';
import { getAccessToken } from '../services/supabase';

/* ── Types ── */
type ProviderId = 'none' | 'stripe' | 'square' | 'paypal' | 'braintree' | 'payoneer' | 'authorize_net';
type ProviderStatus = 'not_configured' | 'sandbox' | 'connected' | 'ready' | 'disabled' | 'error';
type ProviderRole = 'primary' | 'backup' | 'available';

interface ProviderKeyInfo {
  configured: boolean;
  masked: string;
  source: string;
}
interface ProviderCard {
  id: ProviderId;
  name: string;
  enabled: boolean;
  role: ProviderRole;
  mode: 'sandbox' | 'production';
  status: ProviderStatus;
  isConfigured: boolean;
  keys: Record<string, ProviderKeyInfo>;
  dashboardUrl: string;
  setupChecklist: string[];
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastWebhookAt?: string;
  lastPaymentAt?: string;
  lastError?: string;
}
interface PaymentsData {
  ok: boolean;
  primary: ProviderId;
  backup: ProviderId;
  providers: ProviderCard[];
}

const CARD = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-5';
const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200 disabled:opacity-50';

const PROVIDER_ICONS: Record<string, string> = {
  stripe: '💳', square: '◼️', paypal: '🅿️', braintree: '🔒', payoneer: '💰', authorize_net: '🔐',
};

const STATUS_COLORS: Record<string, string> = {
  ready: 'bg-green-100 text-green-800',
  sandbox: 'bg-blue-100 text-blue-800',
  connected: 'bg-green-100 text-green-800',
  not_configured: 'bg-gray-100 text-gray-500',
  disabled: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
};

function statusLabel(s: ProviderStatus): string {
  switch (s) {
    case 'ready': return 'Ready';
    case 'sandbox': return 'Sandbox';
    case 'connected': return 'Connected';
    case 'not_configured': return 'Not Configured';
    case 'disabled': return 'Disabled';
    case 'error': return 'Error';
    default: return s;
  }
}

function relativeTime(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  } catch { return '—'; }
}

export default function PaymentsSetup() {
  const nav = useNavigate();
  const [data, setData] = useState<PaymentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<ProviderId | null>(null);
  const [testResult, setTestResult] = useState<{ provider: ProviderId; ok: boolean; message?: string } | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<ProviderId | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/payments', { headers: authHeaders() });
      if (res.ok) setData(await res.json() as PaymentsData);
    } catch { /* ignore */ }
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => { void loadData(); }, [loadData]);

  const postAction = async (body: Record<string, unknown>) => {
    setNote(null);
    try {
      const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      return await res.json() as { ok?: boolean; message?: string; error?: string };
    } catch {
      return { ok: false, error: 'Network error' };
    }
  };

  const testProvider = async (id: ProviderId) => {
    setTesting(id);
    setTestResult(null);
    const r = await postAction({ action: 'test', provider: id });
    setTestResult({ provider: id, ok: !!r.ok, message: r.message || r.error });
    setTesting(null);
    void loadData();
  };

  const toggleProvider = async (id: ProviderId, enabled: boolean) => {
    const r = await postAction({ action: 'toggle', provider: id, enabled });
    setNote(r.ok ? { kind: 'ok', text: r.message || 'Saved' } : { kind: 'err', text: r.error || 'Failed' });
    void loadData();
  };

  const setRole = async (id: ProviderId, role: 'primary' | 'backup') => {
    const action = role === 'primary' ? 'set_primary' : 'set_backup';
    const r = await postAction({ action, provider: id });
    setNote(r.ok ? { kind: 'ok', text: r.message || 'Saved' } : { kind: 'err', text: r.error || 'Failed' });
    void loadData();
  };

  if (loading && !data) {
    return (
      <div className="max-w-5xl mx-auto p-6 flex items-center justify-center min-h-[40vh]">
        <ArrowClockwise size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  const providers = data?.providers || [];
  const primary = data?.primary || 'none';
  const backup = data?.backup || 'none';
  const anyConfigured = providers.some((p) => p.isConfigured);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/admin')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft size={20} className="text-gray-500" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Payment Providers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Configure and manage checkout payment methods</p>
        </div>
        <button onClick={loadData} disabled={loading} className={`${BTN} bg-blue-500 text-white hover:bg-blue-600`}>
          {loading ? <ArrowClockwise size={14} className="animate-spin" /> : <Plug size={14} />}
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* System Status Banner */}
      <div className={`rounded-2xl p-5 flex items-center gap-4 ${anyConfigured ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${anyConfigured ? 'bg-green-100' : 'bg-amber-100'}`}>
          {anyConfigured ? <CheckCircle size={24} className="text-green-600" /> : <XCircle size={24} className="text-amber-600" />}
        </div>
        <div className="flex-1">
          <p className={`font-bold text-lg ${anyConfigured ? 'text-green-800' : 'text-amber-800'}`}>
            {anyConfigured ? 'Payment System Active' : 'No Payment Provider Configured'}
          </p>
          <p className="text-sm text-gray-600 mt-0.5">
            {anyConfigured
              ? `Primary: ${primary === 'none' ? 'None' : primary} · Backup: ${backup === 'none' ? 'None' : backup}`
              : 'Add credentials for at least one provider to accept payments. Free gift orders work without any provider.'}
          </p>
        </div>
      </div>

      {/* Test Result */}
      {testResult && (
        <div className={`rounded-2xl p-4 border ${testResult.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-3">
            {testResult.ok ? <CheckCircle size={20} className="text-green-600" /> : <XCircle size={20} className="text-red-500" />}
            <div>
              <p className="font-semibold text-sm text-gray-800">{testResult.provider} test: {testResult.ok ? 'PASSED' : 'FAILED'}</p>
              <p className="text-xs text-gray-600 mt-0.5">{testResult.message || 'No details'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Provider Cards */}
      <div className="space-y-4">
        {providers.map((p) => {
          const isExpanded = expandedId === p.id;
          const isPrimary = primary === p.id;
          const isBackup = backup === p.id;
          const configuredKeys = Object.values(p.keys).filter((k) => k.configured).length;
          const totalKeys = Object.keys(p.keys).length;

          return (
            <div key={p.id} className={CARD}>
              {/* Provider Header */}
              <div className="flex items-center gap-4">
                <div className="text-2xl">{PROVIDER_ICONS[p.id] || '💳'}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-gray-900">{p.name}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_COLORS[p.status] || STATUS_COLORS.not_configured}`}>
                      {statusLabel(p.status)}
                    </span>
                    {isPrimary && <span className="px-2 py-0.5 rounded-full bg-luxe-gold text-white text-[10px] font-bold">PRIMARY</span>}
                    {isBackup && <span className="px-2 py-0.5 rounded-full bg-purple-500 text-white text-[10px] font-bold">BACKUP</span>}
                    {p.mode === 'production' && <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">PROD</span>}
                    {p.mode === 'sandbox' && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">SANDBOX</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {totalKeys > 0 ? `${configuredKeys}/${totalKeys} credentials configured` : 'No credentials required'}
                    {p.lastTestAt && <> · Last test: {p.lastTestOk ? '✓' : '✗'} {relativeTime(p.lastTestAt)}</>}
                    {p.lastWebhookAt && <> · Last webhook: {relativeTime(p.lastWebhookAt)}</>}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Enable/Disable Toggle */}
                  <button
                    onClick={() => toggleProvider(p.id, !p.enabled)}
                    disabled={!p.isConfigured}
                    className={`${BTN} ${p.enabled ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'} disabled:opacity-40`}
                  >
                    {p.enabled ? 'ON' : 'OFF'}
                  </button>

                  {/* Test */}
                  <button
                    onClick={() => testProvider(p.id)}
                    disabled={!p.isConfigured || testing === p.id}
                    className={`${BTN} bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40`}
                  >
                    {testing === p.id ? <ArrowClockwise size={12} className="animate-spin" /> : <Plug size={12} />}
                    Test
                  </button>

                  {/* Primary/Backup */}
                  {p.isConfigured && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => setRole(p.id, 'primary')}
                        className={`${BTN} ${isPrimary ? 'bg-luxe-gold text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        ★
                      </button>
                      <button
                        onClick={() => setRole(p.id, 'backup')}
                        className={`${BTN} ${isBackup ? 'bg-purple-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        ◆
                      </button>
                    </div>
                  )}

                  {/* Expand */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                    className={`${BTN} bg-gray-100 text-gray-600 hover:bg-gray-200`}
                  >
                    {isExpanded ? '▲' : '▼'}
                  </button>
                </div>
              </div>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
                  {/* Credential Status */}
                  {totalKeys > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Credentials</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {Object.entries(p.keys).map(([label, info]) => (
                          <div key={label} className={`flex items-center justify-between p-2.5 rounded-xl text-sm ${info.configured ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <ShieldCheck size={14} className={info.configured ? 'text-green-600' : 'text-gray-400'} />
                              <span className="text-gray-700 truncate">{label}</span>
                            </div>
                            <span className={`text-xs font-mono ml-2 shrink-0 ${info.configured ? 'text-green-700' : 'text-gray-400'}`}>
                              {info.configured ? info.masked || '✓' : 'MISSING'}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400 mt-2">
                        Set via Cloudflare Worker secrets: {Object.values(p.keys).map((k) => k.source === 'env' ? '' : '').length > 0
                          ? 'credentials are in env vars'
                          : `wrangler secret put <VAR_NAME>`}
                      </p>
                    </div>
                  )}

                  {/* Dashboard Link */}
                  {p.dashboardUrl && (
                    <a href={p.dashboardUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-semibold">
                      <Globe size={14} /> Open {p.name} Dashboard
                    </a>
                  )}

                  {/* Setup Checklist */}
                  {p.setupChecklist.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Setup Checklist</h4>
                      <div className="space-y-1.5">
                        {p.setupChecklist.map((item, i) => {
                          // Heuristic: if status is ready and item is last, mark done
                          const done = (p.status === 'ready' || p.status === 'connected') && i < p.setupChecklist.length - 1;
                          return (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              <span className={done ? 'text-green-500' : 'text-gray-300'}>
                                {done ? <CheckCircle size={14} /> : <span className="inline-block w-3.5 h-3.5 border-2 border-gray-300 rounded-full" />}
                              </span>
                              <span className={done ? 'text-gray-500 line-through' : 'text-gray-700'}>{item}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Error state */}
                  {p.lastError && (
                    <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                      <span className="font-semibold">Last error:</span> {p.lastError}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Free Gift Info */}
      <div className={CARD}>
        <div className="flex items-center gap-2 mb-3">
          <CreditCard size={18} className="text-luxe-gold" />
          <h2 className="font-bold text-gray-900">$0 Free Gift Orders</h2>
        </div>
        <p className="text-sm text-gray-600">
          Free promotional gift orders ($0 total) are handled separately — they never require any payment
          provider. No SDK, no card form, no payment API call is made for $0 orders. This is by design
          and does not indicate a misconfiguration.
        </p>
      </div>

      {/* Note */}
      {note && (
        <p className={`text-sm ${note.kind === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{note.text}</p>
      )}
    </div>
  );
}

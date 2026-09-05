import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plug, CheckCircle, XCircle, Warning, ArrowClockwise,
  ShieldCheck, CreditCard, FloppyDisk, Eye, EyeSlash, Trash,
  ExclamationMark
} from '@phosphor-icons/react';
import { getAccessToken } from '../services/supabase';

/* ── Types ── */
type Source = 'env' | 'attached' | 'none';
interface KeyStatus { configured: boolean; masked: string; source: Source }
interface TestResult {
  ok: boolean;
  mode?: 'live' | 'test';
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  masked?: string;
  message?: string;
}

const CARD = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-5';
const BTN = 'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-200';

export default function PaymentsSetup() {
  const nav = useNavigate();
  const [secretKey, setSecretKey] = useState<KeyStatus>({ configured: false, masked: '', source: 'none' });
  const [webhookSecret, setWebhookSecret] = useState<KeyStatus>({ configured: false, masked: '', source: 'none' });
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form state
  const [secretInput, setSecretInput] = useState('');
  const [whInput, setWhInput] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [showWh, setShowWh] = useState(false);
  const [saving, setSaving] = useState('');
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/payment-keys', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json() as { secretKey: KeyStatus; webhookSecret: KeyStatus };
        setSecretKey(data.secretKey);
        setWebhookSecret(data.webhookSecret);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const saveKey = async (keyType: 'secretKey' | 'webhookSecret') => {
    const input = keyType === 'secretKey' ? secretInput : whInput;
    if (!input.trim()) { setNote({ kind: 'err', text: 'Enter a key first' }); return; }
    setSaving(keyType);
    setNote(null);
    try {
      const res = await fetch('/api/admin/payment-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'set', keyType, key: input.trim() }),
      });
      const data = await res.json() as { ok?: boolean; masked?: string; error?: string };
      if (data.ok) {
        if (keyType === 'secretKey') { setSecretKey({ configured: true, masked: data.masked || '', source: 'attached' }); setSecretInput(''); }
        else { setWebhookSecret({ configured: true, masked: data.masked || '', source: 'attached' }); setWhInput(''); }
        setNote({ kind: 'ok', text: '✓ Key saved server-side.' });
      } else {
        setNote({ kind: 'err', text: `Error: ${data.error || 'Failed to save'}` });
      }
    } catch {
      setNote({ kind: 'err', text: 'Network error — could not save key' });
    }
    setSaving('');
  };

  const clearKey = async (keyType: 'secretKey' | 'webhookSecret') => {
    setNote(null);
    try {
      const res = await fetch('/api/admin/payment-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'clear', keyType }),
      });
      const data = await res.json() as { ok?: boolean; configured?: boolean; masked?: string };
      if (data.ok) {
        if (keyType === 'secretKey') setSecretKey({ configured: !!data.configured, masked: data.masked || '', source: data.configured ? 'env' : 'none' });
        else setWebhookSecret({ configured: !!data.configured, masked: data.masked || '', source: data.configured ? 'env' : 'none' });
        setNote({ kind: 'ok', text: '✓ Key removed.' });
      }
    } catch { /* ignore */ }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/payment-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'test' }),
      });
      setTestResult(await res.json() as TestResult);
    } catch {
      setTestResult({ ok: false, message: 'Network error — could not reach server.' });
    }
    setTesting(false);
  };

  const stripeReady = secretKey.configured;
  const pendingActivation = testResult?.ok === true && testResult.chargesEnabled === false;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/admin')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft size={20} className="text-gray-500" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Payments Setup</h1>
          <p className="text-sm text-gray-500 mt-0.5">Configure Stripe for secure checkout</p>
        </div>
        <button
          onClick={loadStatus}
          disabled={loading}
          className={`${BTN} bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50`}
        >
          {loading ? <ArrowClockwise size={14} className="animate-spin" /> : <Plug size={14} />}
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* ── Status Banner ── */}
      <div className={`rounded-2xl p-5 flex items-center gap-4 ${stripeReady ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${stripeReady ? 'bg-green-100' : 'bg-red-100'}`}>
          {stripeReady ? <CheckCircle size={24} className="text-green-600" /> : <XCircle size={24} className="text-red-500" />}
        </div>
        <div className="flex-1">
          <p className={`font-bold text-lg ${stripeReady ? 'text-green-800' : 'text-red-800'}`}>
            {stripeReady ? 'Stripe — Configured' : 'Stripe — Not Configured'}
          </p>
          <p className="text-sm text-gray-600 mt-0.5">
            {stripeReady
              ? 'Checkout will create a Stripe-hosted payment page. Add the webhook secret below to record paid orders.'
              : 'Add your Stripe secret key below to enable checkout.'}
          </p>
        </div>
        {stripeReady && (
          <button onClick={runTest} disabled={testing} className={`${BTN} bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50`}>
            {testing ? <ArrowClockwise size={14} className="animate-spin" /> : <Plug size={14} />}
            {testing ? 'Testing...' : 'Test Account'}
          </button>
        )}
      </div>

      {/* ── Test result ── */}
      {testResult && (
        <div className={`rounded-2xl p-5 border ${testResult.ok ? (pendingActivation ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200') : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-start gap-3">
            {testResult.ok
              ? (pendingActivation ? <Warning size={20} className="text-amber-600" /> : <CheckCircle size={20} className="text-green-600" />)
              : <XCircle size={20} className="text-red-500" />}
            <div className="flex-1">
              <p className="font-semibold text-gray-800">
                {testResult.ok
                  ? `Stripe key valid — ${testResult.mode === 'live' ? 'LIVE' : 'TEST'} mode${testResult.masked ? ` (${testResult.masked})` : ''}`
                  : testResult.message || 'Test failed'}
              </p>
              {testResult.ok && (
                <>
                  <p className="text-sm text-gray-600 mt-1">
                    Charges: {testResult.chargesEnabled ? 'Enabled ✓' : 'Not enabled yet'} · Payouts: {testResult.payoutsEnabled ? 'Enabled ✓' : 'Not enabled'}
                  </p>
                  {pendingActivation && (
                    <p className="text-sm text-amber-700 mt-1">
                      Your Stripe account can't accept live card payments yet. Complete account activation (business details / bank account) in the Stripe Dashboard — checkout will stay safe until then.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Keys ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Secret key */}
        <div className={CARD}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center">
              <CreditCard size={16} className="text-white" />
            </div>
            <h2 className="font-bold text-gray-900">Stripe Secret Key</h2>
          </div>

          <div className="space-y-3">
            <div className="p-3 rounded-xl text-sm bg-gray-50 text-gray-700 border border-gray-100">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={14} />
                <span className="font-semibold">Server-side only</span>
              </div>
              <p className="text-xs text-gray-500">Stored securely in your database — never exposed to the browser or logs.</p>
            </div>

            {secretKey.configured && (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl">
                <CheckCircle size={16} className="text-green-600 shrink-0" />
                <span className="text-sm text-green-800">Current: <code className="font-mono bg-green-100 px-1.5 py-0.5 rounded">{secretKey.masked}</code></span>
                <span className="text-[10px] uppercase tracking-wide text-green-600 ml-auto">{secretKey.source}</span>
                <button onClick={() => clearKey('secretKey')} className="p-1 text-red-400 hover:text-red-600" title="Remove key">
                  <Trash size={14} />
                </button>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Paste Stripe Secret Key</label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={secretInput}
                    onChange={e => setSecretInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveKey('secretKey')}
                    placeholder="sk_live_... or sk_test_..."
                    className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  />
                  <button onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
                    {showSecret ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <button
                  onClick={() => saveKey('secretKey')}
                  disabled={saving === 'secretKey' || !secretInput.trim()}
                  className={`${BTN} bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 shrink-0`}
                >
                  {saving === 'secretKey' ? <ArrowClockwise size={14} className="animate-spin" /> : <FloppyDisk size={14} />}
                  {saving === 'secretKey' ? 'Saving...' : 'Save'}
                </button>
              </div>
              <p className="text-xs text-gray-500">Find it in Stripe Dashboard → Developers → API keys.</p>
            </div>
          </div>
        </div>

        {/* Webhook secret */}
        <div className={CARD}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-purple-500 flex items-center justify-center">
              <ExclamationMark size={16} className="text-white" />
            </div>
            <h2 className="font-bold text-gray-900">Webhook Secret</h2>
          </div>

          <div className="space-y-3">
            <div className="p-3 rounded-xl text-sm bg-gray-50 text-gray-700 border border-gray-100">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={14} />
                <span className="font-semibold">Signs payment events</span>
              </div>
              <p className="text-xs text-gray-500">Records paid orders &amp; updates stock when a customer completes checkout.</p>
            </div>

            {webhookSecret.configured && (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl">
                <CheckCircle size={16} className="text-green-600 shrink-0" />
                <span className="text-sm text-green-800">Current: <code className="font-mono bg-green-100 px-1.5 py-0.5 rounded">{webhookSecret.masked}</code></span>
                <span className="text-[10px] uppercase tracking-wide text-green-600 ml-auto">{webhookSecret.source}</span>
                <button onClick={() => clearKey('webhookSecret')} className="p-1 text-red-400 hover:text-red-600" title="Remove key">
                  <Trash size={14} />
                </button>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Paste Webhook Secret (whsec_...)</label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type={showWh ? 'text' : 'password'}
                    value={whInput}
                    onChange={e => setWhInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveKey('webhookSecret')}
                    placeholder="whsec_..."
                    className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400"
                  />
                  <button onClick={() => setShowWh(!showWh)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
                    {showWh ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <button
                  onClick={() => saveKey('webhookSecret')}
                  disabled={saving === 'webhookSecret' || !whInput.trim()}
                  className={`${BTN} bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50 shrink-0`}
                >
                  {saving === 'webhookSecret' ? <ArrowClockwise size={14} className="animate-spin" /> : <FloppyDisk size={14} />}
                  {saving === 'webhookSecret' ? 'Saving...' : 'Save'}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Add a webhook endpoint at <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">https://luxedge.us/api/webhook</code> in Stripe Dashboard → Developers → Webhooks, then paste its signing secret. Subscribe to <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">checkout.session.completed</code> (and optionally <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">charge.refunded</code>).
              </p>
            </div>
          </div>
        </div>
      </div>

      {note && (
        <p className={`text-sm ${note.kind === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{note.text}</p>
      )}

      {/* ── What Payments Enables ── */}
      <div className={CARD}>
        <h2 className="font-bold text-gray-900 mb-3">What Payments Enables</h2>
        <div className="space-y-2">
          {[
            'Stripe-hosted checkout — Luxedge never sees card details',
            'Server-authoritative pricing (the browser can\'t change the amount)',
            'Real paid orders recorded in the Admin → Orders page',
            'Atomic inventory reservation so two customers can\'t buy the last unit',
          ].map((t, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-gray-600">
              <span className="text-blue-500 mt-0.5"><CheckCircle size={14} /></span>
              <span>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

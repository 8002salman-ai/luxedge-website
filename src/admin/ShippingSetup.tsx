// ============================================================================
// LUXEDGE — Admin Shipping Setup (Shippo)
//
// Shows Shippo connection status, sender address config, address validation
// capability, and allows testing the connection. Secrets are NEVER exposed.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plug, CheckCircle, XCircle, ArrowClockwise, Globe } from '@phosphor-icons/react';
import { getAccessToken } from '../services/supabase';

const CARD = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-5';
const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200 disabled:opacity-50';

interface ShippoStatus {
  configured: boolean;
  apiKeyPresent: boolean;
  apiKeyMasked: string;
  fromName: string;
  fromAddress: string;
  fromCity: string;
  fromState: string;
  fromZip: string;
  testResult?: { ok: boolean; message: string; latencyMs?: number };
  lastTestAt?: string;
}

export default function ShippingSetup() {
  const nav = useNavigate();
  const [status, setStatus] = useState<ShippoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/shippo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'status' }),
      });
      if (res.ok) setStatus(await res.json() as ShippoStatus);
    } catch { /* ignore */ }
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const runTest = async () => {
    setTesting(true);
    setNote(null);
    try {
      const res = await fetch('/api/shippo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'test' }),
      });
      const data = await res.json() as { ok?: boolean; message?: string; latencyMs?: number };
      setNote(data.ok
        ? { kind: 'ok', text: `✓ Shippo connection successful (${data.latencyMs || 0}ms)` }
        : { kind: 'err', text: `✗ ${data.message || 'Connection failed'}` });
      void loadStatus();
    } catch {
      setNote({ kind: 'err', text: 'Network error — could not reach server.' });
    }
    setTesting(false);
  };

  if (loading && !status) {
    return (
      <div className="max-w-4xl mx-auto p-6 flex items-center justify-center min-h-[40vh]">
        <ArrowClockwise size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  const configured = status?.configured || false;
  const apiKeyOk = status?.apiKeyPresent || false;
  const senderComplete = Boolean(status?.fromName && status?.fromAddress && status?.fromCity && status?.fromState && status?.fromZip);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/admin')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft size={20} className="text-gray-500" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Shipping Configuration</h1>
          <p className="text-sm text-gray-500 mt-0.5">Shippo-powered address validation and live carrier rates</p>
        </div>
        <button onClick={loadStatus} disabled={loading} className={`${BTN} bg-blue-500 text-white hover:bg-blue-600`}>
          {loading ? <ArrowClockwise size={14} className="animate-spin" /> : <Plug size={14} />}
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Status Banner */}
      <div className={`rounded-2xl p-5 flex items-center gap-4 ${configured ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${configured ? 'bg-green-100' : 'bg-amber-100'}`}>
          {configured ? <CheckCircle size={24} className="text-green-600" /> : <XCircle size={24} className="text-amber-600" />}
        </div>
        <div className="flex-1">
          <p className={`font-bold text-lg ${configured ? 'text-green-800' : 'text-amber-800'}`}>
            Shippo — {configured ? 'Connected' : 'Not Configured'}
          </p>
          <p className="text-sm text-gray-600 mt-0.5">
            {configured
              ? 'Address validation and live carrier rates are available.'
              : 'Add your Shippo API key to enable address validation and live shipping rates.'}
          </p>
        </div>
        <button onClick={runTest} disabled={testing || !apiKeyOk} className={`${BTN} bg-blue-500 text-white hover:bg-blue-600`}>
          {testing ? <ArrowClockwise size={14} className="animate-spin" /> : <Plug size={14} />}
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
      </div>

      {/* Test Result */}
      {note && (
        <div className={`rounded-2xl p-4 border ${note.kind === 'ok' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <p className={`text-sm font-semibold ${note.kind === 'ok' ? 'text-green-800' : 'text-red-700'}`}>{note.text}</p>
        </div>
      )}

      {/* API Key Status */}
      <div className={CARD}>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center text-white text-xs font-bold">🔑</div>
          <h2 className="font-bold text-gray-900">API Key</h2>
          {apiKeyOk && <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">CONFIGURED</span>}
          {!apiKeyOk && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold">MISSING</span>}
        </div>
        <p className="text-xs text-gray-500 mb-2">
          Set via Cloudflare Worker secret: <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">wrangler secret put SHIPPO_API_KEY</code>
        </p>
        {apiKeyOk && status?.apiKeyMasked && (
          <p className="text-sm text-gray-700">Current: <code className="font-mono bg-green-100 px-1.5 py-0.5 rounded">{status.apiKeyMasked}</code></p>
        )}
      </div>

      {/* Sender Address */}
      <div className={CARD}>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white text-xs">📦</div>
          <h2 className="font-bold text-gray-900">Sender Address</h2>
          {senderComplete && <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">CONFIGURED</span>}
          {!senderComplete && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">INCOMPLETE</span>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <span className="text-xs text-gray-400">Name</span>
            <p className="font-medium text-gray-700">{status?.fromName || '—'}</p>
          </div>
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <span className="text-xs text-gray-400">Address</span>
            <p className="font-medium text-gray-700">{status?.fromAddress || '—'}</p>
          </div>
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <span className="text-xs text-gray-400">City / State</span>
            <p className="font-medium text-gray-700">{status?.fromCity || '—'}, {status?.fromState || '—'}</p>
          </div>
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <span className="text-xs text-gray-400">ZIP</span>
            <p className="font-medium text-gray-700">{status?.fromZip || '—'}</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Set via Cloudflare Worker vars: <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">wrangler var put SHIPPO_FROM_NAME</code>, etc.
        </p>
      </div>

      {/* Capabilities */}
      <div className={CARD}>
        <h2 className="font-bold text-gray-900 mb-3">Capabilities</h2>
        <div className="space-y-2">
          {[
            { label: 'Address validation (USPS)', enabled: configured },
            { label: 'Live carrier shipping rates', enabled: configured },
            { label: 'Corrected address suggestions', enabled: configured },
            { label: 'Gift Drop address gate (fail-closed)', enabled: true },
          ].map((cap) => (
            <div key={cap.label} className="flex items-center gap-2 text-sm">
              <span className={cap.enabled ? 'text-green-500' : 'text-gray-300'}>
                {cap.enabled ? <CheckCircle size={14} /> : <XCircle size={14} />}
              </span>
              <span className={cap.enabled ? 'text-gray-700' : 'text-gray-400'}>{cap.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Dashboard Link */}
      <a href="https://app.goshippo.com" target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-semibold">
        <Globe size={14} /> Open Shippo Dashboard
      </a>

      {/* Billing Note */}
      <div className={CARD}>
        <h2 className="font-bold text-gray-900 mb-2">Shipping Billing</h2>
        <p className="text-sm text-gray-600">
          Shipping label purchases and billing are managed directly in your Shippo account.
          Luxedge does not store banking or payment credentials for Shippo shipping labels.
        </p>
      </div>
    </div>
  );
}

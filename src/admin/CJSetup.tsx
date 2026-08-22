import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Package, ArrowLeft, Plug, CheckCircle, XCircle, Warning,
  MagnifyingGlass, Truck, ArrowClockwise,
  ShieldCheck, Database, CreditCard, Globe, MagnifyingGlass as SearchIcon, Eye,
  EyeSlash, FloppyDisk
} from '@phosphor-icons/react';
import { CjSupplierAdapter } from '../features/suppliers/cj/adapter';

/* ── Types ── */
type Health = 'not_configured' | 'online' | 'offline' | 'rate_limited' | 'configured';
type CJRecord = { title: string; sellPrice: number | null; imageUrl: string | null; itemId: string | null };

const CARD = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-5';
const BTN = 'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-200';

/* ── Component ── */
export default function CJSetup() {
  const nav = useNavigate();
  const [health, setHealth] = useState<Health>('not_configured');
  const [healthDetail, setHealthDetail] = useState('');
  const [checking, setChecking] = useState(false);

  // API Key form
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState('');

  // Test search
  const [testQuery, setTestQuery] = useState('dog toy');
  const [testResults, setTestResults] = useState<CJRecord[]>([]);
  const [testRunning, setTestRunning] = useState(false);
  const [testNote, setTestNote] = useState('');

  /* ── Health check ── */
  const checkHealth = useCallback(async () => {
    setChecking(true);
    try {
      const adapter = new CjSupplierAdapter();
      const result = await adapter.healthCheck();
      setHealth(result.health);
      setHealthDetail(result.detail || '');
    } catch {
      setHealth('offline');
      setHealthDetail('Connection failed — check server configuration');
    }
    setChecking(false);
  }, []);

  /* ── Load current key status ── */
  const loadKeyStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/cj-key', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { configured: boolean; masked: string | null };
        if (data.configured) setMaskedKey(data.masked);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void checkHealth(); void loadKeyStatus(); }, [checkHealth, loadKeyStatus]);

  /* ── Save API key ── */
  const saveKey = async () => {
    if (!apiKey.trim()) { setSaveNote('Enter a CJ API key first'); return; }
    setSaving(true);
    setSaveNote('');
    try {
      const res = await fetch('/api/admin/cj-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ key: apiKey.trim() }),
      });
      const data = await res.json() as { ok?: boolean; masked?: string; error?: string };
      if (data.ok) {
        setMaskedKey(data.masked || null);
        setApiKey('');
        setSaveNote('✓ Key saved — testing connection...');
        // Re-check health
        setTimeout(() => { void checkHealth(); }, 500);
      } else {
        setSaveNote(`Error: ${data.error || 'Failed to save'}`);
      }
    } catch {
      setSaveNote('Network error — could not save key');
    }
    setSaving(false);
  };

  /* ── Test search ── */
  const runTestSearch = async () => {
    if (!testQuery.trim()) return;
    setTestRunning(true);
    setTestResults([]);
    setTestNote('');
    try {
      const adapter = new CjSupplierAdapter();
      const result = await adapter.searchProducts({ query: testQuery.trim(), maxResults: 5 });
      setTestResults(result.records.slice(0, 5).map(r => ({ title: r.title, sellPrice: r.sellPrice, imageUrl: r.imageUrl, itemId: r.productId })));
      setTestNote(`Found products — showing top ${Math.min(5, result.records.length)}${result.warning ? ' · ' + result.warning : ''}`);
    } catch (e: any) {
      setTestNote(`Search failed: ${e?.message || 'Unknown error'}`);
    }
    setTestRunning(false);
  };

  const isOnline = health === 'online' || health === 'configured';
  const isOffline = health === 'offline' || health === 'not_configured';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/admin')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft size={20} className="text-gray-500" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">CJ Supplier Setup</h1>
          <p className="text-sm text-gray-500 mt-0.5">Configure your CJ Dropshipping API connection for product sourcing</p>
        </div>
        <button
          onClick={checkHealth}
          disabled={checking}
          className={`${BTN} ${isOnline ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
        >
          {checking ? <ArrowClockwise size={14} className="animate-spin" /> : <Plug size={14} />}
          {checking ? 'Checking...' : 'Refresh Status'}
        </button>
      </div>

      {/* ── Status Banner ── */}
      <div className={`rounded-2xl p-5 flex items-center gap-4 ${isOnline ? 'bg-green-50 border border-green-200' : health === 'rate_limited' ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'}`}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isOnline ? 'bg-green-100' : health === 'rate_limited' ? 'bg-amber-100' : 'bg-red-100'}`}>
          {isOnline ? <CheckCircle size={24} className="text-green-600" /> : health === 'rate_limited' ? <Warning size={24} className="text-amber-600" /> : <XCircle size={24} className="text-red-500" />}
        </div>
        <div className="flex-1">
          <p className={`font-bold text-lg ${isOnline ? 'text-green-800' : health === 'rate_limited' ? 'text-amber-800' : 'text-red-800'}`}>
            {isOnline ? 'CJ Supplier — ONLINE' : health === 'rate_limited' ? 'CJ Supplier — Rate Limited' : 'CJ Supplier — Not Configured'}
          </p>
          <p className="text-sm text-gray-600 mt-0.5">
            {isOnline ? (healthDetail || 'CJ authentication succeeded — ready to search and source products') : health === 'rate_limited' ? 'Too many requests — wait a few minutes before retrying' : 'Enter your CJ API key below to enable product sourcing'}
          </p>
        </div>
        {isOnline && (
          <div className="text-right">
            <div className="text-xs text-gray-500">Connection</div>
            <div className="text-green-700 font-bold">Verified ✓</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left: API Key Input ── */}
        <div className="space-y-5">
          {/* API Key Form */}
          <div className={CARD}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center">
                <CreditCard size={16} className="text-white" />
              </div>
              <h3 className="font-bold text-gray-900">CJ API Key</h3>
            </div>

            <div className="space-y-3">
              <div className={`p-3 rounded-xl text-sm ${isOnline ? 'bg-green-50 text-green-800 border border-green-100' : 'bg-gray-50 text-gray-700 border border-gray-100'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck size={14} />
                  <span className="font-semibold">Server-side only</span>
                </div>
                <p className="text-xs text-gray-500">Stored securely in your database — never exposed to the browser, logs, or client code.</p>
              </div>

              {maskedKey && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl">
                  <CheckCircle size={16} className="text-green-600 shrink-0" />
                  <span className="text-sm text-green-800">Current key: <code className="font-mono bg-green-100 px-1.5 py-0.5 rounded">{maskedKey}</code></span>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700">Enter CJ API Key</label>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveKey()}
                      placeholder="CJ#####@api@..."
                      className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    />
                    <button
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                    >
                      {showKey ? <EyeSlash size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <button
                    onClick={saveKey}
                    disabled={saving || !apiKey.trim()}
                    className={`${BTN} bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 shrink-0`}
                  >
                    {saving ? <ArrowClockwise size={14} className="animate-spin" /> : <FloppyDisk size={14} />}
                    {saving ? 'Saving...' : 'Save Key'}
                  </button>
                </div>
                {saveNote && (
                  <p className={`text-xs ${saveNote.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{saveNote}</p>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-xs text-gray-500">Don't have a key? Get one from:</p>
                <a href="https://cjdropshipping.com" target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5">
                  cjdropshipping.com → My API → API Key <Eye size={10} />
                </a>
              </div>
            </div>
          </div>

          {/* What CJ Enables */}
          <div className={CARD}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-purple-500 flex items-center justify-center">
                <Package size={16} className="text-white" />
              </div>
              <h3 className="font-bold text-gray-900">What CJ Enables</h3>
            </div>
            <div className="space-y-2">
              {[
                { icon: <SearchIcon size={14} />, text: 'Search CJ catalog for dog, cat, bird, horse & livestock products' },
                { icon: <Truck size={14} />, text: 'US-verified inventory & shipping estimates' },
                { icon: <Database size={14} />, text: 'Real supplier cost, images, variants & product details' },
                { icon: <Globe size={14} />, text: 'Product Scout market-grounded CJ search' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="text-blue-500 mt-0.5">{item.icon}</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Test Search ── */}
        <div className="space-y-5">
          <div className={CARD}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
                <MagnifyingGlass size={16} className="text-white" />
              </div>
              <h3 className="font-bold text-gray-900">Test Search</h3>
            </div>

            {isOffline ? (
              <div className="bg-gray-50 rounded-xl p-4 text-center">
                <Warning size={24} className="text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-600">Configure your CJ API key first</p>
                <p className="text-xs text-gray-400 mt-1">Once ONLINE, you can test search queries here</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    value={testQuery}
                    onChange={e => setTestQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && runTestSearch()}
                    placeholder="e.g. dog enrichment toy, cat bed, parrot cage"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  />
                  <button
                    onClick={runTestSearch}
                    disabled={testRunning}
                    className={`${BTN} bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50`}
                  >
                    {testRunning ? <ArrowClockwise size={14} className="animate-spin" /> : <MagnifyingGlass size={14} />}
                    {testRunning ? 'Searching...' : 'Search'}
                  </button>
                </div>

                {testNote && (
                  <p className="text-xs text-gray-500">{testNote}</p>
                )}

                {testResults.length > 0 && (
                  <div className="space-y-2">
                    {testResults.map((r, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                        {r.imageUrl ? (
                          <img src={r.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover bg-white" />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-gray-200 flex items-center justify-center">
                            <Package size={16} className="text-gray-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{r.title || 'Untitled'}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {r.sellPrice != null && <span className="text-xs font-bold text-green-700">${r.sellPrice.toFixed(2)}</span>}
                            {r.itemId && <span className="text-xs text-gray-400">ID: {r.itemId}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick Links */}
          <div className={CARD}>
            <h3 className="font-bold text-gray-900 mb-3">Quick Links</h3>
            <div className="space-y-2">
              {[
                { label: 'Product Scout', desc: 'Advanced CJ search with market intelligence', to: '/admin/scout', color: 'bg-orange-500' },
                { label: 'AI Import', desc: 'Import products from AliExpress, Amazon & more', to: '/admin/ai-import', color: 'bg-purple-500' },
                { label: 'Products', desc: 'View and manage your catalog', to: '/admin/products', color: 'bg-blue-500' },
                { label: 'AI Hub', desc: 'AI provider configuration and testing', to: '/admin/ai', color: 'bg-indigo-500' },
              ].map((item, i) => (
                <button
                  key={i}
                  onClick={() => nav(item.to)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-colors text-left"
                >
                  <div className={`w-8 h-8 rounded-lg ${item.color} flex items-center justify-center`}>
                    <Package size={14} className="text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                    <p className="text-xs text-gray-500">{item.desc}</p>
                  </div>
                  <ArrowClockwise size={14} className="ml-auto text-gray-400" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

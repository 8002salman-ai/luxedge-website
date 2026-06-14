import { useState } from 'react';
import { Save, Lock, User, Store, Key, Eye, EyeOff, Loader2, ExternalLink } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useSettingsStore } from '../../store/settingsStore';

type Tab = 'profile' | 'security' | 'store' | 'apikeys';

const TABS: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Security' },
  { id: 'store', label: 'Store' },
  { id: 'apikeys', label: 'API Keys' },
];

export default function SettingsPage() {
  const { user, updateProfile, changePassword } = useAuthStore();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const { apiKeys, storeConfig, updateApiKeys, updateStoreConfig } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [loading, setLoading] = useState(false);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  const [profileData, setProfileData] = useState({ name: user?.name || '', email: user?.email || '' });
  const [passwordData, setPasswordData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [storeData, setStoreData] = useState({ ...storeConfig });
  const [keysData, setKeysData] = useState({ ...apiKeys });

  const toggleKey = (k: string) => setShowKey((p) => ({ ...p, [k]: !p[k] }));

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise((r) => setTimeout(r, 400));
    updateProfile(profileData);
    addNotification({ type: 'success', message: 'Profile updated!' });
    setLoading(false);
  };

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      addNotification({ type: 'error', message: 'New passwords do not match' });
      return;
    }
    const result = changePassword(passwordData.currentPassword, passwordData.newPassword);
    if (result.success) {
      addNotification({ type: 'success', message: 'Password changed!' });
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } else {
      addNotification({ type: 'error', message: result.message });
    }
  };

  const handleStoreSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateStoreConfig(storeData);
    addNotification({ type: 'success', message: 'Store settings saved!' });
  };

  const handleApiKeysSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateApiKeys(keysData);
    addNotification({ type: 'success', message: 'API keys saved!' });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm">Manage store settings, API keys and integrations</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.id === 'profile' && <User size={14} />}
            {tab.id === 'security' && <Lock size={14} />}
            {tab.id === 'store' && <Store size={14} />}
            {tab.id === 'apikeys' && <Key size={14} />}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Profile */}
      {activeTab === 'profile' && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 max-w-lg">
          <h2 className="font-semibold text-gray-900 mb-6">Admin Profile</h2>
          <form onSubmit={handleProfileUpdate} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Name</label>
              <input type="text" value={profileData.name} onChange={(e) => setProfileData({ ...profileData, name: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Email</label>
              <input type="email" value={profileData.email} onChange={(e) => setProfileData({ ...profileData, email: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary" />
            </div>
            <button type="submit" disabled={loading} className="flex items-center gap-2 px-6 py-2.5 bg-admin-primary hover:bg-admin-primary-dark text-white font-medium rounded-lg transition-colors disabled:opacity-70">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save Changes
            </button>
          </form>
        </div>
      )}

      {/* Security */}
      {activeTab === 'security' && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 max-w-lg">
          <h2 className="font-semibold text-gray-900 mb-6">Change Password</h2>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            {([
              { key: 'currentPassword', label: 'Current Password' },
              { key: 'newPassword', label: 'New Password' },
              { key: 'confirmPassword', label: 'Confirm New Password' },
            ] as { key: keyof typeof passwordData; label: string }[]).map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">{label}</label>
                <input type="password" required minLength={key !== 'currentPassword' ? 6 : undefined} value={passwordData[key]} onChange={(e) => setPasswordData({ ...passwordData, [key]: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary" />
              </div>
            ))}
            <button type="submit" className="flex items-center gap-2 px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-lg transition-colors">
              <Lock size={16} /> Update Password
            </button>
          </form>
        </div>
      )}

      {/* Store */}
      {activeTab === 'store' && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 max-w-2xl">
          <h2 className="font-semibold text-gray-900 mb-6">Store Information</h2>
          <form onSubmit={handleStoreSave} className="grid sm:grid-cols-2 gap-4">
            {([
              { field: 'storeName' as const, label: 'Store Name', type: 'text' },
              { field: 'contactEmail' as const, label: 'Contact Email', type: 'email' },
              { field: 'phone' as const, label: 'Phone', type: 'tel' },
              { field: 'address' as const, label: 'Address', type: 'text' },
              { field: 'freeShippingThreshold' as const, label: 'Free Shipping Threshold ($)', type: 'number' },
              { field: 'shippingFee' as const, label: 'Shipping Fee ($)', type: 'number' },
            ]).map(({ field, label, type }) => (
              <div key={field}>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">{label}</label>
                <input type={type} step={type === 'number' ? '0.01' : undefined} value={storeData[field]} onChange={(e) => setStoreData({ ...storeData, [field]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary" />
              </div>
            ))}
            <div className="sm:col-span-2">
              <button type="submit" className="flex items-center gap-2 px-6 py-2.5 bg-admin-primary hover:bg-admin-primary-dark text-white font-medium rounded-lg transition-colors">
                <Save size={16} /> Save Store Settings
              </button>
            </div>
          </form>
        </div>
      )}

      {/* API Keys */}
      {activeTab === 'apikeys' && (
        <div className="space-y-5 max-w-2xl">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-amber-900 mb-1">Secure Local Storage</p>
            <p className="text-xs text-amber-700">
              Keys are stored only in your browser. They are sent directly to each service — never to any third-party.
            </p>
          </div>

          <form onSubmit={handleApiKeysSave} className="space-y-4">

            {/* ─── scrape.do ─── RECOMMENDED FREE */}
            <div className="bg-white rounded-xl border-2 border-green-200 p-5">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 text-sm">scrape.do</h3>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-green-500 text-white rounded-full">RECOMMENDED FREE</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">1,000 requests/month — permanently free — no credit card — best for AliExpress import.</p>
                </div>
                <a
                  href="https://scrape.do"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-green-600 hover:underline font-semibold shrink-0 ml-4"
                >
                  Free Signup <ExternalLink size={10} />
                </a>
              </div>
              <div className="relative mt-3">
                <input
                  type={showKey.scrapedoKey ? 'text' : 'password'}
                  placeholder="Paste your scrape.do token here..."
                  value={keysData.scrapedoKey}
                  onChange={(e) => setKeysData({ ...keysData, scrapedoKey: e.target.value })}
                  className="w-full px-4 py-2.5 pr-10 border border-green-200 rounded-lg text-sm font-mono focus:outline-none focus:border-green-400"
                />
                <button type="button" onClick={() => toggleKey('scrapedoKey')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showKey.scrapedoKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {keysData.scrapedoKey && (
                <p className="mt-2 text-xs text-green-600 font-medium">✓ scrape.do active — AliExpress import ready!</p>
              )}
              {!keysData.scrapedoKey && (
                <div className="mt-3 bg-green-50 border border-green-100 rounded-lg p-3">
                  <p className="text-xs text-green-800 font-medium mb-1">How to get free key (2 minutes):</p>
                  <ol className="text-xs text-green-700 space-y-0.5 list-decimal list-inside">
                    <li>Go to scrape.do → click "Start for Free"</li>
                    <li>Sign up with your Gmail (no credit card)</li>
                    <li>Copy your token from the dashboard</li>
                    <li>Paste it above and click Save</li>
                  </ol>
                </div>
              )}
            </div>

            {/* ─── OpenAI ─── */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">OpenAI API Key</h3>
                  <p className="text-xs text-gray-500 mt-0.5">For AI-enhanced product descriptions. Optional.</p>
                </div>
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline shrink-0 ml-4">
                  Get Key <ExternalLink size={10} />
                </a>
              </div>
              <div className="relative mt-3">
                <input type={showKey.openAiKey ? 'text' : 'password'} placeholder="sk-..." value={keysData.openAiKey} onChange={(e) => setKeysData({ ...keysData, openAiKey: e.target.value })} className="w-full px-4 py-2.5 pr-10 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-admin-primary" />
                <button type="button" onClick={() => toggleKey('openAiKey')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showKey.openAiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* ─── Supabase ─── */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Supabase (Database + Auth)</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Persistent database and Google Login. Free tier available.</p>
                </div>
                <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline shrink-0 ml-4">
                  Free Setup <ExternalLink size={10} />
                </a>
              </div>
              <div className="space-y-3 mt-3">
                <input type="text" placeholder="https://xxxxxxxxxxxx.supabase.co" value={keysData.supabaseUrl} onChange={(e) => setKeysData({ ...keysData, supabaseUrl: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-admin-primary" />
                <div className="relative">
                  <input type={showKey.supabaseAnonKey ? 'text' : 'password'} placeholder="Supabase Anon Key..." value={keysData.supabaseAnonKey} onChange={(e) => setKeysData({ ...keysData, supabaseAnonKey: e.target.value })} className="w-full px-4 py-2.5 pr-10 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-admin-primary" />
                  <button type="button" onClick={() => toggleKey('supabaseAnonKey')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showKey.supabaseAnonKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>

            {/* ─── Stripe ─── */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Stripe (Payments)</h3>
                  <p className="text-xs text-gray-500 mt-0.5">For real online payments. Publishable key (pk_...).</p>
                </div>
                <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline shrink-0 ml-4">
                  Stripe Dashboard <ExternalLink size={10} />
                </a>
              </div>
              <div className="relative mt-3">
                <input type={showKey.stripePublishableKey ? 'text' : 'password'} placeholder="pk_live_..." value={keysData.stripePublishableKey} onChange={(e) => setKeysData({ ...keysData, stripePublishableKey: e.target.value })} className="w-full px-4 py-2.5 pr-10 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-admin-primary" />
                <button type="button" onClick={() => toggleKey('stripePublishableKey')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showKey.stripePublishableKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* ─── Google OAuth ─── */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Google OAuth (Google Login)</h3>
                  <p className="text-xs text-gray-500 mt-0.5">OAuth 2.0 Client ID from Google Cloud Console. Free.</p>
                </div>
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline shrink-0 ml-4">
                  Google Console <ExternalLink size={10} />
                </a>
              </div>
              <input type="text" placeholder="xxxxxxxxxxxx.apps.googleusercontent.com" value={keysData.googleClientId} onChange={(e) => setKeysData({ ...keysData, googleClientId: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-mono mt-3 focus:outline-none focus:border-admin-primary" />
            </div>

            <button type="submit" className="flex items-center gap-2 px-6 py-2.5 bg-admin-primary hover:bg-admin-primary-dark text-white font-medium rounded-lg transition-colors">
              <Save size={16} /> Save All API Keys
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

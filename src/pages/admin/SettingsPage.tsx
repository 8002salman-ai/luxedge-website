import { useState } from 'react';
import { Save, Lock, User, Store, Key, Eye, EyeOff, Loader2, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useSettingsStore } from '../../store/settingsStore';

export default function SettingsPage() {
  const { user, updateProfile, changePassword } = useAuthStore();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const { apiKeys, storeConfig, updateApiKeys, updateStoreConfig } = useSettingsStore();

  const [loading, setLoading] = useState(false);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [openSection, setOpenSection] = useState<Record<string, boolean>>({
    profile: true,
    security: false,
    store: false,
    apikeys: true,
  });

  const [profileData, setProfileData] = useState({ name: user?.name || '', email: user?.email || '' });
  const [passwordData, setPasswordData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [storeData, setStoreData] = useState({ ...storeConfig });
  const [keysData, setKeysData] = useState({ ...apiKeys });

  const toggleKey = (k: string) => setShowKey((p) => ({ ...p, [k]: !p[k] }));
  const toggleSection = (s: string) => setOpenSection((p) => ({ ...p, [s]: !p[s] }));

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

  const SectionHeader = ({ id, icon, title, badge }: { id: string; icon: React.ReactNode; title: string; badge?: string }) => (
    <button
      type="button"
      onClick={() => toggleSection(id)}
      className="w-full flex items-center justify-between p-5 text-left"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 bg-admin-primary/10 rounded-lg text-admin-primary">{icon}</div>
        <span className="font-semibold text-gray-900">{title}</span>
        {badge && (
          <span className="px-2 py-0.5 text-[10px] font-bold bg-green-500 text-white rounded-full">{badge}</span>
        )}
      </div>
      {openSection[id] ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
    </button>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm">Manage your store, account and API integrations</p>
      </div>

      {/* ═══════════════ API KEYS (shown first & open) ═══════════════ */}
      <div className="bg-white rounded-xl border-2 border-green-200 overflow-hidden">
        <SectionHeader id="apikeys" icon={<Key size={16} />} title="API Keys & Integrations" badge="IMPORTANT" />

        {openSection.apikeys && (
          <form onSubmit={handleApiKeysSave} className="px-5 pb-5 space-y-4">

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-800">
                Keys are stored <strong>only in your browser</strong>. Add keys below to enable AliExpress import, payments, and Google login.
              </p>
            </div>

            {/* scrape.do — RECOMMENDED */}
            <div className="border-2 border-green-200 rounded-xl p-4 bg-green-50/30">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900 text-sm">scrape.do Token</p>
                    <span className="px-2 py-0.5 text-[9px] font-bold bg-green-500 text-white rounded-full">RECOMMENDED FREE</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">AliExpress import ke liye zaroori. 1,000 req/month — hamesha free — koi credit card nahi.</p>
                </div>
                <a href="https://scrape.do" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-semibold text-green-600 hover:underline shrink-0 ml-3">
                  Free Signup <ExternalLink size={10} />
                </a>
              </div>
              {!keysData.scrapedoKey && (
                <div className="mb-3 bg-white rounded-lg p-3 border border-green-100">
                  <p className="text-xs font-semibold text-green-800 mb-1">Aisa karo (2 minute mein):</p>
                  <ol className="text-xs text-green-700 space-y-0.5 list-decimal list-inside">
                    <li>scrape.do par jao → "Start for Free" click karo</li>
                    <li>Gmail se signup karo (credit card nahi chahiye)</li>
                    <li>Dashboard se Token copy karo</li>
                    <li>Neeche paste karo aur Save karo</li>
                  </ol>
                </div>
              )}
              <div className="relative">
                <input
                  type={showKey.scrapedoKey ? 'text' : 'password'}
                  placeholder="Apna scrape.do token yahan paste karo..."
                  value={keysData.scrapedoKey}
                  onChange={(e) => setKeysData({ ...keysData, scrapedoKey: e.target.value })}
                  className="w-full px-4 py-2.5 pr-10 border border-green-300 rounded-lg text-sm font-mono focus:outline-none focus:border-green-500 bg-white"
                />
                <button type="button" onClick={() => toggleKey('scrapedoKey')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {showKey.scrapedoKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {keysData.scrapedoKey && (
                <p className="mt-2 text-xs text-green-600 font-semibold">✓ scrape.do active — AliExpress import ready!</p>
              )}
            </div>

            {/* OpenAI */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">OpenAI API Key</p>
                  <p className="text-xs text-gray-500 mt-0.5">AI description enhancement ke liye. Optional.</p>
                </div>
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline shrink-0 ml-3">
                  Get Key <ExternalLink size={10} />
                </a>
              </div>
              <div className="relative">
                <input type={showKey.openAiKey ? 'text' : 'password'} placeholder="sk-..." value={keysData.openAiKey} onChange={(e) => setKeysData({ ...keysData, openAiKey: e.target.value })} className="w-full px-4 py-2.5 pr-10 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-admin-primary" />
                <button type="button" onClick={() => toggleKey('openAiKey')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {showKey.openAiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Supabase */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Supabase — Database & Google Login</p>
                  <p className="text-xs text-gray-500 mt-0.5">Real database aur Google Login ke liye. Free tier available.</p>
                </div>
                <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline shrink-0 ml-3">
                  Free Signup <ExternalLink size={10} />
                </a>
              </div>
              <div className="space-y-2">
                <input type="text" placeholder="Supabase URL: https://xxxx.supabase.co" value={keysData.supabaseUrl} onChange={(e) => setKeysData({ ...keysData, supabaseUrl: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-admin-primary" />
                <div className="relative">
                  <input type={showKey.supabaseAnonKey ? 'text' : 'password'} placeholder="Supabase Anon Key..." value={keysData.supabaseAnonKey} onChange={(e) => setKeysData({ ...keysData, supabaseAnonKey: e.target.value })} className="w-full px-4 py-2.5 pr-10 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-admin-primary" />
                  <button type="button" onClick={() => toggleKey('supabaseAnonKey')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {showKey.supabaseAnonKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Stripe */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Stripe — Online Payments</p>
                  <p className="text-xs text-gray-500 mt-0.5">Real payments ke liye. Publishable key (pk_live_...) add karo.</p>
                </div>
                <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline shrink-0 ml-3">
                  Stripe Dashboard <ExternalLink size={10} />
                </a>
              </div>
              <div className="relative">
                <input type={showKey.stripePublishableKey ? 'text' : 'password'} placeholder="pk_live_..." value={keysData.stripePublishableKey} onChange={(e) => setKeysData({ ...keysData, stripePublishableKey: e.target.value })} className="w-full px-4 py-2.5 pr-10 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-admin-primary" />
                <button type="button" onClick={() => toggleKey('stripePublishableKey')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {showKey.stripePublishableKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Google OAuth */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Google OAuth — Google Login</p>
                  <p className="text-xs text-gray-500 mt-0.5">Customer Google se login kar sakein. Google Cloud Console se Client ID lo.</p>
                </div>
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline shrink-0 ml-3">
                  Google Console <ExternalLink size={10} />
                </a>
              </div>
              <input type="text" placeholder="xxxxxxxxxxxx.apps.googleusercontent.com" value={keysData.googleClientId} onChange={(e) => setKeysData({ ...keysData, googleClientId: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-admin-primary" />
            </div>

            <button type="submit" className="w-full flex items-center justify-center gap-2 py-3 bg-admin-primary hover:bg-admin-primary-dark text-white font-semibold rounded-xl transition-colors">
              <Save size={16} /> Save All API Keys
            </button>
          </form>
        )}
      </div>

      {/* ═══════════════ STORE SETTINGS ═══════════════ */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <SectionHeader id="store" icon={<Store size={16} />} title="Store Information" />
        {openSection.store && (
          <form onSubmit={handleStoreSave} className="px-5 pb-5">
            <div className="grid sm:grid-cols-2 gap-4">
              {([
                { field: 'storeName' as const, label: 'Store Name', type: 'text' },
                { field: 'contactEmail' as const, label: 'Contact Email', type: 'email' },
                { field: 'phone' as const, label: 'Phone', type: 'tel' },
                { field: 'address' as const, label: 'Address', type: 'text' },
                { field: 'freeShippingThreshold' as const, label: 'Free Shipping Above ($)', type: 'number' },
                { field: 'shippingFee' as const, label: 'Shipping Fee ($)', type: 'number' },
              ]).map(({ field, label, type }) => (
                <div key={field}>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">{label}</label>
                  <input type={type} step={type === 'number' ? '0.01' : undefined} value={storeData[field]} onChange={(e) => setStoreData({ ...storeData, [field]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary" />
                </div>
              ))}
            </div>
            <button type="submit" className="mt-4 flex items-center gap-2 px-6 py-2.5 bg-admin-primary hover:bg-admin-primary-dark text-white font-medium rounded-lg transition-colors">
              <Save size={16} /> Save Store Settings
            </button>
          </form>
        )}
      </div>

      {/* ═══════════════ PROFILE ═══════════════ */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <SectionHeader id="profile" icon={<User size={16} />} title="Admin Profile" />
        {openSection.profile && (
          <form onSubmit={handleProfileUpdate} className="px-5 pb-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Name</label>
              <input type="text" value={profileData.name} onChange={(e) => setProfileData({ ...profileData, name: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Email</label>
              <input type="email" value={profileData.email} onChange={(e) => setProfileData({ ...profileData, email: e.target.value })} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-admin-primary" />
            </div>
            <button type="submit" disabled={loading} className="flex items-center gap-2 px-6 py-2.5 bg-admin-primary hover:bg-admin-primary-dark text-white font-medium rounded-lg disabled:opacity-70 transition-colors">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Profile
            </button>
          </form>
        )}
      </div>

      {/* ═══════════════ SECURITY ═══════════════ */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <SectionHeader id="security" icon={<Lock size={16} />} title="Change Password" />
        {openSection.security && (
          <form onSubmit={handlePasswordChange} className="px-5 pb-5 space-y-4">
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
        )}
      </div>
    </div>
  );
}

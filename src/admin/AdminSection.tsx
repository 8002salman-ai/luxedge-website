// ============================================================================
// ADMIN SECTION — extracted from the App.tsx monolith into its own
// lazy-loaded chunk. It is only fetched when the user visits /admin/*,
// which keeps the storefront bundle small and fast.
// ============================================================================
import { useState, useEffect, useRef, useCallback, ReactNode, Component } from 'react';
import { Routes, Route, Link, useNavigate, useLocation, useParams, Navigate } from 'react-router-dom';
import { useApp, Modal, CAT_LIST, loadAIProviders, saveAIProviders, buildExtractionPrompt, callAIProvider, fetchPageContent, serverTestProvider, serverOpenRouterCredits, serverProviderStatus } from '../App';
import { useAuthStore } from '../store/authStore';
import ProductScout from './ProductScout';
import AiControlCenter from './AiControlCenter';
import type {
  Product, ProductVariant, Order, BlogPost, AdminCategory,
  AIProvider, AIExtractedProduct, EnterpriseVariant, VariantAttribute,
  SEOData, SocialSEO, ContentData, SEOScore, StructuredSchemas, ImportHistoryEntry,
  ProviderStatus, ProviderStatusMap,
} from '../App';
import {
  activeModeLabel, AD_SLOT_RE, clearPreviewConfig, CLIENT_ID_RE, fetchGlobalConfig,
  getCachedPreview, hasPreviewConfig, PLACEMENT_KEYS, PLACEMENT_LABELS,
  savePreviewConfig, validateConfig, MarketingConfig, PlacementKey, DEFAULT_CONFIG,
} from '../lib/marketing';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bot, CheckCircle, ChevronDown, ChevronRight, ChevronUp,
  Clipboard, Code, Cpu, DollarSign, Download, Edit2, Eye, FileText, FolderTree, Globe,
  History, ImageIcon, Layers, LayoutDashboard, Link2, Loader2, Lock, LogOut, Megaphone, Menu,
  Monitor, Package, PenLine, Plus, RefreshCw, RotateCcw, Save, Search, Send, Settings,
  Share2, Shield, ShoppingCart, Shuffle, Sliders, Smartphone, Sparkles, Star, Table2, Tag,
  Target, ToggleLeft, ToggleRight, Trash2, TrendingUp, Upload, User as UserIcon,
  Users as UsersIcon, Wand2, X, Zap,
} from 'lucide-react';

// Admin Blog Management
function ABlogs() {
  const { blogs, setBlogs, notify } = useApp();
  const [delId, setDelId] = useState<string | null>(null);
  const statusColor: Record<string, string> = { published: 'bg-green-100 text-green-700', pending: 'bg-yellow-100 text-yellow-700', draft: 'bg-gray-100 text-gray-600' };

  const updateStatus = (id: string, status: BlogPost['status']) => { setBlogs(prev => prev.map(b => b.id === id ? { ...b, status } : b)); notify(`Post ${status}!`); };
  const del = () => { if (delId) { setBlogs(prev => prev.filter(b => b.id !== delId)); notify('Post deleted!'); setDelId(null); } };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Blog Posts</h1>
        <Link to="/blog/write" className="px-4 py-2 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-sm rounded-lg flex items-center gap-2"><Plus size={16} />New Post</Link>
      </div>

      {blogs.length > 0 ? (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase"><tr><th className="px-6 py-4">Post</th><th className="px-6 py-4">Author</th><th className="px-6 py-4">Date</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Actions</th></tr></thead>
            <tbody>{blogs.map(b => (
              <tr key={b.id} className="border-t hover:bg-gray-50">
                <td className="px-6 py-4"><div className="flex items-center gap-3"><img src={b.image} alt="" className="w-12 h-8 rounded object-cover" /><div><p className="font-medium text-sm">{b.title}</p><p className="text-xs text-gray-400 truncate max-w-[200px]">{b.excerpt}</p></div></div></td>
                <td className="px-6 py-4 text-sm text-gray-600">{b.authorName}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{new Date(b.date).toLocaleDateString()}</td>
                <td className="px-6 py-4"><select value={b.status} onChange={e => updateStatus(b.id, e.target.value as BlogPost['status'])} className={`text-xs font-semibold px-3 py-1.5 rounded-full border-0 cursor-pointer ${statusColor[b.status]}`}><option value="published">Published</option><option value="pending">Pending</option><option value="draft">Draft</option></select></td>
                <td className="px-6 py-4 flex gap-1">
                  <Link to={`/blog/${b.slug}`} className="p-2 hover:bg-luxe-gold-soft rounded text-luxe-gold"><Eye size={16} /></Link>
                  <button onClick={() => setDelId(b.id)} className="p-2 hover:bg-red-50 rounded text-red-500"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border p-12 text-center text-gray-500"><FileText size={48} className="mx-auto text-gray-200 mb-4" />No blog posts yet</div>
      )}

      <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete Post">
        <p className="text-gray-600 mb-6">Delete this blog post permanently?</p>
        <div className="flex gap-3"><button onClick={del} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">Delete</button><button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button></div>
      </Modal>
    </div>
  );
}

// ADMIN PANEL - FULL WORKING SYSTEM
// ============================================================================
function AdminLayout({ children }: { children: ReactNode }) {
  const { user, isAdmin, ready, signOut } = useAuthStore();
  const nav = useNavigate();
  const loc = useLocation();
  const [mobSide, setMobSide] = useState(false);

  // Admin access is derived from the verified Supabase JWT (app_metadata.role
  // = 'admin'), never from a browser-supplied flag. Redirect until hydrated.
  useEffect(() => { if (ready && (!user || !isAdmin)) nav('/admin/login'); }, [user, isAdmin, ready, nav]);
  useEffect(() => { setMobSide(false); }, [loc.pathname]);
  if (!ready || !user || !isAdmin) return null;

  const links = [
    { to: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/admin/products', icon: Package, label: 'Products' },
    { to: '/admin/orders', icon: ShoppingCart, label: 'Orders' },
    { to: '/admin/users', icon: UsersIcon, label: 'Users' },
    { to: '/admin/categories', icon: FolderTree, label: 'Categories' },
    { to: '/admin/reviews', icon: Star, label: 'Reviews' },
    { to: '/admin/blogs', icon: FileText, label: 'Blog Posts' },
    { to: '/admin/seo-engine', icon: Search, label: 'SEO Engine ⭐' },
    { to: '/admin/marketing', icon: Megaphone, label: 'Marketing Gen ⭐' },
    { to: '/admin/marketing-traffic', icon: TrendingUp, label: 'Marketing & Traffic' },
    { to: '/admin/variant-gen', icon: Layers, label: 'Variant Gen ⭐' },
    { to: '/admin/ai', icon: Bot, label: 'AI Hub ⭐' },
    { to: '/admin/ai-import', icon: Bot, label: 'AI Import ⭐' },
    { to: '/admin/scout', icon: Target, label: 'Product Scout ⭐' },
    { to: '/admin/ai-control', icon: Cpu, label: 'AI Control ⭐' },
    { to: '/admin/settings', icon: Settings, label: 'Settings' },
  ];

  const Sidebar = ({ mobile }: { mobile?: boolean }) => (
    <aside className={`flex flex-col ${mobile ? 'w-full h-full' : 'w-52 min-h-screen hidden lg:flex'}`}
      style={{ background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}>
      <div className="p-3 border-b border-white/5 flex items-center gap-2">
        <div className="w-7 h-7 rounded-md flex items-center justify-center font-bold text-[10px]"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}>
          <Shield size={14} className="text-white" />
        </div>
        <span className="font-bold text-sm text-white tracking-tight">Luxedge</span>
        {mobile && <button onClick={() => setMobSide(false)} className="ml-auto p-1 hover:bg-white/10 rounded-md"><X size={14} className="text-slate-400" /></button>}
      </div>
      <nav className="flex-1 p-1.5 space-y-0.5 overflow-y-auto">
        {links.map(l => {
          const isActive = loc.pathname === l.to;
          return (
            <Link key={l.to} to={l.to}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 group relative ${
                isActive ? 'text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}>
              {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full" style={{ background: 'linear-gradient(180deg, #3b82f6, #8b5cf6)' }} />}
              <l.icon size={14} className={isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'} />
              {l.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-1.5 border-t border-white/5 space-y-0.5">
        <Link to="/" className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-white/5 transition-colors">
          <ArrowLeft size={10} />Store
        </Link>
        <button onClick={() => { void signOut().then(() => nav('/admin/login')); }}
          className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 px-2.5 py-1 rounded-md hover:bg-red-500/10 w-full transition-colors">
          <LogOut size={10} />Logout
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-gray-100 flex">
      <Sidebar />
      {mobSide && <div className="fixed inset-0 z-50 lg:hidden"><div className="absolute inset-0 bg-black/50" onClick={() => setMobSide(false)} /><div className="absolute left-0 top-0 h-full w-64"><Sidebar mobile /></div></div>}
      <div className="flex-1 flex flex-col">
        <header className="h-14 bg-white/80 backdrop-blur-md border-b border-gray-100 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-40">
          <button onClick={() => setMobSide(true)} className="lg:hidden p-1.5 hover:bg-gray-100 rounded-lg"><Menu size={18} /></button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 hidden sm:block">{user?.name || 'Admin'}</span>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}>A</div>
          </div>
        </header>
        <main className="flex-1 p-3 lg:p-5" style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)' }}>{children}</main>
      </div>
    </div>
  );
}

function ADashboard() {
  const { products, orders, users, reviews } = useApp();
  const rev = orders.reduce((s, o) => s + o.total, 0);
  const pending = orders.filter(o => o.status === 'Pending').length;
  const pendingR = reviews.filter(r => r.status === 'pending').length;
  const lowStock = products.filter(p => p.stock <= 10).length;

  const stats = [
    { l: 'Revenue', v: `$${rev.toLocaleString(undefined, {minimumFractionDigits:2})}`, i: DollarSign, c1: '#10b981', c2: '#059669', bg: 'from-emerald-500 to-teal-600' },
    { l: 'Orders', v: orders.length, i: ShoppingCart, c1: '#3b82f6', c2: '#2563eb', bg: 'from-blue-500 to-indigo-600' },
    { l: 'Customers', v: users.length, i: UsersIcon, c1: '#8b5cf6', c2: '#7c3aed', bg: 'from-violet-500 to-purple-600' },
    { l: 'Products', v: products.length, i: Package, c1: '#0088ff', c2: '#00d2ff', bg: 'from-blue-500 to-cyan-400' },
  ];

  return <div className="space-y-3.5">
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-lg font-bold text-gray-900 tracking-tight">Dashboard</h1>
        <p className="text-[11px] text-gray-500">Welcome back! Here's what's happening.</p>
      </div>
      <Link to="/admin/ai-import" className="px-3 py-2 rounded-lg text-[11px] font-semibold text-white flex items-center gap-1.5 shadow-lg shadow-purple-200 transition-all hover:scale-[1.03]"
        style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)' }}>
        <Wand2 size={12} /> AI Import
      </Link>
    </div>

    {/* Stats Grid */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
      {stats.map((s, i) => (
        <div key={i} className="card-lift bg-white rounded-xl p-3.5 border border-gray-100 overflow-hidden relative">
          <div className="absolute top-0 right-0 w-16 h-16 -translate-y-1/2 translate-x-1/2 rounded-full opacity-10" style={{ background: `linear-gradient(135deg, ${s.c1}, ${s.c2})` }} />
          <div className="flex items-center justify-between mb-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br ${s.bg} shadow-md`}>
              <s.i size={14} className="text-white" />
            </div>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5" style={{ color: s.c1, backgroundColor: `${s.c1}15` }}>
              <TrendingUp size={9} /> +12%
            </span>
          </div>
          <p className="text-lg font-bold text-gray-900 leading-none">{s.v}</p>
          <p className="text-[10px] text-gray-500 font-medium mt-1">{s.l}</p>
          <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, ${s.c1}55, ${s.c2}55)` }} />
        </div>
      ))}
    </div>

    {/* Alerts + Quick Tools Row */}
    <div className="grid lg:grid-cols-3 gap-2.5">
      <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {[
          { on: lowStock > 0, grad: 'from-sky-50 to-orange-50', b: 'border-sky-100', i: AlertTriangle, ic: 'bg-sky-100', tc: 'text-blue-600', n: lowStock, l: 'Low stock items', t: 'text-blue-800', s: 'text-blue-700', to: '/admin/products' },
          { on: pending > 0, grad: 'from-blue-50 to-indigo-50', b: 'border-blue-100', i: ShoppingCart, ic: 'bg-blue-100', tc: 'text-blue-600', n: pending, l: 'Pending orders', t: 'text-blue-800', s: 'text-blue-700', to: '/admin/orders' },
          { on: pendingR > 0, grad: 'from-purple-50 to-pink-50', b: 'border-purple-100', i: Star, ic: 'bg-purple-100', tc: 'text-purple-600', n: pendingR, l: 'Reviews pending', t: 'text-purple-800', s: 'text-purple-700', to: '/admin/reviews' },
        ].map((a, idx) => a.on ? (
          <Link key={idx} to={a.to} className={`bg-gradient-to-br ${a.grad} border ${a.b} rounded-xl p-3 card-lift group`}>
            <div className="flex items-center gap-2 mb-1.5"><div className={`w-7 h-7 ${a.ic} rounded-lg flex items-center justify-center`}><a.i size={13} className={a.tc} /></div><span className={`font-bold ${a.t}`}>{a.n}</span></div>
            <p className={`text-[11px] ${a.s} font-medium leading-tight`}>{a.l}</p>
            <p className={`text-[9px] font-semibold ${a.s} opacity-70 group-hover:opacity-100 flex items-center gap-0.5 mt-1 transition-opacity`}>View <ArrowRight size={9} /></p>
          </Link>
        ) : <div key={idx} className="hidden" />)}
      </div>

      {/* Quick AI Tools */}
      <div className="bg-white rounded-xl border border-gray-100 p-3 card-lift">
        <h3 className="font-bold text-[11px] text-gray-800 mb-2 flex items-center gap-1.5"><Zap size={11} className="text-blue-500" />Quick AI Tools</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { to: '/admin/ai-import', icon: Wand2, label: 'Import Product', color: '#8b5cf6' },
            { to: '/admin/marketing', icon: Megaphone, label: 'Generate Content', color: '#3b82f6' },
            { to: '/admin/variant-gen', icon: Layers, label: 'Create Variants', color: '#0088ff' },
            { to: '/admin/seo-engine', icon: Search, label: 'SEO Optimize', color: '#10b981' },
          ].map(t => (
            <Link key={t.to} to={t.to}
              className="flex flex-col items-start gap-1.5 px-2.5 py-2 rounded-lg text-[10px] font-medium hover:bg-gray-50 transition-all group">
              <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: `${t.color}15` }}>
                <t.icon size={11} style={{ color: t.color }} />
              </div>
              <span className="text-gray-700 group-hover:text-gray-900 leading-tight">{t.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>

    {/* Recent Orders */}
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden card-lift">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50">
        <h2 className="font-bold text-xs text-gray-800">Recent Orders</h2>
        <Link to="/admin/orders" className="text-[10px] font-semibold text-blue-600 hover:text-blue-800">View All →</Link>
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-gray-400 border-b border-gray-50">
            <th className="px-4 py-2 font-semibold">Order</th>
            <th className="px-2 py-2 font-semibold hidden sm:table-cell">Customer</th>
            <th className="px-2 py-2 font-semibold hidden md:table-cell">Date</th>
            <th className="px-2 py-2 font-semibold text-right">Total</th>
            <th className="px-4 py-2 font-semibold text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.slice(0,5).map(o => (
            <tr key={o.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70 transition-colors">
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold ${
                    o.status === 'Delivered' ? 'bg-green-100 text-green-700' :
                    o.status === 'Shipped' ? 'bg-blue-100 text-blue-700' :
                    o.status === 'Processing' ? 'bg-sky-100 text-blue-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>#{String(orders.indexOf(o)+1).padStart(2,'0')}</div>
                  <span className="font-semibold text-[11px] text-gray-900">{o.id}</span>
                </div>
              </td>
              <td className="px-2 py-2 text-[11px] text-gray-600 hidden sm:table-cell">{o.userName}</td>
              <td className="px-2 py-2 text-[11px] text-gray-500 hidden md:table-cell">{o.date.slice(0,10)}</td>
              <td className="px-2 py-2 text-[11px] font-bold text-gray-900 text-right">${o.total.toFixed(2)}</td>
              <td className="px-4 py-2 text-right">
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${
                  o.status === 'Delivered' ? 'bg-green-100 text-green-700' :
                  o.status === 'Shipped' ? 'bg-blue-100 text-blue-700' :
                  o.status === 'Processing' ? 'bg-sky-100 text-blue-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{o.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>;
}

function AProducts() {
  const { products, setProducts, notify } = useApp();
  const nav = useNavigate();
  const [delId, setDelId] = useState<string | null>(null);
  const toggle = (id: string) => { setProducts(p => p.map(x => x.id === id ? { ...x, isActive: !x.isActive } : x)); notify('Status updated!'); };
  const del = () => { if (delId) { setProducts(p => p.filter(x => x.id !== delId)); notify('Deleted!'); setDelId(null); } };

  return <div className="space-y-6">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Products</h1><button onClick={() => nav('/admin/products/new')} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg flex items-center gap-2"><Plus size={16} />Add Product</button></div>
    <div className="bg-white rounded-xl shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="w-full">
      <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase"><tr><th className="px-6 py-4">Product</th><th className="px-6 py-4">Brand</th><th className="px-6 py-4">Category</th><th className="px-6 py-4">Price</th><th className="px-6 py-4">Stock</th><th className="px-6 py-4">Variants</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Actions</th></tr></thead>
      <tbody>{products.map(p => <tr key={p.id} className="border-t hover:bg-gray-50">
        <td className="px-6 py-4"><div className="flex items-center gap-3"><img src={p.images[0]} alt="" className="w-10 h-10 rounded object-cover" /><div><span className="font-medium text-sm block">{p.name}</span>{p.shortDesc && <span className="text-xs text-gray-400">{p.shortDesc}</span>}</div></div></td>
        <td className="px-6 py-4 text-xs text-gray-500">{p.brand}</td>
        <td className="px-6 py-4 text-sm">{p.category}</td>
        <td className="px-6 py-4"><span className="font-semibold">${p.price}</span>{p.originalPrice > p.price && <span className="text-xs text-gray-400 line-through ml-1">${p.originalPrice}</span>}</td>
        <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${p.stock <= 10 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>{p.stock}</span></td>
        <td className="px-6 py-4 text-sm">{p.variants.length > 0 ? <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-medium">{p.variants.length}</span> : <span className="text-gray-400 text-xs">—</span>}</td>
        <td className="px-6 py-4"><button onClick={() => toggle(p.id)}>{p.isActive ? <ToggleRight size={22} className="text-green-500" /> : <ToggleLeft size={22} className="text-gray-400" />}</button></td>
        <td className="px-6 py-4 flex gap-1"><button onClick={() => nav(`/admin/products/edit/${p.id}`)} className="p-2 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={16} /></button><button onClick={() => setDelId(p.id)} className="p-2 hover:bg-red-50 rounded text-red-500"><Trash2 size={16} /></button></td>
      </tr>)}</tbody>
    </table></div></div>
    <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete Product"><p className="text-gray-600 mb-6">Delete this product permanently?</p><div className="flex gap-3"><button onClick={del} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">Delete</button><button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button></div></Modal>
  </div>;
}

// ============================================================================
// ADVANCED PRODUCT EDITOR (eBay-style)
// ============================================================================
const EMPTY_PRODUCT: Product = { id:'',name:'',shortDesc:'',description:'',price:0,originalPrice:0,category:'Dog Supplies',stock:0,images:[],rating:0,reviews:0,isActive:true,brand:'',condition:'New',tags:[],weight:'',dimensions:'',origin:'China',freeShipping:true,shippingCost:'0',variants:[] };

function AProductEdit() {
  const { id: paramId } = useParams<{ id: string }>();
  const isNew = !paramId;
  const { products, setProducts, notify } = useApp();
  const nav = useNavigate();

  const existing = paramId ? products.find(p => p.id === paramId) : null;
  const [p, setP] = useState<Product>(existing ? { ...existing } : { ...EMPTY_PRODUCT, id: `p${Date.now()}` });
  const [tab, setTab] = useState('basic');
  const [tagInput, setTagInput] = useState('');

  // Image upload
  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return;
    Array.from(files).slice(0, 5 - p.images.length).forEach(f => {
      if (!f.type.startsWith('image/') || f.size > 5*1024*1024) return;
      const r = new FileReader();
      r.onload = ev => { const res = ev.target?.result as string; if (res) setP(prev => ({ ...prev, images: prev.images.length < 5 ? [...prev.images, res] : prev.images })); };
      r.readAsDataURL(f);
    });
    e.target.value = '';
  };
  const removeImg = (i: number) => setP(prev => ({ ...prev, images: prev.images.filter((_, idx) => idx !== i) }));
  const setMainImg = (i: number) => setP(prev => { const imgs = [...prev.images]; const [m] = imgs.splice(i, 1); return { ...prev, images: [m, ...imgs] }; });

  // Tags
  const addTag = () => { if (tagInput.trim() && !p.tags.includes(tagInput.trim())) { setP(prev => ({ ...prev, tags: [...prev.tags, tagInput.trim()] })); setTagInput(''); } };
  const removeTag = (t: string) => setP(prev => ({ ...prev, tags: prev.tags.filter(x => x !== t) }));

  // Variants
  const [vColor, setVColor] = useState(''); const [vSize, setVSize] = useState('');
  const addVariant = () => {
    if (!vColor && !vSize) { notify('Enter color or size'); return; }
    setP(prev => ({ ...prev, variants: [...prev.variants, { id: `v${Date.now()}`, color: vColor, size: vSize, price: prev.price, salePrice: prev.price, stock: 0, sku: '' }] }));
    setVColor(''); setVSize('');
  };
  const updateVariant = (vid: string, updates: Partial<ProductVariant>) => { setP(prev => ({ ...prev, variants: prev.variants.map(v => v.id === vid ? { ...v, ...updates } : v) })); };
  const removeVariant = (vid: string) => setP(prev => ({ ...prev, variants: prev.variants.filter(v => v.id !== vid) }));

  // Auto-generate variants
  const [genColors, setGenColors] = useState('');
  const [genSizes, setGenSizes] = useState('');
  const autoGenerate = () => {
    const colors = genColors.split(',').map(s => s.trim()).filter(Boolean);
    const sizes = genSizes.split(',').map(s => s.trim()).filter(Boolean);
    if (colors.length === 0 && sizes.length === 0) { notify('Enter colors or sizes'); return; }
    const newVars: ProductVariant[] = [];
    if (colors.length > 0 && sizes.length > 0) {
      colors.forEach(c => sizes.forEach(s => newVars.push({ id: `v${Date.now()}${Math.random()}`, color: c, size: s, price: p.price, salePrice: p.price, stock: 0, sku: '' })));
    } else if (colors.length > 0) {
      colors.forEach(c => newVars.push({ id: `v${Date.now()}${Math.random()}`, color: c, size: 'One Size', price: p.price, salePrice: p.price, stock: 0, sku: '' }));
    } else {
      sizes.forEach(s => newVars.push({ id: `v${Date.now()}${Math.random()}`, color: 'Default', size: s, price: p.price, salePrice: p.price, stock: 0, sku: '' }));
    }
    setP(prev => ({ ...prev, variants: [...prev.variants, ...newVars] }));
    setGenColors(''); setGenSizes('');
    notify(`${newVars.length} variants created!`);
  };

  // Save
  const handleSave = () => {
    if (!p.name) { notify('Product name required'); return; }
    if (p.images.length === 0) { notify('At least 1 image required'); return; }
    if (p.price <= 0) { notify('Price must be greater than 0'); return; }
    const totalVarStock = p.variants.reduce((s, v) => s + v.stock, 0);
    const finalProduct = { ...p, stock: p.variants.length > 0 ? totalVarStock : p.stock };
    if (isNew) {
      setProducts(prev => [...prev, finalProduct]);
      notify('Product created!');
    } else {
      setProducts(prev => prev.map(x => x.id === p.id ? finalProduct : x));
      notify('Product saved!');
    }
    nav('/admin/products');
  };

  const discount = p.originalPrice > 0 && p.price > 0 ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;
  const I = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';
  const L = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
  const tabs = ['basic','pricing','images','variants','details','shipping'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/admin/products')} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
          <div><h1 className="text-2xl font-bold">{isNew ? 'Add New Product' : 'Edit Product'}</h1><p className="text-sm text-gray-500">{isNew ? 'Create a new product listing' : p.name}</p></div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => nav('/admin/products')} className="px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2"><Save size={16} />{isNew ? 'Create Product' : 'Save Changes'}</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="flex border-b overflow-x-auto">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-5 py-3 text-sm font-medium capitalize whitespace-nowrap border-b-2 transition-colors ${tab === t ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
              {t === 'basic' ? '📋 Basic Info' : t === 'pricing' ? '💰 Pricing' : t === 'images' ? '🖼️ Images' : t === 'variants' ? '🎨 Variants' : t === 'details' ? '📦 Details' : '🚚 Shipping'}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* BASIC INFO TAB */}
          {tab === 'basic' && (
            <div className="space-y-5 max-w-3xl">
              <div><label className={L}>Product Name *</label><input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} className={I} placeholder="e.g. Orthopedic Memory Foam Dog Bed" /></div>
              <div><label className={L}>Short Description</label><input value={p.shortDesc} onChange={e => setP({ ...p, shortDesc: e.target.value })} className={I} placeholder="Brief tagline for product cards" maxLength={100} /><p className="text-xs text-gray-400 mt-1">{p.shortDesc.length}/100</p></div>
              <div><label className={L}>Full Description *</label><textarea value={p.description} onChange={e => setP({ ...p, description: e.target.value })} className={I + ' resize-none'} rows={6} placeholder="Detailed product description. Use line breaks for formatting." /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={L}>Category *</label><select value={p.category} onChange={e => setP({ ...p, category: e.target.value })} className={I}>{CAT_LIST.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}</select></div>
                <div><label className={L}>Brand</label><input value={p.brand} onChange={e => setP({ ...p, brand: e.target.value })} className={I} placeholder="Brand name" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={L}>Condition</label><select value={p.condition} onChange={e => setP({ ...p, condition: e.target.value })} className={I}><option>New</option><option>Used</option><option>Refurbished</option><option>Open Box</option></select></div>
                <div className="flex items-end gap-3 pb-1"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={p.isActive} onChange={e => setP({ ...p, isActive: e.target.checked })} className="w-4 h-4 text-blue-500 rounded" /><span className="text-sm text-gray-700">Active (visible in store)</span></label></div>
              </div>
              <div>
                <label className={L}>Tags / Keywords</label>
                <div className="flex flex-wrap gap-2 mb-2">{p.tags.map(t => <span key={t} className="flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"><span>{t}</span><button type="button" onClick={() => removeTag(t)} className="text-gray-400 hover:text-red-500">×</button></span>)}</div>
                <div className="flex gap-2"><input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} className={I} placeholder="Type tag & press Enter" /><button type="button" onClick={addTag} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium">Add</button></div>
              </div>
            </div>
          )}

          {/* PRICING TAB */}
          {tab === 'pricing' && (
            <div className="space-y-5 max-w-3xl">
              <div className="grid grid-cols-2 gap-4">
                <div><label className={L}>Sale Price (USD) *</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span><input type="number" step="0.01" value={p.price || ''} onChange={e => setP({ ...p, price: +e.target.value })} className={I + ' pl-7'} placeholder="0.00" /></div></div>
                <div><label className={L}>Compare / Original Price</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span><input type="number" step="0.01" value={p.originalPrice || ''} onChange={e => setP({ ...p, originalPrice: +e.target.value })} className={I + ' pl-7'} placeholder="0.00" /></div></div>
              </div>
              {discount > 0 && <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl"><DollarSign size={20} className="text-green-600" /><div><p className="font-semibold text-green-700">Discount: {discount}% OFF</p><p className="text-sm text-green-600">Customer saves ${(p.originalPrice - p.price).toFixed(2)}</p></div></div>}
              <div><label className={L}>Global Stock (if no variants) *</label><input type="number" value={p.stock || ''} onChange={e => setP({ ...p, stock: +e.target.value })} className={I} placeholder="0" />{p.stock > 0 && p.stock <= 10 && <p className="text-xs text-blue-600 mt-1 flex items-center gap-1"><AlertTriangle size={12} />Low stock warning will appear</p>}</div>
            </div>
          )}

          {/* IMAGES TAB */}
          {tab === 'images' && (
            <div className="space-y-5 max-w-3xl">
              <p className="text-sm text-gray-500">Upload up to 5 images. First image is the main product image. Click to set as main.</p>
              {p.images.length > 0 && <div className="grid grid-cols-5 gap-4">{p.images.map((img, i) => (
                <div key={i} className="relative group aspect-square rounded-xl overflow-hidden border-2 border-gray-200 hover:border-blue-400 transition-all cursor-pointer" onClick={() => setMainImg(i)}>
                  <img src={img} alt="" className="w-full h-full object-cover" />
                  {i === 0 && <div className="absolute top-2 left-2 px-2 py-0.5 bg-blue-500 text-white text-[10px] font-bold rounded-full">MAIN</div>}
                  <button type="button" onClick={e => { e.stopPropagation(); removeImg(i); }} className="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600">✕</button>
                  {i !== 0 && <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all flex items-end justify-center pb-2"><span className="text-[10px] text-white bg-black/50 px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">Click = Main</span></div>}
                </div>
              ))}</div>}
              {p.images.length < 5 && (
                <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all">
                  <Upload size={28} className="text-gray-400 mb-2" />
                  <span className="text-sm font-medium text-gray-600">Click to upload from PC</span>
                  <span className="text-xs text-gray-400 mt-1">PNG, JPG, WebP · Max 5MB each · {5 - p.images.length} slot{5 - p.images.length !== 1 ? 's' : ''} remaining</span>
                  <input type="file" accept="image/*" multiple onChange={handleFiles} className="hidden" />
                </label>
              )}
              {p.images.length === 0 && <p className="text-xs text-red-500 flex items-center gap-1"><ImageIcon size={12} />At least 1 image is required</p>}
            </div>
          )}

          {/* VARIANTS TAB */}
          {tab === 'variants' && (
            <div className="space-y-6">
              {/* Auto-generate */}
              <div className="p-5 bg-blue-50 border border-blue-200 rounded-xl">
                <h3 className="font-semibold text-blue-800 mb-3 flex items-center gap-2"><Zap size={16} />Auto-Generate Combinations</h3>
                <p className="text-xs text-blue-600 mb-3">Enter comma-separated values. All combinations will be created automatically.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div><label className="text-xs font-medium text-blue-700 mb-1 block">Colors</label><input value={genColors} onChange={e => setGenColors(e.target.value)} className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white" placeholder="Black, White, Blue" /></div>
                  <div><label className="text-xs font-medium text-blue-700 mb-1 block">Sizes</label><input value={genSizes} onChange={e => setGenSizes(e.target.value)} className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white" placeholder="S, M, L, XL" /></div>
                </div>
                <button type="button" onClick={autoGenerate} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg font-medium flex items-center gap-2"><Zap size={14} />Generate Variants</button>
              </div>

              {/* Manual add */}
              <div className="p-5 bg-gray-50 border border-gray-200 rounded-xl">
                <h3 className="font-semibold text-gray-700 mb-3">Or Add Manually</h3>
                <div className="flex gap-3 items-end">
                  <div className="flex-1"><label className="text-xs font-medium text-gray-600 mb-1 block">Color</label><input value={vColor} onChange={e => setVColor(e.target.value)} className={I} placeholder="e.g. Black" /></div>
                  <div className="flex-1"><label className="text-xs font-medium text-gray-600 mb-1 block">Size</label><input value={vSize} onChange={e => setVSize(e.target.value)} className={I} placeholder="e.g. Large" /></div>
                  <button type="button" onClick={addVariant} className="px-4 py-2.5 bg-gray-800 hover:bg-gray-900 text-white text-sm rounded-lg font-medium flex items-center gap-2"><Plus size={14} />Add</button>
                </div>
              </div>

              {/* Variants table */}
              {p.variants.length > 0 && (
                <div className="border rounded-xl overflow-hidden">
                  <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between"><span className="font-semibold text-sm">{p.variants.length} Variant{p.variants.length !== 1 ? 's' : ''}</span><span className="text-xs text-gray-500">Total stock: {p.variants.reduce((s, v) => s + v.stock, 0)}</span></div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr><th className="px-4 py-3 text-left">Color</th><th className="px-4 py-3 text-left">Size</th><th className="px-4 py-3 text-left">Price</th><th className="px-4 py-3 text-left">Sale</th><th className="px-4 py-3 text-left">Stock</th><th className="px-4 py-3 text-left">SKU</th><th className="px-4 py-3"></th></tr></thead>
                      <tbody>{p.variants.map(v => (
                        <tr key={v.id} className="border-t">
                          <td className="px-4 py-2"><input value={v.color} onChange={e => updateVariant(v.id, { color: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input value={v.size} onChange={e => updateVariant(v.id, { size: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input type="number" step="0.01" value={v.price||''} onChange={e => updateVariant(v.id, { price: +e.target.value })} className="w-20 px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input type="number" step="0.01" value={v.salePrice||''} onChange={e => updateVariant(v.id, { salePrice: +e.target.value })} className="w-20 px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input type="number" value={v.stock||''} onChange={e => updateVariant(v.id, { stock: +e.target.value })} className="w-16 px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input value={v.sku} onChange={e => updateVariant(v.id, { sku: e.target.value })} className="w-24 px-2 py-1.5 border rounded text-sm" placeholder="SKU" /></td>
                          <td className="px-4 py-2"><button type="button" onClick={() => removeVariant(v.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 size={14} /></button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}
              {p.variants.length === 0 && <div className="text-center py-10 bg-gray-50 rounded-xl border border-dashed"><p className="text-gray-400 text-sm">No variants yet. Use auto-generate or add manually above.</p></div>}
            </div>
          )}

          {/* DETAILS TAB */}
          {tab === 'details' && (
            <div className="space-y-5 max-w-3xl">
              <div className="grid grid-cols-2 gap-4">
                <div><label className={L}>Weight</label><input value={p.weight} onChange={e => setP({ ...p, weight: e.target.value })} className={I} placeholder="e.g. 0.5 lbs" /></div>
                <div><label className={L}>Dimensions</label><input value={p.dimensions} onChange={e => setP({ ...p, dimensions: e.target.value })} className={I} placeholder="e.g. 6 × 4 × 2 in" /></div>
              </div>
              <div><label className={L}>Country of Origin</label><select value={p.origin} onChange={e => setP({ ...p, origin: e.target.value })} className={I}>{['China','USA','India','Japan','South Korea','Germany','Vietnam','Taiwan','UK','Italy','Other'].map(c => <option key={c}>{c}</option>)}</select></div>
            </div>
          )}

          {/* SHIPPING TAB */}
          {tab === 'shipping' && (
            <div className="space-y-5 max-w-3xl">
              <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border">
                <input type="checkbox" checked={p.freeShipping} onChange={e => setP({ ...p, freeShipping: e.target.checked, shippingCost: e.target.checked ? '0' : p.shippingCost })} className="w-5 h-5 text-blue-500 rounded" id="fship" />
                <label htmlFor="fship" className="cursor-pointer"><p className="font-semibold text-sm">Free Shipping</p><p className="text-xs text-gray-500">Offer free shipping on this product</p></label>
              </div>
              {!p.freeShipping && <div><label className={L}>Shipping Cost (USD)</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span><input type="number" step="0.01" value={p.shippingCost} onChange={e => setP({ ...p, shippingCost: e.target.value })} className={I + ' pl-7'} placeholder="4.99" /></div></div>}
              <div><label className={L}>Weight (for shipping calc)</label><input value={p.weight} onChange={e => setP({ ...p, weight: e.target.value })} className={I} placeholder="e.g. 0.5 lbs" /></div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Save Bar */}
      <div className="bg-white rounded-xl shadow-sm border p-4 flex items-center justify-between sticky bottom-0">
        <p className="text-sm text-gray-500">
          {p.images.length} image{p.images.length !== 1 ? 's' : ''} · {p.variants.length} variant{p.variants.length !== 1 ? 's' : ''} · {p.tags.length} tag{p.tags.length !== 1 ? 's' : ''}
        </p>
        <div className="flex gap-3">
          <button onClick={() => nav('/admin/products')} className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50">Discard</button>
          <button onClick={handleSave} className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2"><Save size={16} />{isNew ? 'Create Product' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

function AOrders() {
  const { orders, setOrders, notify } = useApp();
  const [view, setView] = useState<Order | null>(null);
  const statuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
  const statusColor: Record<string, string> = { Pending: 'bg-yellow-100 text-yellow-700', Processing: 'bg-blue-100 text-blue-700', Shipped: 'bg-purple-100 text-purple-700', Delivered: 'bg-green-100 text-green-700', Cancelled: 'bg-red-100 text-red-700' };
  const updateStatus = (id: string, status: string) => { setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o)); notify(`Order ${status}`); };

  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">Orders</h1>
    <div className="bg-white rounded-xl shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="w-full">
      <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase"><tr><th className="px-6 py-4">Order</th><th className="px-6 py-4">Customer</th><th className="px-6 py-4">Total</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Actions</th></tr></thead>
      <tbody>{orders.map(o => <tr key={o.id} className="border-t hover:bg-gray-50">
        <td className="px-6 py-4"><p className="font-medium text-sm">{o.id}</p><p className="text-xs text-gray-500">{new Date(o.date).toLocaleDateString()}</p></td>
        <td className="px-6 py-4 text-sm">{o.userName}</td>
        <td className="px-6 py-4 font-semibold">${o.total.toFixed(2)}</td>
        <td className="px-6 py-4"><select value={o.status} onChange={e => updateStatus(o.id, e.target.value)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border-0 cursor-pointer ${statusColor[o.status] || 'bg-gray-100'}`}>{statuses.map(s => <option key={s}>{s}</option>)}</select></td>
        <td className="px-6 py-4"><button onClick={() => setView(o)} className="p-2 hover:bg-blue-50 rounded text-blue-600"><Eye size={16} /></button></td>
      </tr>)}</tbody>
    </table></div></div>

    <Modal open={!!view} onClose={() => setView(null)} title={`Order ${view?.id}`}>
      {view && <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm"><div><p className="text-gray-500">Customer</p><p className="font-medium">{view.userName}</p></div><div><p className="text-gray-500">Status</p><p className="font-medium">{view.status}</p></div></div>
        {view.address && <div className="bg-gray-50 p-3 rounded-lg text-sm"><p className="text-gray-500 text-xs mb-1">Shipping Address</p><p>{view.address}</p></div>}
        <div className="space-y-2">{view.items.map(i => <div key={i.product.id} className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg"><img src={i.product.images[0]} alt="" className="w-12 h-12 rounded object-cover" /><div className="flex-1"><p className="font-medium text-sm">{i.product.name}</p><p className="text-xs text-gray-500">Qty: {i.quantity}</p></div><p className="font-semibold">${(i.product.price * i.quantity).toFixed(2)}</p></div>)}</div>
        <div className="pt-3 border-t flex justify-between font-bold"><span>Total</span><span>${view.total.toFixed(2)}</span></div>
      </div>}
    </Modal>
  </div>;
}

function AUsers() {
  const { users, setUsers, notify } = useApp();
  const [delId, setDelId] = useState<string | null>(null);
  const toggleBlock = (id: string) => { setUsers(prev => prev.map(u => u.id === id ? { ...u, isBlocked: !u.isBlocked } : u)); notify('User updated!'); };
  const del = () => { if (delId) { setUsers(prev => prev.filter(u => u.id !== delId)); notify('User deleted!'); setDelId(null); } };

  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">Users</h1>
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{users.map(u => <div key={u.id} className={`bg-white rounded-xl border p-5 ${u.isBlocked ? 'border-red-200 bg-red-50/30' : ''}`}>
      <div className="flex items-center gap-3 mb-4"><div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${u.isBlocked ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>{u.name[0]}</div><div><p className="font-semibold">{u.name}</p><p className="text-xs text-gray-500">{u.email}</p></div>{u.isBlocked && <span className="ml-auto text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full">Blocked</span>}</div>
      {u.joined && <p className="text-xs text-gray-400 mb-4">Joined: {u.joined}</p>}
      <div className="flex gap-2"><button onClick={() => toggleBlock(u.id)} className={`flex-1 py-2 rounded-lg text-xs font-medium ${u.isBlocked ? 'bg-green-50 text-green-600' : 'bg-sky-50 text-blue-600'}`}>{u.isBlocked ? 'Unblock' : 'Block'}</button><button onClick={() => setDelId(u.id)} className="flex-1 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-medium">Delete</button></div>
    </div>)}</div>
    <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete User"><p className="text-gray-600 mb-6">Delete this user?</p><div className="flex gap-3"><button onClick={del} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">Delete</button><button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button></div></Modal>
  </div>;
}

function ACategories() {
  const { categories, setCategories, notify } = useApp();
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState<AdminCategory | null>(null);
  const [form, setForm] = useState({ name: '', isActive: true, parentId: '' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [delId, setDelId] = useState<string | null>(null);
  const [subModal, setSubModal] = useState<string | null>(null);
  const [subName, setSubName] = useState('');

  const toggle = (id: string) => { const n = new Set(expanded); n.has(id) ? n.delete(id) : n.add(id); setExpanded(n); };
  const openAdd = () => { setEdit(null); setForm({ name: '', isActive: true, parentId: '' }); setModal(true); };
  const openEdit = (c: AdminCategory) => { setEdit(c); setForm({ name: c.name, isActive: c.isActive, parentId: '' }); setModal(true); };
  const save = (e: React.FormEvent) => { e.preventDefault(); if (edit) { setCategories(prev => prev.map(c => c.id === edit.id ? { ...c, name: form.name, isActive: form.isActive } : c)); notify('Category updated!'); } else { setCategories(prev => [...prev, { id: `c${Date.now()}`, name: form.name, isActive: form.isActive, subs: [] }]); notify('Category added!'); } setModal(false); };
  const del = () => { if (delId) { setCategories(prev => prev.filter(c => c.id !== delId)); notify('Category deleted!'); setDelId(null); } };
  const toggleStatus = (id: string) => { setCategories(prev => prev.map(c => c.id === id ? { ...c, isActive: !c.isActive } : c)); notify('Status updated!'); };
  const addSub = (e: React.FormEvent) => { e.preventDefault(); if (subModal && subName) { setCategories(prev => prev.map(c => c.id === subModal ? { ...c, subs: [...c.subs, { id: `s${Date.now()}`, name: subName, isActive: true }] } : c)); setSubName(''); setSubModal(null); notify('Subcategory added!'); } };
  const delSub = (catId: string, subId: string) => { setCategories(prev => prev.map(c => c.id === catId ? { ...c, subs: c.subs.filter(s => s.id !== subId) } : c)); notify('Subcategory deleted!'); };
  const toggleSub = (catId: string, subId: string) => { setCategories(prev => prev.map(c => c.id === catId ? { ...c, subs: c.subs.map(s => s.id === subId ? { ...s, isActive: !s.isActive } : s) } : c)); notify('Updated!'); };

  return <div className="space-y-6">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Categories</h1><button onClick={openAdd} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg flex items-center gap-2"><Plus size={16} />Add Category</button></div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div className="bg-white rounded-xl border p-4"><p className="text-2xl font-bold">{categories.length}</p><p className="text-sm text-gray-500">Main Categories</p></div>
      <div className="bg-white rounded-xl border p-4"><p className="text-2xl font-bold">{categories.reduce((s, c) => s + c.subs.length, 0)}</p><p className="text-sm text-gray-500">Subcategories</p></div>
      <div className="bg-white rounded-xl border p-4"><p className="text-2xl font-bold text-green-600">{categories.filter(c => c.isActive).length}</p><p className="text-sm text-gray-500">Active</p></div>
      <div className="bg-white rounded-xl border p-4"><p className="text-2xl font-bold text-gray-400">{categories.filter(c => !c.isActive).length}</p><p className="text-sm text-gray-500">Inactive</p></div>
    </div>
    <div className="bg-white rounded-xl shadow-sm">
      {categories.map(c => <div key={c.id}>
        <div className="flex items-center gap-3 p-4 border-b hover:bg-gray-50">
          <button onClick={() => toggle(c.id)} className="p-1">{c.subs.length > 0 ? (expanded.has(c.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} className="text-gray-400" />) : <span className="w-4" />}</button>
          <FolderTree size={18} className={c.isActive ? 'text-blue-500' : 'text-gray-400'} />
          <div className="flex-1"><p className={`font-medium ${c.isActive ? '' : 'text-gray-400'}`}>{c.name}</p>{c.subs.length > 0 && <p className="text-xs text-gray-500">{c.subs.length} sub</p>}</div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.isActive ? 'Active' : 'Inactive'}</span>
          <button onClick={() => setSubModal(c.id)} className="p-2 hover:bg-blue-50 rounded text-blue-600" title="Add Sub"><Plus size={16} /></button>
          <button onClick={() => toggleStatus(c.id)} className="p-2 hover:bg-gray-100 rounded">{c.isActive ? <ToggleRight size={20} className="text-green-500" /> : <ToggleLeft size={20} className="text-gray-400" />}</button>
          <button onClick={() => openEdit(c)} className="p-2 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={16} /></button>
          <button onClick={() => setDelId(c.id)} className="p-2 hover:bg-red-50 rounded text-red-500"><Trash2 size={16} /></button>
        </div>
        {expanded.has(c.id) && c.subs.map(s => <div key={s.id} className="flex items-center gap-3 p-3 pl-14 border-b bg-gray-50/50">
          <span className="text-gray-400">└</span><p className={`flex-1 text-sm ${s.isActive ? '' : 'text-gray-400'}`}>{s.name}</p>
          <button onClick={() => toggleSub(c.id, s.id)} className="p-1">{s.isActive ? <ToggleRight size={18} className="text-green-500" /> : <ToggleLeft size={18} className="text-gray-400" />}</button>
          <button onClick={() => delSub(c.id, s.id)} className="p-1 text-red-500"><Trash2 size={14} /></button>
        </div>)}
      </div>)}
    </div>
    <Modal open={modal} onClose={() => setModal(false)} title={edit ? 'Edit Category' : 'Add Category'}>
      <form onSubmit={save} className="space-y-4"><input required placeholder="Category Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2.5 border rounded-lg" /><label className="flex items-center gap-2"><input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />Active</label><div className="flex gap-3"><button type="submit" className="flex-1 py-2.5 bg-blue-500 text-white rounded-lg font-medium">{edit ? 'Save' : 'Add'}</button><button type="button" onClick={() => setModal(false)} className="px-6 py-2.5 border rounded-lg">Cancel</button></div></form>
    </Modal>
    <Modal open={!!subModal} onClose={() => setSubModal(null)} title="Add Subcategory">
      <form onSubmit={addSub} className="space-y-4"><input required placeholder="Subcategory Name" value={subName} onChange={e => setSubName(e.target.value)} className="w-full px-4 py-2.5 border rounded-lg" /><div className="flex gap-3"><button type="submit" className="flex-1 py-2.5 bg-blue-500 text-white rounded-lg font-medium">Add</button><button type="button" onClick={() => setSubModal(null)} className="px-6 py-2.5 border rounded-lg">Cancel</button></div></form>
    </Modal>
    <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete Category"><p className="text-gray-600 mb-6">Delete this category and all subcategories?</p><div className="flex gap-3"><button onClick={del} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg">Delete</button><button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button></div></Modal>
  </div>;
}

function AReviews() {
  const { reviews, setReviews, notify } = useApp();
  const approve = (id: string) => { setReviews(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r)); notify('Review approved!'); };
  const reject = (id: string) => { setReviews(prev => prev.map(r => r.id === id ? { ...r, status: 'rejected' } : r)); notify('Review rejected!'); };
  const del = (id: string) => { setReviews(prev => prev.filter(r => r.id !== id)); notify('Review deleted!'); };
  const sColor: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' };

  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">Reviews</h1>
    {reviews.length === 0 ? <div className="bg-white rounded-xl border p-12 text-center text-gray-500">No reviews yet</div> :
    <div className="space-y-4">{reviews.map(r => <div key={r.id} className={`bg-white rounded-xl border p-5 ${r.status === 'pending' ? 'border-yellow-200' : ''}`}>
      <div className="flex items-start justify-between mb-3"><div><p className="font-semibold">{r.userName}</p><p className="text-xs text-gray-500">on <span className="text-blue-600">{r.productName}</span></p></div><span className={`text-xs px-3 py-1 rounded-full font-medium capitalize ${sColor[r.status]}`}>{r.status}</span></div>
      <div className="flex gap-0.5 mb-2">{[...Array(5)].map((_, i) => <Star key={i} size={14} className={i < r.rating ? 'text-sky-400 fill-sky-400' : 'text-gray-200'} />)}</div>
      <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg mb-4">{r.comment}</p>
      <div className="flex gap-2">{r.status === 'pending' && <><button onClick={() => approve(r.id)} className="px-4 py-2 bg-green-50 text-green-600 rounded-lg text-sm font-medium hover:bg-green-100">✓ Approve</button><button onClick={() => reject(r.id)} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100">✕ Reject</button></>}<button onClick={() => del(r.id)} className="px-4 py-2 bg-gray-50 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-100 ml-auto">Delete</button></div>
    </div>)}</div>}
  </div>;
}

// Defined at MODULE scope (not inside ASettings). Previously these lived inside
// the component, so every keystroke recreated them as brand-new component types —
// React then unmounted/remounted each input and stole focus after every character,
// which made it feel like the API keys "wouldn't save".
const SETTINGS_INPUT = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';
const SETTINGS_LABEL = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';

// NOTE: Secret-field inputs (scrape.do, OpenAI, Supabase, Stripe, Google keys)
// were removed in Luxedge V2. Keys now live server-side only (see .env.example
// and /api/ai/*). Public config (Supabase URL/anon key, Stripe publishable key,
// Google OAuth client id) belongs in src/store/settingsStore.ts.

function Accordion({ id, title, icon, borderClass, children, open, toggle }: {
  id: string; title: string; icon: React.ReactNode; borderClass?: string; children: React.ReactNode;
  open: Record<string, boolean>; toggle: (k: string) => void;
}) {
  return (
    <div className={`bg-white rounded-xl border ${borderClass || ''}`}>
      <button type="button" onClick={() => toggle(id)} className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 rounded-xl transition-colors">
        <span className="font-semibold flex items-center gap-2">{icon}{title}</span>
        {open[id] ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>
      {open[id] && <div className="px-5 pb-6 border-t border-gray-100">{children}</div>}
    </div>
  );
}

function ASettings() {
  const { user, changePassword, updateAdminProfile, notify } = useApp();
  const navigate = useNavigate();
  const L = SETTINGS_LABEL;
  const I = SETTINGS_INPUT;

    const [envStatus, setEnvStatus] = useState<ProviderStatusMap | null>(null);
  useEffect(() => {
    serverProviderStatus().then(setEnvStatus).catch(() => setEnvStatus({ backend: 'missing', providers: [] }));
  }, []);

const [open, setOpen] = useState<Record<string, boolean>>({ api: true, store: false, profile: false, password: false });
  const toggle = (k: string) => setOpen(s => ({ ...s, [k]: !s[k] }));

  const [profName, setProfName] = useState(user?.name || '');
  const [profEmail, setProfEmail] = useState(user?.email || '');

  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confPass, setConfPass] = useState('');
  const [passError, setPassError] = useState('');
  const [passOk, setPassOk] = useState(false);

  const handleProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profName.trim() || !profEmail.trim()) { notify('Name and email required'); return; }
    await updateAdminProfile(profName.trim(), profEmail.trim());
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError(''); setPassOk(false);
    if (newPass !== confPass) { setPassError('New passwords do not match'); return; }
    if (newPass.length < 6) { setPassError('Password must be at least 6 characters'); return; }
    if (curPass === newPass) { setPassError('New password must differ from current'); return; }
    const result = await changePassword(curPass, newPass);
    if (result.ok) {
      setPassOk(true);
      setCurPass(''); setNewPass(''); setConfPass('');
      notify(result.msg);
      setTimeout(() => setPassOk(false), 5000);
    } else { setPassError(result.msg); }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* ── AI Providers ── */}
      <Accordion id="ai" title="AI Providers" icon={<Bot size={18} className="text-purple-600" />} borderClass="border-purple-300" open={open} toggle={toggle}>
        <div className="pt-5 space-y-4">
          <p className="text-sm text-gray-500">For full AI provider management including API keys, model selection, credit tracking, and connection testing, visit the dedicated AI Hub.</p>
          <button type="button" onClick={() => navigate('/admin/ai')}
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <Bot size={16} /> Open AI Hub →
          </button>
        </div>
      </Accordion>

      {/* ── API Keys ── */}
      <Accordion id="api" title="API Keys — Server-Side" icon={<Globe size={18} className="text-green-600" />} borderClass="border-green-300" open={open} toggle={toggle}>
        <div className="pt-5 space-y-4">
          <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-800">
            <p className="font-semibold mb-1">🔒 Luxedge V2: keys live on the server, never in the browser</p>
            <p>AI provider keys and scraping tokens are read from environment variables by the /api serverless functions. They are never stored in localStorage, never shipped in the bundle, and never logged.</p>
          </div>
          <p className="text-sm text-gray-500">Set these env vars in your hosting dashboard (Vercel → Project → Settings → Environment Variables) and redeploy. Variable names: <code className="font-mono text-xs">OPENAI_API_KEY, DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, SCRAPE_DO_TOKEN</code> — see <code className="font-mono text-xs">.env.example</code>.</p>
          {envStatus ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Server status</p>
              {envStatus.providers.map(p => (
                <div key={p.id} className={"flex items-center justify-between p-3 rounded-xl border " + (p.configured ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50')}>
                  <span className="text-sm font-medium text-gray-700">{p.name}</span>
                  <span className={"text-xs font-semibold " + (p.configured ? 'text-green-700' : 'text-amber-700')}>
                    {p.configured ? '✓ Configured on server' : 'Not configured'}
                  </span>
                </div>
              ))}
              {!envStatus.providers.length && <p className="text-xs text-gray-400">No providers reported by server.</p>}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Checking server configuration… (requires the /api functions deployed)</p>
          )}
        </div>
      </Accordion>

      {/* ── Store Information ── */}
      <Accordion id="store" title="Store Information" icon={<Settings size={18} className="text-blue-500" />} open={open} toggle={toggle}>
        <div className="pt-5">
          <form onSubmit={e => { e.preventDefault(); notify('Store settings saved!'); }} className="grid sm:grid-cols-2 gap-4">
            <div><label className={L}>Store Name</label><input defaultValue="Luxedge" className={I} /></div>
            <div><label className={L}>Contact Email</label><input defaultValue="hello@luxedge.us" className={I} /></div>
            <div><label className={L}>Phone</label><input defaultValue="(440) 941-8002" className={I} /></div>
            <div><label className={L}>Address</label><input defaultValue="Irving, TX" className={I} /></div>
            <div className="sm:col-span-2">
              <button type="submit" className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors">
                <Save size={16} />Save Store Settings
              </button>
            </div>
          </form>
        </div>
      </Accordion>

      {/* ── Admin Profile ── */}
      <Accordion id="profile" title="Admin Profile" icon={<UserIcon size={18} className="text-blue-500" />} open={open} toggle={toggle}>
        <div className="pt-5">
          <form onSubmit={handleProfile} className="space-y-4">
            <div><label className={L}>Name</label><input value={profName} onChange={e => setProfName(e.target.value)} className={I} placeholder="Admin name" /></div>
            <div><label className={L}>Email</label><input type="email" value={profEmail} onChange={e => setProfEmail(e.target.value)} className={I} placeholder="admin email" /></div>
            <button type="submit" className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"><Save size={16} />Save Profile</button>
          </form>
        </div>
      </Accordion>

      {/* ── Change Password ── */}
      <Accordion id="password" title="Change Password" icon={<Lock size={18} className="text-blue-500" />} open={open} toggle={toggle}>
        <div className="pt-5">
          {passOk && <div className="flex items-center gap-2 p-3 mb-4 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm"><CheckCircle size={16} /> Password updated! Use your new password next login.</div>}
          {passError && <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertTriangle size={16} /> {passError}</div>}
          <form onSubmit={handlePassword} className="space-y-4">
            <div><label className={L}>Current Password *</label><input type="password" value={curPass} onChange={e => setCurPass(e.target.value)} className={I} placeholder="Enter current password" required /></div>
            <div><label className={L}>New Password *</label><input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} className={I} placeholder="Minimum 6 characters" required minLength={6} /></div>
            <div><label className={L}>Confirm New Password *</label><input type="password" value={confPass} onChange={e => setConfPass(e.target.value)} className={I} placeholder="Re-enter new password" required minLength={6} /></div>
            <button type="submit" className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"><Lock size={16} />Update Password</button>
          </form>
        </div>
      </Accordion>
    </div>
  );
}

// ============================================================================
// ENTERPRISE MARKETING GENERATOR
// ============================================================================
type MktTab = 'google'|'meta'|'social'|'email'|'video'|'vault';
type MktTone = 'luxury'|'urgent'|'friendly'|'professional';
const MKT_TONES: MktTone[] = ['luxury','urgent','friendly','professional'];

interface GoogleAd {
  headlines: string[];
  descriptions: string[];
  displayUrl: string;
  finalUrl: string;
  callouts: string[];
  sitelinks: { title: string; desc: string; url: string }[];
}
interface MetaAd {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  audience: string;
  interests: string[];
}
interface SocialPosts {
  instagram: string;
  hashtags: string[];
  facebook: string;
  twitter: string[];
  linkedin: string;
  pinterest: string;
  tiktokScript: string;
}
interface EmailDraft {
  subjectA: string;
  subjectB: string;
  preheader: string;
  heroHeadline: string;
  body: string;
  ctaText: string;
  urgency: string;
}
interface VideoScript {
  youtubeTitle: string;
  youtubeDesc: string;
  youtubeTags: string[];
  tiktokScript: string;
  reelHook: string;
}
interface MktVaultItem {
  id: string;
  type: string;
  productName: string;
  content: string;
  createdAt: string;
}

const EMPTY_GOOGLE: GoogleAd = { headlines: ['','','','','',''], descriptions: ['',''], displayUrl: '', finalUrl: '', callouts: [], sitelinks: [] };
const EMPTY_META: MetaAd = { primaryText: '', headline: '', description: '', cta: 'Shop Now', audience: '', interests: [] };
const EMPTY_SOCIAL: SocialPosts = { instagram: '', hashtags: [], facebook: '', twitter: [], linkedin: '', pinterest: '', tiktokScript: '' };
const EMPTY_EMAIL: EmailDraft = { subjectA: '', subjectB: '', preheader: '', heroHeadline: '', body: '', ctaText: '', urgency: '' };
const EMPTY_VIDEO: VideoScript = { youtubeTitle: '', youtubeDesc: '', youtubeTags: [], tiktokScript: '', reelHook: '' };

const META_CTA_OPTIONS = ['Shop Now','Learn More','Get Offer','Order Now','Sign Up','Book Now','Contact Us','Download'];

function AMarketingGen() {
  const { products } = useApp();
  const [tab, setTab] = useState<MktTab>('google');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [aiProvider, setAiProvider] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [tone, setTone] = useState<MktTone>('luxury');
  const [generating, setGenerating] = useState(false);
  const [genSection, setGenSection] = useState('');
  const [googleAd, setGoogleAd] = useState<GoogleAd>(EMPTY_GOOGLE);
  const [metaAd, setMetaAd] = useState<MetaAd>(EMPTY_META);
  const [social, setSocial] = useState<SocialPosts>(EMPTY_SOCIAL);
  const [email, setEmail] = useState<EmailDraft>(EMPTY_EMAIL);
  const [video, setVideo] = useState<VideoScript>(EMPTY_VIDEO);
  const [vault, setVault] = useState<MktVaultItem[]>([]);
  const [copied, setCopied] = useState('');
  const [newInterest, setNewInterest] = useState('');
  const [newCallout, setNewCallout] = useState('');

  const allProviders: AIProvider[] = loadAIProviders();
  const activeProviders = allProviders.filter(p => p.enabled);
  const selectedProduct = products.find(p => p.id === selectedProductId);

  useEffect(() => {
    try { setVault(JSON.parse(localStorage.getItem('luxedge_mkt_vault') || '[]')); } catch { setVault([]); }
  }, []);

  useEffect(() => {
    if (activeProviders.length && !aiProvider) {
      const def = activeProviders.find(p => p.isDefault) || activeProviders[0];
      setAiProvider(def.id);
      setAiModel(def.defaultModel);
    }
  }, [activeProviders.length, aiProvider]);

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  }

  function saveVault(type: MktTab, content: string) {
    const item: MktVaultItem = { id: Date.now().toString(), type, productName: selectedProduct?.name || '', content, createdAt: new Date().toISOString() };
    const updated = [item, ...vault].slice(0, 100);
    setVault(updated);
    localStorage.setItem('luxedge_mkt_vault', JSON.stringify(updated));
  }

    async function callAI(prompt: string): Promise<string> {
    const prov = activeProviders.find(p => p.id === aiProvider) || activeProviders[0];
    if (!prov) throw new Error('No AI provider enabled. Enable one in AI Hub → AI Provider Configuration.');
    return callAIProvider(prompt, [{ ...prov, defaultModel: aiModel || prov.defaultModel }], undefined, 'You are an expert luxury e-commerce marketing copywriter. Return only valid JSON.');
  }

function parseJ<T>(raw: string, fb: T): T {
    try { const m = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/(\{[\s\S]*\})/); return JSON.parse(m ? m[1] : raw); }
    catch { return fb; }
  }

  function buildPrompt(section: string): string {
    const p = selectedProduct;
    if (!p) return '';
    const base = `Product: "${p.name}" | Price: $${p.price} | Category: ${p.category||'Luxury'} | Tone: ${tone.toUpperCase()}\nDescription: ${p.description?.slice(0,300)||'Premium luxury product'}`;
    if (section === 'all') return `${base}\n\nGenerate comprehensive marketing copy. Return ONLY valid JSON:\n{\n  "google": {\n    "headlines": ["h1 ≤30ch","h2","h3","h4","h5","h6"],\n    "descriptions": ["desc1 ≤90ch","desc2"],\n    "displayUrl": "luxedge.com/shop",\n    "finalUrl": "https://luxedge.com/products/${p.name.toLowerCase().replace(/\s+/g,'-')}",\n    "callouts": ["Free US Shipping","Luxury Quality","Easy Returns","Secure Checkout"],\n    "sitelinks": [{"title":"Shop Now","desc":"View all luxury items","url":"/products"},{"title":"About Us","desc":"Our story","url":"/about"}]\n  },\n  "meta": {\n    "primaryText": "compelling 125-char primary ad text with emoji",\n    "headline": "40-char headline",\n    "description": "30-char description",\n    "cta": "Shop Now",\n    "audience": "US adults 25-55 interested in luxury goods, high income",\n    "interests": ["Luxury Brands","Premium Shopping","Interior Design","High-End Fashion"]\n  },\n  "social": {\n    "instagram": "engaging Instagram caption with emojis 2200 chars max",\n    "hashtags": ["luxuryliving","premiumquality","luxedge","shopnow","luxury"],\n    "facebook": "Facebook post 400-500 chars",\n    "twitter": ["tweet1 ≤280ch","tweet2 continuation","tweet3 CTA"],\n    "linkedin": "professional LinkedIn post 500-700 chars",\n    "pinterest": "Pinterest pin description 500 chars",\n    "tiktokScript": "30-second TikTok script with hook/body/CTA"\n  },\n  "email": {\n    "subjectA": "email subject A ≤50ch",\n    "subjectB": "A/B variant subject ≤50ch",\n    "preheader": "preheader text ≤90ch",\n    "heroHeadline": "bold hero headline",\n    "body": "email body with benefit paragraphs",\n    "ctaText": "Shop Now →",\n    "urgency": "limited time urgency line"\n  },\n  "video": {\n    "youtubeTitle": "YouTube title ≤60ch",\n    "youtubeDesc": "YouTube description with timestamps",\n    "youtubeTags": ["luxury","premium","review","unboxing"],\n    "tiktokScript": "60-sec TikTok script with hook/demo/CTA",\n    "reelHook": "First 3-second Reels hook line"\n  }\n}`;
    if (section === 'google') return `${base}\n\nGenerate Google RSA ad copy. Return ONLY valid JSON:\n{"headlines":["h1 ≤30ch","h2","h3","h4","h5","h6"],"descriptions":["desc1 ≤90ch","desc2"],"displayUrl":"luxedge.com/shop","finalUrl":"https://luxedge.com/products/slug","callouts":["Free Shipping","Easy Returns"],"sitelinks":[{"title":"Shop Now","desc":"All products","url":"/products"}]}`;
    if (section === 'meta') return `${base}\n\nGenerate Meta/Facebook ad copy. Return ONLY valid JSON:\n{"primaryText":"125ch primary text","headline":"40ch headline","description":"30ch description","cta":"Shop Now","audience":"target audience description","interests":["interest1","interest2"]}`;
    if (section === 'social') return `${base}\n\nGenerate social media posts. Return ONLY valid JSON:\n{"instagram":"caption","hashtags":["tag1","tag2"],"facebook":"fb post","twitter":["tweet1","tweet2"],"linkedin":"linkedin post","pinterest":"pin desc","tiktokScript":"script"}`;
    if (section === 'email') return `${base}\n\nGenerate email marketing copy. Return ONLY valid JSON:\n{"subjectA":"subject A","subjectB":"subject B","preheader":"preheader","heroHeadline":"hero","body":"body text","ctaText":"Shop Now →","urgency":"urgency line"}`;
    if (section === 'video') return `${base}\n\nGenerate video marketing scripts. Return ONLY valid JSON:\n{"youtubeTitle":"title","youtubeDesc":"description","youtubeTags":["tag1"],"tiktokScript":"script","reelHook":"hook"}`;
    return base;
  }

  async function generateAll() {
    if (!selectedProduct) { alert('Please select a product first.'); return; }
    if (!activeProviders.length) { alert('Add an AI provider API key in Settings first.'); return; }
    setGenerating(true); setGenSection('all');
    try {
      const raw = await callAI(buildPrompt('all'));
      const d = parseJ<Record<string,unknown>>(raw, {});
      if (d.google) setGoogleAd(d.google as GoogleAd);
      if (d.meta) setMetaAd(d.meta as MetaAd);
      if (d.social) setSocial(d.social as SocialPosts);
      if (d.email) setEmail(d.email as EmailDraft);
      if (d.video) setVideo(d.video as VideoScript);
    } catch(e) { alert(`AI Error: ${e instanceof Error ? e.message : String(e)}`); }
    setGenerating(false); setGenSection('');
  }

  async function regenSection(section: MktTab) {
    if (!selectedProduct) return;
    setGenerating(true); setGenSection(section);
    try {
      const raw = await callAI(buildPrompt(section));
      if (section === 'google') setGoogleAd(parseJ(raw, googleAd));
      else if (section === 'meta') setMetaAd(parseJ(raw, metaAd));
      else if (section === 'social') setSocial(parseJ(raw, social));
      else if (section === 'email') setEmail(parseJ(raw, email));
      else if (section === 'video') setVideo(parseJ(raw, video));
    } catch(e) { alert(`AI Error: ${e instanceof Error ? e.message : String(e)}`); }
    setGenerating(false); setGenSection('');
  }

  const MKT_TABS: { key: MktTab; label: string }[] = [
    { key: 'google', label: '🔍 Google Ads' },
    { key: 'meta', label: '📘 Meta Ads' },
    { key: 'social', label: '📱 Social Posts' },
    { key: 'email', label: '📧 Email' },
    { key: 'video', label: '🎬 Video' },
    { key: 'vault', label: '🗄️ Vault' },
  ];

  const CopyBtn = ({ text, k }: { text: string; k: string }) => (
    <button onClick={() => copyText(text, k)} className="p-1.5 rounded hover:bg-gray-100 transition-colors" title="Copy">
      {copied === k ? <CheckCircle size={14} className="text-green-500" /> : <Clipboard size={14} className="text-gray-400" />}
    </button>
  );

  const RegenBtn = ({ section, loading }: { section: MktTab; loading: boolean }) => (
    <button onClick={() => regenSection(section)} disabled={generating || !selectedProduct} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg font-medium disabled:opacity-50 transition-colors">
      {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
      {loading ? 'Generating…' : 'Regenerate'}
    </button>
  );

  const CharBadge = ({ text, max, warn }: { text: string; max: number; warn?: number }) => {
    const n = text.length; const w = warn ?? Math.floor(max * 0.85);
    return <span className={`text-xs font-mono ${n > max ? 'text-red-500 font-bold' : n > w ? 'text-blue-500' : 'text-gray-400'}`}>{n}/{max}</span>;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Megaphone size={24} className="text-purple-600" /> Marketing Generator
          </h1>
          <p className="text-gray-500 text-sm mt-1">AI-powered ads, social posts, email &amp; video scripts</p>
        </div>
        <button onClick={generateAll} disabled={generating || !selectedProductId} className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50 hover:shadow-lg transition-all">
          {generating && genSection === 'all' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {generating && genSection === 'all' ? 'Generating All…' : '✨ Generate All'}
        </button>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Product</label>
          <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400">
            <option value="">— Select product —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">AI Provider</label>
          <select value={aiProvider} onChange={e => { setAiProvider(e.target.value); setAiModel(''); }} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400">
            {activeProviders.length === 0 && <option value="">No providers configured</option>}
            {activeProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Model</label>
          <select value={aiModel} onChange={e => setAiModel(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400">
            {(activeProviders.find(p => p.id === aiProvider)?.models || []).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Tone</label>
          <select value={tone} onChange={e => setTone(e.target.value as MktTone)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400">
            {MKT_TONES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl overflow-x-auto">
        {MKT_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── GOOGLE ADS TAB ── */}
      {tab === 'google' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Search size={18} className="text-blue-600" /> Google Search Ads (RSA)</h2>
            <div className="flex gap-2">
              <button onClick={() => { saveVault('google', JSON.stringify(googleAd, null, 2)); }} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><Save size={12} /> Save</button>
              <RegenBtn section="google" loading={generating && genSection === 'google'} />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Headlines <span className="text-gray-400 font-normal">(max 30 chars each, use at least 5)</span></h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {googleAd.headlines.map((h, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-400 w-4">{i+1}</span>
                  <input value={h} onChange={e => { const hs = [...googleAd.headlines]; hs[i] = e.target.value.slice(0,30); setGoogleAd({...googleAd, headlines: hs}); }} placeholder={`Headline ${i+1}`} className="flex-1 text-sm bg-transparent focus:outline-none" />
                  <CharBadge text={h} max={30} />
                  <CopyBtn text={h} k={`gh${i}`} />
                </div>
              ))}
            </div>
            <button onClick={() => setGoogleAd({...googleAd, headlines: [...googleAd.headlines, '']})} className="mt-2 text-xs text-purple-600 hover:underline">+ Add headline</button>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Descriptions <span className="text-gray-400 font-normal">(max 90 chars each)</span></h3>
            <div className="space-y-2">
              {googleAd.descriptions.map((d, i) => (
                <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-400 w-4 mt-1">{i+1}</span>
                  <textarea value={d} onChange={e => { const ds = [...googleAd.descriptions]; ds[i] = e.target.value.slice(0,90); setGoogleAd({...googleAd, descriptions: ds}); }} placeholder={`Description ${i+1}`} rows={2} className="flex-1 text-sm bg-transparent focus:outline-none resize-none" />
                  <div className="flex flex-col items-end gap-1">
                    <CharBadge text={d} max={90} />
                    <CopyBtn text={d} k={`gd${i}`} />
                  </div>
                </div>
              ))}
              {googleAd.descriptions.length < 4 && <button onClick={() => setGoogleAd({...googleAd, descriptions: [...googleAd.descriptions, '']})} className="text-xs text-purple-600 hover:underline">+ Add description</button>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Display URL</h3>
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <Globe size={14} className="text-gray-400 flex-shrink-0" />
                <input value={googleAd.displayUrl} onChange={e => setGoogleAd({...googleAd, displayUrl: e.target.value})} placeholder="luxedge.com/shop/product-name" className="flex-1 text-sm bg-transparent focus:outline-none" />
                <CopyBtn text={googleAd.displayUrl} k="gdurl" />
              </div>
              <p className="text-xs text-gray-400 mt-1">Shown in ad — must match final URL domain</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Final URL</h3>
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <Link2 size={14} className="text-gray-400 flex-shrink-0" />
                <input value={googleAd.finalUrl} onChange={e => setGoogleAd({...googleAd, finalUrl: e.target.value})} placeholder="https://luxedge.com/products/..." className="flex-1 text-sm bg-transparent focus:outline-none" />
                <CopyBtn text={googleAd.finalUrl} k="gfurl" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Callout Extensions</h3>
              <div className="flex flex-wrap gap-2 mb-2">
                {googleAd.callouts.map((c, i) => (
                  <span key={i} className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full">
                    {c}
                    <button onClick={() => setGoogleAd({...googleAd, callouts: googleAd.callouts.filter((_,j) => j !== i)})} className="hover:text-red-500">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newCallout} onChange={e => setNewCallout(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newCallout.trim()) { setGoogleAd({...googleAd, callouts: [...googleAd.callouts, newCallout.trim()]}); setNewCallout(''); } }} placeholder="Add callout…" className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                <button onClick={() => { if (newCallout.trim()) { setGoogleAd({...googleAd, callouts: [...googleAd.callouts, newCallout.trim()]}); setNewCallout(''); } }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium">+</button>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Sitelink Extensions</h3>
              <div className="space-y-2">
                {googleAd.sitelinks.map((sl, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg p-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{sl.title}</p>
                      <p className="text-gray-500 truncate">{sl.desc}</p>
                    </div>
                    <button onClick={() => setGoogleAd({...googleAd, sitelinks: googleAd.sitelinks.filter((_,j) => j !== i)})} className="text-gray-400 hover:text-red-500">×</button>
                  </div>
                ))}
                <button onClick={() => setGoogleAd({...googleAd, sitelinks: [...googleAd.sitelinks, {title:'',desc:'',url:''}]})} className="text-xs text-blue-600 hover:underline">+ Add sitelink</button>
              </div>
            </div>
          </div>

          {/* Google Ad Preview */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Monitor size={14} /> Ad Preview</h3>
            <div className="border border-gray-100 rounded-lg p-4 bg-gray-50 max-w-lg">
              <div className="flex items-center gap-1 mb-1"><span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-medium">Ad</span><span className="text-xs text-gray-500 truncate">{googleAd.displayUrl || 'luxedge.com'}</span></div>
              <p className="text-blue-600 text-base font-medium leading-tight mb-0.5">{[googleAd.headlines[0], googleAd.headlines[1], googleAd.headlines[2]].filter(Boolean).join(' | ') || 'Your Ad Headlines Here'}</p>
              <p className="text-sm text-gray-700 leading-snug">{googleAd.descriptions[0] || 'Your compelling description that drives clicks and conversions.'}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── META ADS TAB ── */}
      {tab === 'meta' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Target size={18} className="text-blue-700" /> Meta Ads (Facebook &amp; Instagram)</h2>
            <div className="flex gap-2">
              <button onClick={() => saveVault('meta', JSON.stringify(metaAd, null, 2))} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><Save size={12} /> Save</button>
              <RegenBtn section="meta" loading={generating && genSection === 'meta'} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Primary Text <span className="text-gray-400 font-normal">(≤125 chars recommended)</span></label>
                  <div className="flex items-center gap-1"><CharBadge text={metaAd.primaryText} max={500} warn={125} /><CopyBtn text={metaAd.primaryText} k="mpt" /></div>
                </div>
                <textarea value={metaAd.primaryText} onChange={e => setMetaAd({...metaAd, primaryText: e.target.value})} placeholder="Engaging primary text that appears above your image…" rows={4} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700">Headline <span className="text-gray-400 text-xs">(≤40)</span></label>
                    <div className="flex items-center gap-1"><CharBadge text={metaAd.headline} max={40} /><CopyBtn text={metaAd.headline} k="mh" /></div>
                  </div>
                  <input value={metaAd.headline} onChange={e => setMetaAd({...metaAd, headline: e.target.value.slice(0,40)})} placeholder="Bold headline" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700">Description <span className="text-gray-400 text-xs">(≤30)</span></label>
                    <div className="flex items-center gap-1"><CharBadge text={metaAd.description} max={30} /><CopyBtn text={metaAd.description} k="md" /></div>
                  </div>
                  <input value={metaAd.description} onChange={e => setMetaAd({...metaAd, description: e.target.value.slice(0,30)})} placeholder="Short description" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <label className="text-sm font-semibold text-gray-700 block mb-2">Call to Action</label>
                <select value={metaAd.cta} onChange={e => setMetaAd({...metaAd, cta: e.target.value})} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300">
                  {META_CTA_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <label className="text-sm font-semibold text-gray-700 block mb-2">Target Audience</label>
                <textarea value={metaAd.audience} onChange={e => setMetaAd({...metaAd, audience: e.target.value})} placeholder="e.g. US adults 25-55, high income, interested in luxury goods…" rows={2} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <label className="text-sm font-semibold text-gray-700 block mb-2">Interests to Target</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {metaAd.interests.map((interest, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full">
                      {interest}
                      <button onClick={() => setMetaAd({...metaAd, interests: metaAd.interests.filter((_,j) => j !== i)})} className="hover:text-red-500 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={newInterest} onChange={e => setNewInterest(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newInterest.trim()) { setMetaAd({...metaAd, interests: [...metaAd.interests, newInterest.trim()]}); setNewInterest(''); } }} placeholder="Add interest…" className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  <button onClick={() => { if (newInterest.trim()) { setMetaAd({...metaAd, interests: [...metaAd.interests, newInterest.trim()]}); setNewInterest(''); } }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium">+</button>
                </div>
              </div>
            </div>

            {/* Meta Ad Preview */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm h-fit">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Share2 size={14} /> Facebook Ad Preview</h3>
              <div className="border border-gray-200 rounded-xl overflow-hidden max-w-sm">
                <div className="p-3 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">L</div>
                  <div><p className="text-xs font-semibold text-gray-900">Luxedge</p><p className="text-xs text-gray-400">Sponsored · <Globe size={10} className="inline" /></p></div>
                </div>
                <p className="px-3 pb-3 text-xs text-gray-800 leading-relaxed">{metaAd.primaryText || 'Your primary ad text will appear here.'}</p>
                <div className="bg-gray-100 h-32 flex items-center justify-center text-gray-400 text-xs">
                  <ImageIcon size={24} className="text-gray-300" />
                </div>
                <div className="p-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                  <div><p className="text-xs font-semibold text-gray-900">{metaAd.headline || 'Your Headline'}</p><p className="text-xs text-gray-500">{metaAd.description || 'Your description'}</p></div>
                  <button className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold flex-shrink-0">{metaAd.cta}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SOCIAL POSTS TAB ── */}
      {tab === 'social' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Share2 size={18} className="text-pink-600" /> Social Media Posts</h2>
            <div className="flex gap-2">
              <button onClick={() => saveVault('social', JSON.stringify(social, null, 2))} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><Save size={12} /> Save</button>
              <RegenBtn section="social" loading={generating && genSection === 'social'} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Instagram */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">📸 Instagram Caption</h3>
                <div className="flex items-center gap-1"><CharBadge text={social.instagram} max={2200} warn={1000} /><CopyBtn text={social.instagram + '\n\n' + social.hashtags.map(h => '#'+h).join(' ')} k="ig" /></div>
              </div>
              <textarea value={social.instagram} onChange={e => setSocial({...social, instagram: e.target.value})} placeholder="Write an engaging Instagram caption with emojis…" rows={5} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-pink-300 resize-none" />
              <div className="mt-3">
                <p className="text-xs font-semibold text-gray-600 mb-1"># Hashtags</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {social.hashtags.map((h, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-pink-50 text-pink-700 text-xs rounded-full">
                      #{h}
                      <button onClick={() => setSocial({...social, hashtags: social.hashtags.filter((_,j) => j !== i)})} className="hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input placeholder="hashtag (no #)" onKeyDown={e => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim().replace(/^#/,''); if (v) { setSocial({...social, hashtags: [...social.hashtags, v]}); (e.target as HTMLInputElement).value = ''; } } }} className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-pink-300" />
                </div>
              </div>
            </div>

            {/* Facebook */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">📘 Facebook Post</h3>
                <div className="flex items-center gap-1"><CharBadge text={social.facebook} max={5000} warn={400} /><CopyBtn text={social.facebook} k="fb" /></div>
              </div>
              <textarea value={social.facebook} onChange={e => setSocial({...social, facebook: e.target.value})} placeholder="Write an engaging Facebook post…" rows={5} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              <p className="text-xs text-gray-400 mt-1">Optimal length: 40–80 words</p>
            </div>

            {/* Twitter/X Thread */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">𝕏 Twitter/X Thread</h3>
                <div className="flex gap-2">
                  <CopyBtn text={social.twitter.join('\n\n')} k="tw" />
                  <button onClick={() => setSocial({...social, twitter: [...social.twitter, '']})} className="text-xs text-blue-500 hover:underline">+ Add tweet</button>
                </div>
              </div>
              <div className="space-y-2">
                {social.twitter.map((tw, i) => (
                  <div key={i} className="relative">
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-gray-400 mt-2 w-4 flex-shrink-0">{i+1}/</span>
                      <textarea value={tw} onChange={e => { const t = [...social.twitter]; t[i] = e.target.value.slice(0,280); setSocial({...social, twitter: t}); }} placeholder={`Tweet ${i+1}`} rows={2} className="flex-1 text-sm border border-gray-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none" />
                      <div className="flex flex-col items-end gap-1">
                        <CharBadge text={tw} max={280} warn={240} />
                        <button onClick={() => setSocial({...social, twitter: social.twitter.filter((_,j) => j !== i)})} className="text-gray-300 hover:text-red-400 text-xs">×</button>
                      </div>
                    </div>
                  </div>
                ))}
                {social.twitter.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No tweets yet. Click "Generate All" or add manually.</p>}
              </div>
            </div>

            {/* LinkedIn */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">💼 LinkedIn Post</h3>
                <div className="flex items-center gap-1"><CharBadge text={social.linkedin} max={3000} warn={700} /><CopyBtn text={social.linkedin} k="li" /></div>
              </div>
              <textarea value={social.linkedin} onChange={e => setSocial({...social, linkedin: e.target.value})} placeholder="Professional LinkedIn post…" rows={5} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
            </div>

            {/* Pinterest */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">📌 Pinterest Pin</h3>
                <div className="flex items-center gap-1"><CharBadge text={social.pinterest} max={500} /><CopyBtn text={social.pinterest} k="pin" /></div>
              </div>
              <textarea value={social.pinterest} onChange={e => setSocial({...social, pinterest: e.target.value.slice(0,500)})} placeholder="Pinterest pin description optimized for discovery…" rows={3} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none" />
            </div>

            {/* TikTok Script */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">🎵 TikTok Script</h3>
                <CopyBtn text={social.tiktokScript} k="tt" />
              </div>
              <textarea value={social.tiktokScript} onChange={e => setSocial({...social, tiktokScript: e.target.value})} placeholder="Write a 30-60 second TikTok script with hook/demo/CTA…" rows={6} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none" />
            </div>
          </div>
        </div>
      )}

      {/* ── EMAIL TAB ── */}
      {tab === 'email' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Send size={18} className="text-green-600" /> Email Marketing</h2>
            <div className="flex gap-2">
              <button onClick={() => saveVault('email', JSON.stringify(email, null, 2))} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><Save size={12} /> Save</button>
              <RegenBtn section="email" loading={generating && genSection === 'email'} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">A/B Subject Lines</h3>
                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-gray-600 font-medium">Version A</label>
                      <div className="flex items-center gap-1"><CharBadge text={email.subjectA} max={50} /><CopyBtn text={email.subjectA} k="esa" /></div>
                    </div>
                    <input value={email.subjectA} onChange={e => setEmail({...email, subjectA: e.target.value})} placeholder="Subject line A — curiosity/benefit driven" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-gray-600 font-medium">Version B</label>
                      <div className="flex items-center gap-1"><CharBadge text={email.subjectB} max={50} /><CopyBtn text={email.subjectB} k="esb" /></div>
                    </div>
                    <input value={email.subjectB} onChange={e => setEmail({...email, subjectB: e.target.value})} placeholder="Subject line B — urgency/FOMO driven" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Preheader <span className="text-gray-400 text-xs">(≤90 chars)</span></label>
                  <div className="flex items-center gap-1"><CharBadge text={email.preheader} max={90} /><CopyBtn text={email.preheader} k="epre" /></div>
                </div>
                <input value={email.preheader} onChange={e => setEmail({...email, preheader: e.target.value.slice(0,90)})} placeholder="Preview text shown after subject line…" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Hero Headline</label>
                  <CopyBtn text={email.heroHeadline} k="ehero" />
                </div>
                <input value={email.heroHeadline} onChange={e => setEmail({...email, heroHeadline: e.target.value})} placeholder="Bold, attention-grabbing hero headline" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Email Body</label>
                  <CopyBtn text={email.body} k="ebody" />
                </div>
                <textarea value={email.body} onChange={e => setEmail({...email, body: e.target.value})} placeholder="Email body with paragraphs covering benefits, features, social proof…" rows={6} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-green-300 resize-none" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700">CTA Button Text</label>
                    <CopyBtn text={email.ctaText} k="ecta" />
                  </div>
                  <input value={email.ctaText} onChange={e => setEmail({...email, ctaText: e.target.value})} placeholder="Shop Now →" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700">Urgency Line</label>
                    <CopyBtn text={email.urgency} k="eur" />
                  </div>
                  <input value={email.urgency} onChange={e => setEmail({...email, urgency: e.target.value})} placeholder="⏰ Offer ends midnight Friday!" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                </div>
              </div>
            </div>

            {/* Email Preview */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Monitor size={14} /> Email Preview</h3>
              <div className="border border-gray-200 rounded-xl overflow-hidden text-xs">
                <div className="bg-gray-50 p-3 border-b border-gray-200">
                  <p className="text-gray-600"><span className="font-semibold text-gray-800">From:</span> Luxedge &lt;hello@luxedge.com&gt;</p>
                  <p className="text-gray-600"><span className="font-semibold text-gray-800">Subject:</span> {email.subjectA || '(no subject yet)'}</p>
                  <p className="text-gray-400 text-xs italic">{email.preheader || '(preheader)'}</p>
                </div>
                <div className="bg-white p-4 space-y-3 max-h-80 overflow-y-auto">
                  <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg p-4 text-center">
                    <p className="font-bold text-base">{email.heroHeadline || 'Your Hero Headline'}</p>
                  </div>
                  <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{email.body || 'Your email body will appear here.'}</p>
                  {email.urgency && <p className="text-blue-600 font-semibold">{email.urgency}</p>}
                  <div className="text-center">
                    <button className="px-6 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-semibold text-sm">{email.ctaText || 'Shop Now →'}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── VIDEO TAB ── */}
      {tab === 'video' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Zap size={18} className="text-red-600" /> Video Scripts &amp; YouTube</h2>
            <div className="flex gap-2">
              <button onClick={() => saveVault('video', JSON.stringify(video, null, 2))} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><Save size={12} /> Save</button>
              <RegenBtn section="video" loading={generating && genSection === 'video'} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">▶️ YouTube Title <span className="text-gray-400 text-xs">(≤60 chars)</span></label>
                  <div className="flex items-center gap-1"><CharBadge text={video.youtubeTitle} max={60} /><CopyBtn text={video.youtubeTitle} k="yt" /></div>
                </div>
                <input value={video.youtubeTitle} onChange={e => setVideo({...video, youtubeTitle: e.target.value.slice(0,60)})} placeholder="Engaging YouTube video title" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">YouTube Description</label>
                  <CopyBtn text={video.youtubeDesc} k="ydesc" />
                </div>
                <textarea value={video.youtubeDesc} onChange={e => setVideo({...video, youtubeDesc: e.target.value})} placeholder="YouTube description with timestamps, links, keywords…" rows={5} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">YouTube Tags</label>
                  <CopyBtn text={video.youtubeTags.join(', ')} k="ytags" />
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {video.youtubeTags.map((t, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-700 text-xs rounded-full">
                      {t}
                      <button onClick={() => setVideo({...video, youtubeTags: video.youtubeTags.filter((_,j) => j !== i)})} className="hover:text-red-600">×</button>
                    </span>
                  ))}
                </div>
                <input onKeyDown={e => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) { setVideo({...video, youtubeTags: [...video.youtubeTags, v]}); (e.target as HTMLInputElement).value = ''; } } }} placeholder="Add tag, press Enter" className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">⚡ Reels / TikTok Hook</label>
                  <CopyBtn text={video.reelHook} k="rhook" />
                </div>
                <textarea value={video.reelHook} onChange={e => setVideo({...video, reelHook: e.target.value})} placeholder="First 3-second hook line — must stop the scroll…" rows={3} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-pink-300 resize-none" />
                <p className="text-xs text-gray-400 mt-1">This is the most critical line — it determines if viewers keep watching</p>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">🎵 TikTok / Reels Full Script</label>
                  <CopyBtn text={video.tiktokScript} k="tts" />
                </div>
                <textarea value={video.tiktokScript} onChange={e => setVideo({...video, tiktokScript: e.target.value})} placeholder="60-second script:\n[0:00] Hook\n[0:05] Problem\n[0:15] Solution demo\n[0:45] CTA" rows={10} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-pink-300 resize-none font-mono" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── VAULT TAB ── */}
      {tab === 'vault' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Wand2 size={18} className="text-gray-600" /> Copy Vault ({vault.length})</h2>
            <div className="flex gap-2">
              <button onClick={() => { const blob = new Blob([JSON.stringify(vault, null, 2)], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'luxedge-marketing-vault.json'; a.click(); }} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><Upload size={12} /> Export JSON</button>
              {vault.length > 0 && <button onClick={() => { if (confirm('Clear all saved copies?')) { setVault([]); localStorage.removeItem('luxedge_mkt_vault'); } }} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-medium"><Trash2 size={12} /> Clear All</button>}
            </div>
          </div>

          {vault.length === 0 ? (
            <div className="text-center py-16 bg-white border border-dashed border-gray-200 rounded-xl">
              <Megaphone size={40} className="text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No saved copies yet</p>
              <p className="text-gray-400 text-sm">Click "Save" on any tab to archive marketing copy here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {vault.map(item => (
                <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">{item.type}</span>
                      <span className="text-sm font-medium text-gray-800">{item.productName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{new Date(item.createdAt).toLocaleDateString()}</span>
                      <CopyBtn text={item.content} k={`v${item.id}`} />
                      <button onClick={() => { const updated = vault.filter(v => v.id !== item.id); setVault(updated); localStorage.setItem('luxedge_mkt_vault', JSON.stringify(updated)); }} className="p-1 text-gray-300 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
                    </div>
                  </div>
                  <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 overflow-auto max-h-32 whitespace-pre-wrap">{item.content.slice(0, 300)}{item.content.length > 300 ? '…' : ''}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ENTERPRISE SEO & CONTENT ENGINE
// ============================================================================
type SEOTab = 'seo'|'schema'|'social'|'content'|'analysis'|'preview';
type ToneOption = 'Luxury'|'Premium'|'Friendly'|'Professional'|'Technical'|'Luxury Brand'|'Minimalist';
const SEO_TONES: ToneOption[] = ['Luxury','Premium','Friendly','Professional','Technical','Luxury Brand','Minimalist'];
const SEO_SCHEMA_KEYS = ['product','breadcrumb','organization','website','faq'] as const;
type SchemaKey = typeof SEO_SCHEMA_KEYS[number];

function _scoreColor(n: number): string {
  return n >= 70 ? 'text-green-600' : n >= 45 ? 'text-blue-500' : 'text-red-500';
}
function _scoreBg(n: number): string {
  return n >= 70 ? 'bg-green-50 border-green-200' : n >= 45 ? 'bg-sky-50 border-sky-200' : 'bg-red-50 border-red-200';
}
function _issueIcon(t: 'good'|'warning'|'error'): string {
  return t === 'good' ? '✅' : t === 'warning' ? '⚠️' : '❌';
}

function _computeSEO(seo: SEOData, content: ContentData): SEOScore {
  const issues: SEOScore['issues'] = [];
  let score = 100;

  const tl = seo.title.length;
  if (tl >= 50 && tl <= 60) issues.push({ type: 'good', msg: `Title: ${tl} chars (ideal 50–60)` });
  else if (tl >= 30 && tl <= 70) { score -= 7; issues.push({ type: 'warning', msg: `Title: ${tl} chars (ideal: 50–60)` }); }
  else if (tl > 0) { score -= 18; issues.push({ type: 'error', msg: `Title: ${tl} chars (${tl < 30 ? 'too short' : 'too long — truncated in SERPs'})` }); }
  else { score -= 25; issues.push({ type: 'error', msg: 'SEO title is empty' }); }

  const ml = seo.metaDescription.length;
  if (ml >= 120 && ml <= 160) issues.push({ type: 'good', msg: `Meta: ${ml} chars (ideal 120–160)` });
  else if (ml >= 80 && ml <= 200) { score -= 8; issues.push({ type: 'warning', msg: `Meta: ${ml} chars (ideal: 120–160)` }); }
  else if (ml > 0) { score -= 18; issues.push({ type: 'error', msg: `Meta: ${ml} chars (${ml < 80 ? 'too short' : 'too long'})` }); }
  else { score -= 25; issues.push({ type: 'error', msg: 'Meta description is empty' }); }

  const fk = seo.focusKeyword.toLowerCase().trim();
  if (fk) {
    if (seo.title.toLowerCase().includes(fk)) issues.push({ type: 'good', msg: 'Focus keyword in title ✓' });
    else { score -= 12; issues.push({ type: 'error', msg: 'Focus keyword missing from title' }); }
    if (seo.metaDescription.toLowerCase().includes(fk)) issues.push({ type: 'good', msg: 'Focus keyword in meta ✓' });
    else { score -= 6; issues.push({ type: 'warning', msg: 'Focus keyword missing from meta description' }); }
    if (seo.slug.toLowerCase().includes(fk.replace(/\s+/g, '-'))) issues.push({ type: 'good', msg: 'Focus keyword in URL slug ✓' });
    else { score -= 4; issues.push({ type: 'warning', msg: 'Focus keyword not in URL slug' }); }
  } else {
    score -= 15; issues.push({ type: 'error', msg: 'Focus keyword not set' });
  }

  if (seo.imageAlt.trim()) issues.push({ type: 'good', msg: 'Image ALT text set ✓' });
  else { score -= 8; issues.push({ type: 'error', msg: 'Image ALT text is missing' }); }

  if (seo.slug.trim()) issues.push({ type: 'good', msg: 'URL slug defined ✓' });
  else { score -= 8; issues.push({ type: 'error', msg: 'URL slug not set' }); }

  if (seo.keywords.length >= 5) issues.push({ type: 'good', msg: `${seo.keywords.length} SEO keywords defined ✓` });
  else if (seo.keywords.length >= 3) { score -= 4; issues.push({ type: 'warning', msg: `${seo.keywords.length} keywords — aim for 5+` }); }
  else { score -= 10; issues.push({ type: 'error', msg: 'Too few keywords (add at least 5)' }); }

  const desc = content.luxuryDescription || '';
  const words = desc.split(/\s+/).filter(Boolean);
  const wc = words.length;
  if (wc >= 200) issues.push({ type: 'good', msg: `Description: ${wc} words ✓` });
  else if (wc >= 100) { score -= 6; issues.push({ type: 'warning', msg: `Description: ${wc} words (aim for 200+)` }); }
  else if (wc > 0) { score -= 14; issues.push({ type: 'error', msg: `Description: ${wc} words (thin content)` }); }
  else { score -= 20; issues.push({ type: 'error', msg: 'Luxury description is empty' }); }

  const sentences = desc.split(/[.!?]+/).filter(s => s.trim().length > 5);
  const avgWPS = sentences.length > 0 ? wc / sentences.length : 0;
  let readability = 100;
  if (avgWPS > 30) { readability = 35; issues.push({ type: 'error', msg: `Sentences too long (avg ${avgWPS.toFixed(0)} words)` }); }
  else if (avgWPS > 20) { readability = 65; issues.push({ type: 'warning', msg: `Sentences a bit long (avg ${avgWPS.toFixed(0)} words)` }); }
  else if (avgWPS > 5) { issues.push({ type: 'good', msg: `Readability good (avg ${avgWPS.toFixed(0)} words/sentence)` }); }

  const kwCount = fk ? words.filter(w => w.toLowerCase().includes(fk)).length : 0;
  const density = wc > 0 ? (kwCount / wc) * 100 : 0;
  if (fk) {
    if (density >= 1 && density <= 3) issues.push({ type: 'good', msg: `Keyword density: ${density.toFixed(1)}% (ideal 1–3%)` });
    else if (density > 0) { score -= 4; issues.push({ type: 'warning', msg: `Keyword density: ${density.toFixed(1)}% (ideal: 1–3%)` }); }
    else { score -= 8; issues.push({ type: 'warning', msg: 'Keyword not found in description' }); }
  }

  if (content.bulletFeatures.length >= 4) issues.push({ type: 'good', msg: `${content.bulletFeatures.length} bullet features ✓` });
  else if (content.bulletFeatures.length > 0) { score -= 3; issues.push({ type: 'warning', msg: `Only ${content.bulletFeatures.length} features listed (aim for 6+)` }); }

  return {
    overall: Math.max(0, Math.min(100, score)),
    readability: Math.max(0, Math.min(100, readability)),
    keywordDensity: density,
    metaLength: ml,
    titleLength: tl,
    missingAlt: seo.imageAlt ? 0 : 1,
    issues,
  };
}

function _genProductSchema(p: Product, seo: SEOData, c: ContentData): string {
  return JSON.stringify({
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": seo.title || p.name,
    "description": c.shortDescription || p.shortDesc,
    "image": p.images?.length ? [p.images[0]] : [],
    "sku": p.id,
    "brand": { "@type": "Brand", "name": p.brand || "Luxedge" },
    "offers": {
      "@type": "Offer",
      "url": `https://luxedge.us/#/products/${p.id}`,
      "priceCurrency": "USD",
      "price": p.price.toFixed(2),
      "priceValidUntil": new Date(Date.now() + 86400000 * 90).toISOString().split('T')[0],
      "availability": p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      "seller": { "@type": "Organization", "name": "Luxedge" }
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": p.rating.toString(),
      "reviewCount": p.reviews.toString(),
      "bestRating": "5",
      "worstRating": "1"
    }
  }, null, 2);
}

function _genBreadcrumbSchema(p: Product, seo: SEOData): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://luxedge.us" },
      { "@type": "ListItem", "position": 2, "name": p.category, "item": `https://luxedge.us/#/category/${p.category.toLowerCase().replace(/\s+/g,'-')}` },
      { "@type": "ListItem", "position": 3, "name": seo.title || p.name, "item": `https://luxedge.us/#/products/${seo.slug || p.id}` }
    ]
  }, null, 2);
}

function _genOrgSchema(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Luxedge",
    "url": "https://luxedge.us",
    "logo": { "@type": "ImageObject", "url": "https://luxedge.us/logo.png" },
    "contactPoint": { "@type": "ContactPoint", "contactType": "customer service", "email": "support@luxedge.us", "availableLanguage": "English" },
    "address": { "@type": "PostalAddress", "addressCountry": "US" },
    "sameAs": ["https://twitter.com/luxedge", "https://facebook.com/luxedge", "https://instagram.com/luxedge"]
  }, null, 2);
}

function _genWebsiteSchema(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Luxedge",
    "url": "https://luxedge.us",
    "description": "Premium pet essentials for dogs and cats",
    "potentialAction": {
      "@type": "SearchAction",
      "target": { "@type": "EntryPoint", "urlTemplate": "https://luxedge.us/#/search?q={search_term_string}" },
      "query-input": "required name=search_term_string"
    }
  }, null, 2);
}

function _genFAQSchema(faqs: { q: string; a: string }[]): string {
  if (!faqs.length) return '';
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(f => ({
      "@type": "Question",
      "name": f.q,
      "acceptedAnswer": { "@type": "Answer", "text": f.a }
    }))
  }, null, 2);
}

function _tryValidate(json: string): boolean {
  if (!json.trim()) return false;
  try { JSON.parse(json); return true; } catch { return false; }
}

function ASEOEngine() {
  const { products, setProducts, notify } = useApp();
  const navigate = useNavigate();

  const [selId, setSelId] = useState('');
  const [tab, setTab] = useState<SEOTab>('seo');
  const [tone, setTone] = useState<ToneOption>('Luxury');
  const [previewMode, setPreviewMode] = useState<'desktop'|'mobile'|'facebook'|'twitter'>('desktop');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSection, setAiSection] = useState('');
  const [aiStatus, setAiStatus] = useState('');
  const [newKw, setNewKw] = useState('');
  const [newSecKw, setNewSecKw] = useState('');
  const [copied, setCopied] = useState('');
  const [schemaValid, setSchemaValid] = useState<Record<SchemaKey, boolean>>({ product: false, breadcrumb: false, organization: false, website: false, faq: false });
  const [aiProviders] = useState<AIProvider[]>(() => {
    return loadAIProviders();
  });

  const [seo, setSeo] = useState<SEOData>({
    title: '', metaDescription: '', keywords: [], slug: '', canonicalUrl: '',
    focusKeyword: '', secondaryKeywords: [], imageAlt: '', imageTitle: '', imageCaption: '',
  });
  const [social, setSocial] = useState<SocialSEO>({
    ogTitle: '', ogDescription: '', ogImage: '',
    twitterCard: 'summary_large_image', twitterTitle: '', twitterDescription: '',
    pinterestDescription: '', pinterestImage: '',
  });
  const [content, setContent] = useState<ContentData>({
    premiumTitle: '', luxuryDescription: '', shortDescription: '',
    bulletFeatures: [], specifications: {}, benefits: [],
    useCases: [], careInstructions: '', packageContents: [],
    warrantyText: '', shippingInfo: '', focusKeyword: '', faqs: [],
  });
  const [schemas, setSchemas] = useState<StructuredSchemas>({
    product: '', breadcrumb: '', organization: _genOrgSchema(), website: _genWebsiteSchema(), faq: '',
  });
  const [score, setScore] = useState<SEOScore>({
    overall: 0, readability: 0, keywordDensity: 0, metaLength: 0, titleLength: 0, missingAlt: 0, issues: [],
  });

  const selProduct = products.find(p => p.id === selId);

  // Auto-populate from product
  useEffect(() => {
    const p = products.find(x => x.id === selId);
    if (!p) return;
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    setSeo(prev => ({
      ...prev,
      title: prev.title || p.name,
      slug: prev.slug || slug,
      canonicalUrl: `https://luxedge.us/#/products/${slug}`,
      imageAlt: prev.imageAlt || (p.name + ' product image'),
      imageTitle: prev.imageTitle || p.name,
    }));
    setSocial(prev => ({
      ...prev,
      ogTitle: prev.ogTitle || p.name,
      ogDescription: prev.ogDescription || p.shortDesc,
      ogImage: prev.ogImage || (p.images?.[0] || ''),
      twitterTitle: prev.twitterTitle || p.name,
      twitterDescription: prev.twitterDescription || p.shortDesc,
      pinterestImage: prev.pinterestImage || (p.images?.[0] || ''),
    }));
    setContent(prev => ({
      ...prev,
      premiumTitle: prev.premiumTitle || p.name,
      shortDescription: prev.shortDescription || p.shortDesc,
    }));
  }, [selId, products]);

  // Live SEO score
  useEffect(() => {
    setScore(_computeSEO(seo, content));
  }, [seo, content]);

  function generateSchemas() {
    if (!selProduct) return;
    const faqJson = _genFAQSchema(content.faqs);
    const next: StructuredSchemas = {
      product: _genProductSchema(selProduct, seo, content),
      breadcrumb: _genBreadcrumbSchema(selProduct, seo),
      organization: _genOrgSchema(),
      website: _genWebsiteSchema(),
      faq: faqJson,
    };
    setSchemas(next);
    const valid: Record<SchemaKey, boolean> = { product: false, breadcrumb: false, organization: false, website: false, faq: false };
    SEO_SCHEMA_KEYS.forEach(k => { valid[k] = _tryValidate(next[k]); });
    setSchemaValid(valid);
    notify('Schemas generated & validated', 'success');
  }

  async function generateAll() {
    if (!selProduct) { notify('Select a product first', 'error'); return; }
    const prompt = `You are a luxury e-commerce SEO expert for Luxedge (premium US dropshipping brand).

Generate complete SEO content for this product:
Name: ${selProduct.name}
Category: ${selProduct.category}
Price: $${selProduct.price} (was $${selProduct.originalPrice})
Description: ${selProduct.shortDesc}
Brand: ${selProduct.brand}
Rating: ${selProduct.rating}/5 (${selProduct.reviews} reviews)
Writing Tone: ${tone}

Return ONLY valid JSON (no markdown):
{
  "premiumTitle": "...",
  "luxuryDescription": "...",
  "shortDescription": "...",
  "bulletFeatures": ["feature 1","feature 2","feature 3","feature 4","feature 5","feature 6"],
  "specifications": {"Spec Name":"Value"},
  "benefits": ["benefit 1","benefit 2","benefit 3","benefit 4"],
  "useCases": ["use case 1","use case 2","use case 3"],
  "careInstructions": "...",
  "packageContents": ["item 1","item 2"],
  "warrantyText": "...",
  "shippingInfo": "...",
  "faqs": [{"q":"question?","a":"answer."},{"q":"question?","a":"answer."},{"q":"question?","a":"answer."}],
  "seoTitle": "...",
  "metaDescription": "...",
  "keywords": ["kw1","kw2","kw3","kw4","kw5","kw6","kw7","kw8"],
  "slug": "url-friendly-slug",
  "focusKeyword": "primary keyword",
  "secondaryKeywords": ["secondary1","secondary2","secondary3"],
  "imageAlt": "...",
  "imageTitle": "...",
  "imageCaption": "...",
  "ogTitle": "...",
  "ogDescription": "...",
  "twitterTitle": "...",
  "twitterDescription": "...",
  "pinterestDescription": "..."
}

Rules:
- Tone: ${tone}
- luxuryDescription: 200+ words, compelling, conversion-focused, ${tone} voice
- seoTitle: 50-60 chars, include focus keyword near start
- metaDescription: 120-160 chars, include CTA
- All copy must target US market
- Return ONLY the JSON`;

    setAiLoading(true); setAiSection('all'); setAiStatus('Generating all SEO content…');
    try {
      const raw = await callAIProvider(prompt, aiProviders, m => setAiStatus(m));
      const cleaned = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const d = JSON.parse(cleaned) as Record<string, unknown>;
      const arr = (k: string): string[] => Array.isArray(d[k]) ? (d[k] as string[]) : [];
      const str = (k: string): string => typeof d[k] === 'string' ? d[k] as string : '';
      const obj = (k: string): Record<string,string> => (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) ? d[k] as Record<string,string> : {};
      const faqArr = (d['faqs'] as {q:string;a:string}[] | undefined) || [];

      setContent({
        premiumTitle: str('premiumTitle'), luxuryDescription: str('luxuryDescription'),
        shortDescription: str('shortDescription'), bulletFeatures: arr('bulletFeatures'),
        specifications: obj('specifications'), benefits: arr('benefits'),
        useCases: arr('useCases'), careInstructions: str('careInstructions'),
        packageContents: arr('packageContents'), warrantyText: str('warrantyText'),
        shippingInfo: str('shippingInfo'), focusKeyword: str('focusKeyword'), faqs: faqArr,
      });
      setSeo(prev => ({
        ...prev,
        title: str('seoTitle') || prev.title,
        metaDescription: str('metaDescription') || prev.metaDescription,
        keywords: arr('keywords').length ? arr('keywords') : prev.keywords,
        slug: str('slug') || prev.slug,
        focusKeyword: str('focusKeyword') || prev.focusKeyword,
        secondaryKeywords: arr('secondaryKeywords').length ? arr('secondaryKeywords') : prev.secondaryKeywords,
        imageAlt: str('imageAlt') || prev.imageAlt,
        imageTitle: str('imageTitle') || prev.imageTitle,
        imageCaption: str('imageCaption') || prev.imageCaption,
        canonicalUrl: `https://luxedge.us/#/products/${str('slug') || prev.slug}`,
      }));
      setSocial(prev => ({
        ...prev,
        ogTitle: str('ogTitle') || prev.ogTitle,
        ogDescription: str('ogDescription') || prev.ogDescription,
        twitterTitle: str('twitterTitle') || prev.twitterTitle,
        twitterDescription: str('twitterDescription') || prev.twitterDescription,
        pinterestDescription: str('pinterestDescription') || prev.pinterestDescription,
      }));
      notify('All SEO content generated!', 'success');
    } catch (e: any) {
      notify(`AI error: ${e.message}`, 'error');
    } finally {
      setAiLoading(false); setAiSection(''); setAiStatus('');
    }
  }

  async function regenSection(section: string, fieldHint: string) {
    if (!selProduct) return;
    const prompt = `You are a luxury e-commerce copywriter. Rewrite only the ${section} for this product in ${tone} tone.
Product: ${selProduct.name} ($${selProduct.price})
Category: ${selProduct.category}
${content.focusKeyword ? `Focus keyword: ${seo.focusKeyword}` : ''}

Return ONLY a JSON object with a single key "${fieldHint}".
Example: {"${fieldHint}": "your content here"}`;
    setAiLoading(true); setAiSection(section); setAiStatus(`Regenerating ${section}…`);
    try {
      const raw = await callAIProvider(prompt, aiProviders, m => setAiStatus(m));
      const cleaned = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const d = JSON.parse(cleaned) as Record<string, unknown>;
      const val = d[fieldHint];
      if (fieldHint === 'bulletFeatures' || fieldHint === 'benefits' || fieldHint === 'useCases' || fieldHint === 'packageContents') {
        setContent(prev => ({ ...prev, [fieldHint]: Array.isArray(val) ? val : prev[fieldHint as keyof ContentData] }));
      } else {
        setContent(prev => ({ ...prev, [fieldHint]: typeof val === 'string' ? val : prev[fieldHint as keyof ContentData] }));
      }
      notify(`${section} regenerated`, 'success');
    } catch (e: any) { notify(`AI error: ${e.message}`, 'error'); }
    finally { setAiLoading(false); setAiSection(''); setAiStatus(''); }
  }

  function copySchema(key: SchemaKey) {
    const text = schemas[key];
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    }).catch(() => notify('Copy failed — use Ctrl+A in the text area', 'error'));
  }

  function saveToProduct() {
    if (!selProduct) { notify('Select a product first', 'error'); return; }
    const updates: Partial<Product> = {};
    if (content.premiumTitle) updates.name = content.premiumTitle;
    if (content.luxuryDescription) updates.description = content.luxuryDescription;
    if (content.shortDescription) updates.shortDesc = content.shortDescription;
    setProducts(prev => prev.map(p => p.id === selProduct.id ? { ...p, ...updates } : p));
    localStorage.setItem(`luxedge_seo_${selProduct.id}`, JSON.stringify({ seo, social, schemas, content }));
    notify(`SEO data saved to "${selProduct.name}"`, 'success');
  }

  // ── Reusable UI pieces ───────────────────────────────────────────────────
  const RegenBtn = ({ section, field }: { section: string; field: string }) => (
    <button onClick={() => regenSection(section, field)} disabled={aiLoading}
      className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 px-2 py-1 border border-purple-200 rounded-lg hover:bg-purple-50 disabled:opacity-40 transition-colors">
      {aiLoading && aiSection === section ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
      Regen
    </button>
  );

  const FieldRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  );

  const inp = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none';
  const ta = inp + ' resize-none';

  const ScoreCircle = ({ label, value, unit = '' }: { label: string; value: number; unit?: string }) => (
    <div className={`rounded-xl border p-3 text-center ${_scoreBg(value)}`}>
      <p className={`text-2xl font-bold ${_scoreColor(value)}`}>{Math.round(value)}{unit}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );

  const TAB_ITEMS: { key: SEOTab; label: string }[] = [
    { key: 'seo', label: '🔍 SEO' },
    { key: 'schema', label: '{ } Schema' },
    { key: 'social', label: '📱 Social' },
    { key: 'content', label: '✍️ Content' },
    { key: 'analysis', label: '📊 Analysis' },
    { key: 'preview', label: '👁 Preview' },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Search size={24} className="text-purple-600" /> Enterprise SEO & Content Engine
          </h1>
          <p className="text-gray-500 text-sm mt-1">AI-powered SEO · Structured Data · Social SEO · Content · Live Analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={saveToProduct} disabled={!selId}
            className="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <Save size={15} /> Save to Product
          </button>
          <button onClick={() => navigate('/admin/products')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 px-3 py-2 border border-gray-200 rounded-xl transition-colors">
            <ArrowLeft size={15} /> Back
          </button>
        </div>
      </div>

      {/* Product selector + AI generate bar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Product</label>
          <select value={selId} onChange={e => setSelId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none bg-white">
            <option value="">-- Select a product --</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name} · ${p.price}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">AI Tone</label>
          <select value={tone} onChange={e => setTone(e.target.value as ToneOption)}
            className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none bg-white">
            {SEO_TONES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button onClick={generateAll} disabled={aiLoading || !selId}
          className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50 transition-colors whitespace-nowrap">
          {aiLoading && aiSection === 'all' ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
          {aiLoading && aiSection === 'all' ? aiStatus || 'Generating…' : 'Generate All with AI'}
        </button>
        {selProduct && (
          <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-xl border border-purple-100 text-xs">
            {selProduct.images?.[0] && <img src={selProduct.images[0]} alt="" className="w-8 h-8 object-cover rounded-lg" />}
            <div>
              <p className="font-semibold text-gray-900 max-w-32 truncate">{selProduct.name}</p>
              <p className="text-purple-600">${selProduct.price} · {selProduct.category}</p>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl flex-wrap">
        {TAB_ITEMS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 min-w-fit px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${tab === t.key ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: Product SEO ──────────────────────────────────────────────── */}
      {tab === 'seo' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Globe size={18} className="text-purple-600" /> Product SEO Fields</h2>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${_scoreBg(score.overall)} ${_scoreColor(score.overall)}`}>
              SEO Score: {score.overall}/100
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="SEO Title (50–60 chars)">
              <div className="relative">
                <input value={seo.title} onChange={e => setSeo(p => ({...p, title: e.target.value}))} className={inp} placeholder="Enter SEO title…" maxLength={80} />
                <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold ${seo.title.length >= 50 && seo.title.length <= 60 ? 'text-green-600' : seo.title.length > 0 ? 'text-blue-500' : 'text-gray-400'}`}>{seo.title.length}</span>
              </div>
            </FieldRow>
            <FieldRow label="URL Slug">
              <input value={seo.slug} onChange={e => setSeo(p => ({...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'-')}))} className={inp} placeholder="url-friendly-slug" />
            </FieldRow>
            <FieldRow label="Meta Description (120–160 chars)">
              <div className="relative">
                <textarea value={seo.metaDescription} onChange={e => setSeo(p => ({...p, metaDescription: e.target.value}))} rows={3} className={ta} placeholder="Compelling meta description with CTA…" />
                <span className={`absolute right-3 bottom-3 text-xs font-bold ${seo.metaDescription.length >= 120 && seo.metaDescription.length <= 160 ? 'text-green-600' : seo.metaDescription.length > 0 ? 'text-blue-500' : 'text-gray-400'}`}>{seo.metaDescription.length}/160</span>
              </div>
            </FieldRow>
            <FieldRow label="Canonical URL">
              <input value={seo.canonicalUrl} onChange={e => setSeo(p => ({...p, canonicalUrl: e.target.value}))} className={inp} placeholder="https://luxedge.us/#/products/…" />
            </FieldRow>
            <FieldRow label="Focus Keyword">
              <input value={seo.focusKeyword} onChange={e => setSeo(p => ({...p, focusKeyword: e.target.value}))} className={inp} placeholder="Primary SEO keyword" />
            </FieldRow>
            <FieldRow label="Image ALT Text">
              <input value={seo.imageAlt} onChange={e => setSeo(p => ({...p, imageAlt: e.target.value}))} className={inp} placeholder="Descriptive ALT text for main image" />
            </FieldRow>
            <FieldRow label="Image Title">
              <input value={seo.imageTitle} onChange={e => setSeo(p => ({...p, imageTitle: e.target.value}))} className={inp} placeholder="Image title attribute" />
            </FieldRow>
            <FieldRow label="Image Caption">
              <input value={seo.imageCaption} onChange={e => setSeo(p => ({...p, imageCaption: e.target.value}))} className={inp} placeholder="Optional image caption" />
            </FieldRow>
          </div>
          {/* Keywords */}
          <FieldRow label="SEO Keywords">
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-8">
              {seo.keywords.map(k => (
                <span key={k} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 text-xs px-2.5 py-1 rounded-full border border-purple-100">
                  {k}<button onClick={() => setSeo(p => ({...p, keywords: p.keywords.filter(x => x !== k)}))} className="hover:text-red-500"><X size={10} /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newKw} onChange={e => setNewKw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newKw.trim()) { setSeo(p => ({...p, keywords: [...p.keywords, newKw.trim()]})); setNewKw(''); e.preventDefault(); }}} placeholder="Add keyword…" className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
              <button onClick={() => { if (newKw.trim()) { setSeo(p => ({...p, keywords: [...p.keywords, newKw.trim()]})); setNewKw(''); }}} className="px-4 py-2 bg-purple-600 text-white rounded-xl text-sm hover:bg-purple-700"><Plus size={14} /></button>
            </div>
          </FieldRow>
          {/* Secondary Keywords */}
          <FieldRow label="Secondary Keywords">
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-8">
              {seo.secondaryKeywords.map(k => (
                <span key={k} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs px-2.5 py-1 rounded-full border border-indigo-100">
                  {k}<button onClick={() => setSeo(p => ({...p, secondaryKeywords: p.secondaryKeywords.filter(x => x !== k)}))} className="hover:text-red-500"><X size={10} /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newSecKw} onChange={e => setNewSecKw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newSecKw.trim()) { setSeo(p => ({...p, secondaryKeywords: [...p.secondaryKeywords, newSecKw.trim()]})); setNewSecKw(''); e.preventDefault(); }}} placeholder="Add secondary keyword…" className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
              <button onClick={() => { if (newSecKw.trim()) { setSeo(p => ({...p, secondaryKeywords: [...p.secondaryKeywords, newSecKw.trim()]})); setNewSecKw(''); }}} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm hover:bg-indigo-700"><Plus size={14} /></button>
            </div>
          </FieldRow>
        </div>
      )}

      {/* ── TAB: Structured Data ─────────────────────────────────────────── */}
      {tab === 'schema' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Code size={18} className="text-purple-600" /> JSON-LD Structured Data</h2>
            <button onClick={generateSchemas} disabled={!selId}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50">
              <RefreshCw size={14} /> Generate All Schemas
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {SEO_SCHEMA_KEYS.map(key => (
              <div key={key} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 capitalize">{key === 'faq' ? 'FAQ' : key} Schema</span>
                    {schemas[key] && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${schemaValid[key] ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {schemaValid[key] ? '✓ Valid' : '✗ Invalid'}
                      </span>
                    )}
                    {key === 'faq' && !content.faqs.length && <span className="text-xs text-gray-400 italic">(no FAQs — generate AI content first)</span>}
                  </div>
                  <button onClick={() => copySchema(key)} disabled={!schemas[key]}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2.5 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40">
                    <Clipboard size={12} /> {copied === key ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="p-4 text-xs text-gray-700 bg-gray-50 overflow-x-auto max-h-56 font-mono leading-relaxed">
                  {schemas[key] || <span className="text-gray-400 italic">Not generated yet — click "Generate All Schemas"</span>}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB: Social SEO ──────────────────────────────────────────────── */}
      {tab === 'social' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
          <h2 className="font-bold text-gray-900 flex items-center gap-2"><Share2 size={18} className="text-purple-600" /> Social SEO</h2>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Open Graph (Facebook / LinkedIn)</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FieldRow label="OG Title (60–90 chars)"><input value={social.ogTitle} onChange={e => setSocial(p => ({...p, ogTitle: e.target.value}))} className={inp} placeholder="Open Graph title" /></FieldRow>
              <FieldRow label="OG Image URL"><input value={social.ogImage} onChange={e => setSocial(p => ({...p, ogImage: e.target.value}))} className={inp} placeholder="https://…" /></FieldRow>
              <div className="md:col-span-2">
                <FieldRow label="OG Description (100–200 chars)"><textarea value={social.ogDescription} onChange={e => setSocial(p => ({...p, ogDescription: e.target.value}))} rows={2} className={ta} placeholder="Engaging social description" /></FieldRow>
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Twitter / X Card</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FieldRow label="Card Type">
                <select value={social.twitterCard} onChange={e => setSocial(p => ({...p, twitterCard: e.target.value}))} className={inp + ' bg-white'}>
                  <option value="summary_large_image">Summary Large Image</option>
                  <option value="summary">Summary</option>
                  <option value="product">Product</option>
                </select>
              </FieldRow>
              <FieldRow label="Twitter Title"><input value={social.twitterTitle} onChange={e => setSocial(p => ({...p, twitterTitle: e.target.value}))} className={inp} placeholder="Twitter card title" /></FieldRow>
              <div className="md:col-span-2">
                <FieldRow label="Twitter Description"><textarea value={social.twitterDescription} onChange={e => setSocial(p => ({...p, twitterDescription: e.target.value}))} rows={2} className={ta} placeholder="Twitter card description" /></FieldRow>
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Pinterest Rich Pin</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FieldRow label="Pinterest Image URL"><input value={social.pinterestImage} onChange={e => setSocial(p => ({...p, pinterestImage: e.target.value}))} className={inp} placeholder="https://…" /></FieldRow>
              <div className="md:col-span-2">
                <FieldRow label="Pinterest Description"><textarea value={social.pinterestDescription} onChange={e => setSocial(p => ({...p, pinterestDescription: e.target.value}))} rows={2} className={ta} placeholder="Pinterest description with keywords" /></FieldRow>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: AI Content ──────────────────────────────────────────────── */}
      {tab === 'content' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Sparkles size={18} className="text-purple-600" /> AI Content</h2>
            {aiLoading && aiSection !== 'all' && <p className="text-xs text-purple-600 animate-pulse">{aiStatus}</p>}
          </div>
          <div className="grid grid-cols-1 gap-4">
            {[
              { label: 'Premium Product Title', field: 'premiumTitle', section: 'Premium Title', type: 'input' },
              { label: 'Short Description (2–3 sentences)', field: 'shortDescription', section: 'Short Description', type: 'textarea2' },
              { label: 'Luxury Product Description (200+ words)', field: 'luxuryDescription', section: 'Luxury Description', type: 'textarea6' },
              { label: 'Care Instructions', field: 'careInstructions', section: 'Care Instructions', type: 'textarea2' },
              { label: 'Warranty Text', field: 'warrantyText', section: 'Warranty Text', type: 'textarea2' },
              { label: 'Shipping Information', field: 'shippingInfo', section: 'Shipping Info', type: 'textarea2' },
            ].map(({ label, field, section, type }) => (
              <div key={field} className="bg-white rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">{label}</label>
                  <RegenBtn section={section} field={field} />
                </div>
                {type === 'input' ? (
                  <input value={(content[field as keyof ContentData] as string) || ''} onChange={e => setContent(p => ({...p, [field]: e.target.value}))} className={inp} placeholder={`AI will generate ${label.toLowerCase()}…`} />
                ) : (
                  <textarea value={(content[field as keyof ContentData] as string) || ''} onChange={e => setContent(p => ({...p, [field]: e.target.value}))} rows={type === 'textarea6' ? 6 : 2} className={ta} placeholder={`AI will generate ${label.toLowerCase()}…`} />
                )}
              </div>
            ))}
            {/* Bullet Features */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Bullet Features</label>
                <RegenBtn section="Bullet Features" field="bulletFeatures" />
              </div>
              <div className="space-y-2">
                {content.bulletFeatures.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-purple-400 text-sm">•</span>
                    <input value={f} onChange={e => setContent(p => ({...p, bulletFeatures: p.bulletFeatures.map((x,j) => j===i ? e.target.value : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => ({...p, bulletFeatures: p.bulletFeatures.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, bulletFeatures: [...p.bulletFeatures, '']}))} className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"><Plus size={12} /> Add Feature</button>
              </div>
            </div>
            {/* Benefits */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Benefits</label>
                <RegenBtn section="Benefits" field="benefits" />
              </div>
              <div className="space-y-2">
                {content.benefits.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-green-400 text-sm">✓</span>
                    <input value={b} onChange={e => setContent(p => ({...p, benefits: p.benefits.map((x,j) => j===i ? e.target.value : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => ({...p, benefits: p.benefits.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, benefits: [...p.benefits, '']}))} className="text-xs text-green-600 hover:text-green-800 flex items-center gap-1"><Plus size={12} /> Add Benefit</button>
              </div>
            </div>
            {/* Use Cases */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Use Cases</label>
                <RegenBtn section="Use Cases" field="useCases" />
              </div>
              <div className="space-y-2">
                {content.useCases.map((u, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-blue-400 text-sm">→</span>
                    <input value={u} onChange={e => setContent(p => ({...p, useCases: p.useCases.map((x,j) => j===i ? e.target.value : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => ({...p, useCases: p.useCases.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, useCases: [...p.useCases, '']}))} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"><Plus size={12} /> Add Use Case</button>
              </div>
            </div>
            {/* Specs */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Technical Specifications</label>
                <RegenBtn section="Specifications" field="specifications" />
              </div>
              <div className="space-y-2">
                {Object.entries(content.specifications).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <input value={k} readOnly className="w-36 border border-gray-100 rounded-lg px-2.5 py-1.5 text-xs bg-gray-50 font-medium text-gray-600" />
                    <span className="text-gray-400">:</span>
                    <input value={v} onChange={e => setContent(p => ({ ...p, specifications: { ...p.specifications, [k]: e.target.value } }))} className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => { const s = {...p.specifications}; delete s[k]; return {...p, specifications: s}; })} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                {!Object.keys(content.specifications).length && <p className="text-xs text-gray-400 italic">No specs yet — use AI Generate or add manually</p>}
              </div>
            </div>
            {/* Package Contents */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Package Contents</label>
                <RegenBtn section="Package Contents" field="packageContents" />
              </div>
              <div className="space-y-2">
                {content.packageContents.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm">📦</span>
                    <input value={item} onChange={e => setContent(p => ({...p, packageContents: p.packageContents.map((x,j) => j===i ? e.target.value : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => ({...p, packageContents: p.packageContents.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, packageContents: [...p.packageContents, '']}))} className="text-xs text-gray-600 hover:text-gray-800 flex items-center gap-1"><Plus size={12} /> Add Item</button>
              </div>
            </div>
            {/* FAQs */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">FAQs (used in FAQ Schema)</label>
                <RegenBtn section="FAQs" field="faqs" />
              </div>
              <div className="space-y-3">
                {content.faqs.map((faq, i) => (
                  <div key={i} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <input value={faq.q} onChange={e => setContent(p => ({...p, faqs: p.faqs.map((x,j) => j===i ? {...x, q: e.target.value} : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white font-medium focus:ring-1 focus:ring-purple-500 focus:outline-none" placeholder="Question?" />
                      <button onClick={() => setContent(p => ({...p, faqs: p.faqs.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500 mt-1"><X size={14} /></button>
                    </div>
                    <textarea value={faq.a} onChange={e => setContent(p => ({...p, faqs: p.faqs.map((x,j) => j===i ? {...x, a: e.target.value} : x)}))} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none resize-none" placeholder="Answer…" />
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, faqs: [...p.faqs, {q:'', a:''}]}))} className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"><Plus size={12} /> Add FAQ</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: SEO Analysis ────────────────────────────────────────────── */}
      {tab === 'analysis' && (
        <div className="space-y-4">
          <h2 className="font-bold text-gray-900 flex items-center gap-2"><TrendingUp size={18} className="text-purple-600" /> Live SEO Analysis</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <ScoreCircle label="SEO Score" value={score.overall} />
            <ScoreCircle label="Readability" value={score.readability} />
            <ScoreCircle label="KW Density" value={score.keywordDensity} unit="%" />
            <ScoreCircle label="Meta Chars" value={score.metaLength >= 120 && score.metaLength <= 160 ? 100 : score.metaLength >= 80 ? 65 : 30} />
            <ScoreCircle label="Title Chars" value={score.titleLength >= 50 && score.titleLength <= 60 ? 100 : score.titleLength >= 30 ? 65 : 30} />
            <ScoreCircle label="Image ALT" value={score.missingAlt === 0 ? 100 : 0} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-3xl font-bold text-gray-900">{score.titleLength}</p>
              <p className="text-xs text-gray-500">Title length <span className="text-gray-400">(ideal 50–60)</span></p>
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${score.titleLength >= 50 && score.titleLength <= 60 ? 'bg-green-500' : 'bg-sky-400'}`} style={{ width: `${Math.min(100, (score.titleLength/70)*100)}%` }} /></div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-3xl font-bold text-gray-900">{score.metaLength}</p>
              <p className="text-xs text-gray-500">Meta length <span className="text-gray-400">(ideal 120–160)</span></p>
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${score.metaLength >= 120 && score.metaLength <= 160 ? 'bg-green-500' : 'bg-sky-400'}`} style={{ width: `${Math.min(100, (score.metaLength/200)*100)}%` }} /></div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-3xl font-bold text-gray-900">{score.keywordDensity.toFixed(1)}%</p>
              <p className="text-xs text-gray-500">Keyword density <span className="text-gray-400">(ideal 1–3%)</span></p>
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${score.keywordDensity >= 1 && score.keywordDensity <= 3 ? 'bg-green-500' : 'bg-sky-400'}`} style={{ width: `${Math.min(100, score.keywordDensity * 25)}%` }} /></div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Issues & Recommendations</h3>
            {score.issues.length === 0 ? (
              <p className="text-gray-400 text-sm italic">Generate content to see analysis…</p>
            ) : (
              <div className="space-y-1.5">
                {score.issues.map((issue, i) => (
                  <div key={i} className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg ${issue.type === 'good' ? 'bg-green-50' : issue.type === 'warning' ? 'bg-sky-50' : 'bg-red-50'}`}>
                    <span>{_issueIcon(issue.type)}</span>
                    <span className={issue.type === 'good' ? 'text-green-800' : issue.type === 'warning' ? 'text-blue-800' : 'text-red-800'}>{issue.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Internal Link Suggestions */}
          {selProduct && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Link2 size={15} /> Internal Link Suggestions</h3>
              <div className="space-y-2">
                {products.filter(p => p.id !== selId && p.category === selProduct.category).slice(0,4).map(p => (
                  <div key={p.id} className="flex items-center gap-3 text-sm p-2 rounded-lg hover:bg-gray-50">
                    <span className="text-purple-400">→</span>
                    <span className="text-gray-700">{p.name}</span>
                    <span className="text-gray-400 text-xs ml-auto font-mono">/#/products/{p.id}</span>
                  </div>
                ))}
                {!products.filter(p => p.id !== selId && p.category === selProduct.category).length && <p className="text-gray-400 text-sm italic">No related products in same category</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Preview ─────────────────────────────────────────────────── */}
      {tab === 'preview' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {([['desktop','💻 Desktop'],['mobile','📱 Mobile'],['facebook','👥 Facebook'],['twitter','🐦 Twitter']] as const).map(([mode, label]) => (
              <button key={mode} onClick={() => setPreviewMode(mode)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${previewMode === mode ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-purple-50'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Google Desktop Preview */}
          {previewMode === 'desktop' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Monitor size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-500">Google Search — Desktop</span>
              </div>
              <div className="border border-gray-200 rounded-xl p-5 max-w-2xl bg-white font-sans">
                <p className="text-xs text-gray-500 mb-1">https://luxedge.us › products › {seo.slug || 'product'}</p>
                <p className="text-xl text-blue-700 hover:underline cursor-pointer font-medium leading-tight mb-1">{seo.title || selProduct?.name || 'SEO Title will appear here'}</p>
                <p className="text-sm text-gray-600 leading-relaxed">{seo.metaDescription || 'Meta description will appear here. It shows up to 160 characters in Google search results.'}</p>
              </div>
              <p className="text-xs text-gray-400 mt-3">Title: {seo.title.length}/60 chars · Meta: {seo.metaDescription.length}/160 chars</p>
            </div>
          )}

          {/* Google Mobile Preview */}
          {previewMode === 'mobile' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Smartphone size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-500">Google Search — Mobile</span>
              </div>
              <div className="max-w-sm mx-auto">
                <div className="border border-gray-200 rounded-2xl p-4 bg-white font-sans shadow-sm">
                  <p className="text-xs text-green-600 mb-0.5">luxedge.us › {seo.slug || 'products'}</p>
                  <p className="text-base text-blue-700 font-medium leading-tight mb-1 line-clamp-2">{seo.title || 'SEO Title'}</p>
                  <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">{seo.metaDescription || 'Meta description shown in mobile search results.'}</p>
                </div>
              </div>
            </div>
          )}

          {/* Facebook Preview */}
          {previewMode === 'facebook' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Share2 size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-500">Facebook / Open Graph Preview</span>
              </div>
              <div className="max-w-lg mx-auto border border-gray-300 rounded-lg overflow-hidden bg-white shadow-sm">
                {social.ogImage ? (
                  <img src={social.ogImage} alt="" className="w-full h-52 object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                ) : (
                  <div className="w-full h-52 bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center">
                    <p className="text-gray-400 text-sm">1200×630 OG Image</p>
                  </div>
                )}
                <div className="p-3 bg-gray-50 border-t border-gray-200">
                  <p className="text-xs text-gray-500 uppercase">LUXEDGE.US</p>
                  <p className="font-bold text-gray-900 text-sm leading-tight mt-0.5">{social.ogTitle || seo.title || 'OG Title'}</p>
                  <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{social.ogDescription || seo.metaDescription || 'OG Description'}</p>
                </div>
              </div>
            </div>
          )}

          {/* Twitter Preview */}
          {previewMode === 'twitter' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-gray-400 text-sm font-bold">𝕏</span>
                <span className="text-sm font-medium text-gray-500">Twitter / X Card Preview</span>
              </div>
              <div className="max-w-lg mx-auto border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                {social.ogImage ? (
                  <img src={social.ogImage} alt="" className="w-full h-48 object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                ) : (
                  <div className="w-full h-48 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                    <p className="text-gray-400 text-sm">Twitter Card Image</p>
                  </div>
                )}
                <div className="p-3">
                  <p className="font-bold text-gray-900 text-sm">{social.twitterTitle || seo.title || 'Twitter Title'}</p>
                  <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{social.twitterDescription || seo.metaDescription || 'Twitter description'}</p>
                  <p className="text-xs text-gray-400 mt-1">luxedge.us</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ============================================================================
// ENTERPRISE VARIANT GENERATOR
// ============================================================================
const VARIANT_ATTRIBUTE_PRESETS: Record<string, string[]> = {
  Colors: ['Black','White','Gray','Navy','Red','Blue','Green','Yellow','Pink','Purple','Orange','Brown','Beige','Gold','Silver'],
  Sizes: ['XS','S','M','L','XL','XXL','XXXL','One Size','6','7','8','9','10','11','12'],
  Materials: ['Cotton','Polyester','Nylon','Leather','Stainless Steel','Aluminum','Silicone','Wood','Bamboo','Canvas','Linen'],
  Storage: ['16GB','32GB','64GB','128GB','256GB','512GB','1TB'],
  Styles: ['Classic','Modern','Vintage','Minimalist','Sport','Casual','Formal','Bohemian'],
  'Bundle Options': ['Single','2-Pack','3-Pack','5-Pack','10-Pack','Starter Kit','Pro Kit','Family Pack'],
};

const ATTR_ICONS: Record<string, string> = {
  Colors: '🎨', Sizes: '📏', Materials: '🧵', Storage: '💾', Styles: '✨', 'Bundle Options': '📦',
};

function _makeVid(): string {
  return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function _cartesian(attrs: VariantAttribute[]): Record<string,string>[] {
  const active = attrs.filter(a => a.values.length > 0);
  if (!active.length) return [];
  return active.reduce<Record<string,string>[]>((acc, attr) => {
    if (!acc.length) return attr.values.map(v => ({ [attr.name]: v }));
    return acc.flatMap(combo => attr.values.map(v => ({ ...combo, [attr.name]: v })));
  }, []);
}

function _genSKU(base: string, combo: Record<string,string>, idx: number): string {
  const suffix = Object.values(combo).map(v => v.slice(0,3).toUpperCase().replace(/\s/g,'')).join('-');
  return base ? `${base}-${suffix}` : `SKU-${String(idx).padStart(3,'0')}-${suffix}`;
}

function _comboKey(combo: Record<string,string>): string {
  return Object.entries(combo).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}:${v}`).join('|');
}

function _detectAttrsFromProduct(product: Product): VariantAttribute[] {
  const out: VariantAttribute[] = [];
  const colors = new Set<string>();
  const sizes = new Set<string>();
  (product.variants || []).forEach(pv => {
    if (pv.color) colors.add(pv.color);
    if (pv.size && pv.size !== 'One Size') sizes.add(pv.size);
  });
  if (colors.size) out.push({ id: _makeVid(), name: 'Colors', values: [...colors], autoDetected: true });
  if (sizes.size) out.push({ id: _makeVid(), name: 'Sizes', values: [...sizes], autoDetected: true });
  return out;
}

function AVariantGen() {
  const { products, setProducts, notify } = useApp();
  const navigate = useNavigate();

  type VGStep = 'product'|'attributes'|'matrix'|'done';
  const [step, setStep] = useState<VGStep>('product');
  const [selId, setSelId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualSku, setManualSku] = useState('');
  const [manualPrice, setManualPrice] = useState(0);
  const [attrs, setAttrs] = useState<VariantAttribute[]>([
    { id: _makeVid(), name: 'Colors', values: [], autoDetected: false },
    { id: _makeVid(), name: 'Sizes', values: [], autoDetected: false },
  ]);
  const [variants, setVariants] = useState<EnterpriseVariant[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [newAttrName, setNewAttrName] = useState('');
  const [newValInputs, setNewValInputs] = useState<Record<string,string>>({});
  const [editId, setEditId] = useState<string|null>(null);
  const [dupKeys, setDupKeys] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const [aiProviders] = useState<AIProvider[]>(() => {
    return loadAIProviders();
  });

  const selProduct = products.find(p => p.id === selId);

  useEffect(() => {
    const p = products.find(x => x.id === selId);
    if (p) {
      const detected = _detectAttrsFromProduct(p);
      if (detected.length) {
        setAttrs(prev => [...detected, ...prev.filter(a => !a.autoDetected)]);
      }
      setManualSku(`PROD-${p.id}`);
      setManualPrice(p.price);
    }
  }, [selId, products]);

  useEffect(() => {
    const keys = variants.map(v => _comboKey(v.combo));
    const seen = new Set<string>();
    const dups = new Set<string>();
    keys.forEach(k => { if (seen.has(k)) dups.add(k); else seen.add(k); });
    setDupKeys(dups);
  }, [variants]);

  function generateMatrix() {
    const combos = _cartesian(attrs);
    if (!combos.length) { notify('Add at least one attribute with values first.', 'error'); return; }
    const base = selProduct ? selProduct.id.toUpperCase() : (manualSku || 'SKU');
    const basePrice = selProduct ? selProduct.price : manualPrice;
    setVariants(combos.map((combo, i) => ({
      id: _makeVid(),
      combo,
      sku: _genSKU(base, combo, i),
      barcode: '',
      costPrice: Math.round(basePrice * 0.45 * 100) / 100,
      sellingPrice: basePrice,
      comparePrice: Math.round(basePrice * 1.25 * 100) / 100,
      inventory: 50,
      weight: selProduct?.weight || '',
      dimensions: selProduct?.dimensions || '',
      image: selProduct?.images?.[0] || '',
      status: 'active' as const,
      lowStockThreshold: 5,
    })));
    setStep('matrix');
  }

  async function aiSuggest() {
    const info = selProduct
      ? `Product: ${selProduct.name}\nCategory: ${selProduct.category}\nDescription: ${selProduct.shortDesc}`
      : `Product: ${manualName}`;
    const prompt = `You are an expert e-commerce product specialist.

For this product, suggest variant attributes with specific realistic values:
${info}

Return ONLY valid JSON:
{
  "attributes": [
    {"name": "Colors", "values": ["Black", "White"]},
    {"name": "Sizes", "values": ["S", "M", "L"]}
  ]
}

Rules:
- Only include attributes that make sense for this specific product
- Provide realistic and specific values (not generic placeholders)
- Max 4 attribute groups, max 6 values each
- Focus on: Colors, Sizes, Materials, Storage, Styles, Bundle Options
- Return ONLY the JSON, no other text`;

    setAiLoading(true);
    setAiStatus('Analyzing product with AI…');
    try {
      const raw = await callAIProvider(prompt, aiProviders, m => setAiStatus(m));
      const cleaned = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const parsed = JSON.parse(cleaned) as { attributes: { name: string; values: string[] }[] };
      if (parsed.attributes?.length) {
        setAttrs(parsed.attributes.map(a => ({ id: _makeVid(), name: a.name, values: a.values, autoDetected: true })));
        notify(`AI suggested ${parsed.attributes.length} attribute groups`, 'success');
      }
    } catch (e: any) {
      notify(`AI error: ${e.message}`, 'error');
    } finally {
      setAiLoading(false);
      setAiStatus('');
    }
  }

  function addVal(attrId: string) {
    const val = (newValInputs[attrId] || '').trim();
    if (!val) return;
    setAttrs(prev => prev.map(a =>
      a.id === attrId && !a.values.includes(val) ? { ...a, values: [...a.values, val] } : a
    ));
    setNewValInputs(prev => ({ ...prev, [attrId]: '' }));
  }

  function removeVal(attrId: string, val: string) {
    setAttrs(prev => prev.map(a =>
      a.id === attrId ? { ...a, values: a.values.filter(v => v !== val) } : a
    ));
  }

  function removeAttr(attrId: string) {
    setAttrs(prev => prev.filter(a => a.id !== attrId));
  }

  function addAttr() {
    if (!newAttrName.trim()) return;
    setAttrs(prev => [...prev, { id: _makeVid(), name: newAttrName.trim(), values: [], autoDetected: false }]);
    setNewAttrName('');
  }

  function applyPresets(attrId: string, attrName: string) {
    const presets = VARIANT_ATTRIBUTE_PRESETS[attrName] || [];
    setAttrs(prev => prev.map(a =>
      a.id !== attrId ? a : { ...a, values: [...new Set([...a.values, ...presets])] }
    ));
  }

  function updateV(id: string, field: string, value: string | number) {
    setVariants(prev => prev.map(v => v.id === id ? ({ ...v, [field]: value } as EnterpriseVariant) : v));
  }

  function removeV(id: string) {
    setVariants(prev => prev.filter(v => v.id !== id));
  }

  function removeDuplicates() {
    setVariants(prev => {
      const seen = new Set<string>();
      const keep: EnterpriseVariant[] = [];
      for (const v of prev) {
        const k = _comboKey(v.combo);
        if (!seen.has(k)) { seen.add(k); keep.push(v); }
      }
      return keep;
    });
  }

  function saveToProduct() {
    if (!selProduct) { notify('Select a product first', 'error'); return; }
    const newVars: ProductVariant[] = variants.map(v => ({
      id: v.id,
      color: v.combo['Colors'] || v.combo[Object.keys(v.combo)[0]] || 'Default',
      size: v.combo['Sizes'] || v.combo[Object.keys(v.combo)[1]] || 'One Size',
      price: v.sellingPrice,
      salePrice: v.sellingPrice,
      stock: v.inventory,
      sku: v.sku,
      image: v.image || undefined,
    }));
    setProducts(prev => prev.map(p => p.id === selProduct.id ? { ...p, variants: newVars } : p));
    setSaved(true);
    setStep('done');
    notify(`Saved ${variants.length} variants to "${selProduct.name}"`, 'success');
  }

  function resetAll() {
    setSaved(false);
    setStep('product');
    setVariants([]);
    setSelId('');
    setManualName('');
    setManualSku('');
    setManualPrice(0);
    setAttrs([
      { id: _makeVid(), name: 'Colors', values: [], autoDetected: false },
      { id: _makeVid(), name: 'Sizes', values: [], autoDetected: false },
    ]);
  }

  const totalCombos = _cartesian(attrs).length;
  const dupCount = dupKeys.size;
  const editedV = variants.find(v => v.id === editId) ?? null;

  const VG_STEPS: { key: VGStep; label: string }[] = [
    { key: 'product', label: '1. Product' },
    { key: 'attributes', label: '2. Attributes' },
    { key: 'matrix', label: '3. Matrix' },
    { key: 'done', label: '4. Done' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Layers size={24} className="text-purple-600" /> Enterprise Variant Generator
          </h1>
          <p className="text-gray-500 text-sm mt-1">Auto-detect attributes · AI suggestions · Complete variant matrix</p>
        </div>
        <button onClick={() => navigate('/admin/products')} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} /> Products
        </button>
      </div>

      {/* Step Progress */}
      <div className="flex items-center gap-0">
        {VG_STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <button
              onClick={() => { if (s.key !== 'done' || saved) setStep(s.key); }}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                step === s.key ? 'bg-purple-600 text-white' :
                (VG_STEPS.findIndex(x => x.key === step) > i) ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' :
                'text-gray-400 cursor-default'
              }`}
            >{s.label}</button>
            {i < VG_STEPS.length - 1 && <ChevronRight size={16} className="text-gray-400 mx-1" />}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Product ─────────────────────────────────────────────────── */}
      {step === 'product' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Package size={18} className="text-purple-600" /> Select Product
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Existing Product</label>
                <select value={selId} onChange={e => setSelId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none bg-white">
                  <option value="">-- Select a product to generate variants for --</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} · ${p.price}</option>)}
                </select>
              </div>
              {selProduct && (
                <div className="flex items-center gap-4 p-4 bg-purple-50 rounded-xl border border-purple-100">
                  {selProduct.images?.[0] && (
                    <img src={selProduct.images[0]} alt="" className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
                  )}
                  <div>
                    <p className="font-semibold text-gray-900">{selProduct.name}</p>
                    <p className="text-sm text-gray-500">{selProduct.category} · ${selProduct.price}</p>
                    <p className="text-xs text-purple-600 mt-1">
                      {selProduct.variants?.length || 0} existing variants · will be replaced on save
                    </p>
                  </div>
                </div>
              )}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Or set manually (for new products)</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Product Name</label>
                    <input value={manualName} onChange={e => setManualName(e.target.value)}
                      placeholder="e.g. Premium T-Shirt"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Base SKU</label>
                    <input value={manualSku} onChange={e => setManualSku(e.target.value)}
                      placeholder="e.g. TSHIRT-001"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Base Price ($)</label>
                    <input type="number" value={manualPrice || ''} onChange={e => setManualPrice(parseFloat(e.target.value) || 0)}
                      placeholder="0.00"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => {
                if (!selId && !manualName.trim()) { notify('Select a product or enter a product name', 'error'); return; }
                setStep('attributes');
              }}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"
            >
              Next: Configure Attributes <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Attributes ──────────────────────────────────────────────── */}
      {step === 'attributes' && (
        <div className="space-y-4">
          {/* AI Banner */}
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl p-5 flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="font-semibold">AI Attribute Suggestions</p>
              <p className="text-sm text-purple-100">Let AI analyze your product and suggest realistic variant attributes and values</p>
              {aiStatus && <p className="text-xs text-purple-200 mt-1 animate-pulse">{aiStatus}</p>}
            </div>
            <button onClick={aiSuggest} disabled={aiLoading}
              className="flex items-center gap-2 bg-white text-purple-700 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-purple-50 disabled:opacity-60 transition-colors whitespace-nowrap flex-shrink-0">
              {aiLoading ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
              {aiLoading ? 'Analyzing…' : 'AI Suggest'}
            </button>
          </div>

          {/* Attribute Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {attrs.map(attr => (
              <div key={attr.id} className="bg-white rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg">{ATTR_ICONS[attr.name] || '📋'}</span>
                    <span className="font-semibold text-gray-900">{attr.name}</span>
                    {attr.autoDetected && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Auto-detected</span>
                    )}
                    <span className="text-xs text-gray-400">{attr.values.length} value{attr.values.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {VARIANT_ATTRIBUTE_PRESETS[attr.name] && (
                      <button onClick={() => applyPresets(attr.id, attr.name)}
                        className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-purple-50 transition-colors">
                        <Shuffle size={12} /> Presets
                      </button>
                    )}
                    <button onClick={() => removeAttr(attr.id)}
                      className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {/* Values */}
                <div className="flex flex-wrap gap-1.5 mb-3 min-h-8">
                  {attr.values.map(v => (
                    <span key={v} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 text-xs px-2.5 py-1 rounded-full border border-purple-100 group">
                      {v}
                      <button onClick={() => removeVal(attr.id, v)} className="hover:text-red-500 ml-0.5 opacity-60 group-hover:opacity-100">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  {!attr.values.length && (
                    <span className="text-xs text-gray-400 italic py-1">No values yet — type below or load presets</span>
                  )}
                </div>
                {/* Add value input */}
                <div className="flex gap-2">
                  <input
                    value={newValInputs[attr.id] || ''}
                    onChange={e => setNewValInputs(p => ({ ...p, [attr.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addVal(attr.id); } }}
                    placeholder={`Add ${attr.name.toLowerCase()} value…`}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-purple-500 focus:outline-none"
                  />
                  <button onClick={() => addVal(attr.id)}
                    className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs hover:bg-purple-700 transition-colors">
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add custom attribute */}
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-4">
            <p className="text-sm font-medium text-gray-700 mb-3">Add Custom Attribute</p>
            <div className="flex gap-2">
              <input value={newAttrName} onChange={e => setNewAttrName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAttr(); } }}
                placeholder="e.g. Connectivity, Voltage, Finish, Scent…"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
              <button onClick={addAttr}
                className="px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm hover:bg-gray-800 flex items-center gap-2 transition-colors">
                <Plus size={16} /> Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {Object.keys(VARIANT_ATTRIBUTE_PRESETS).map(preset => (
                <button key={preset} onClick={() => {
                  if (!attrs.find(a => a.name === preset)) {
                    setAttrs(prev => [...prev, { id: _makeVid(), name: preset, values: [], autoDetected: false }]);
                  }
                }} className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full hover:bg-purple-50 hover:text-purple-700 transition-colors">
                  + {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Matrix preview count */}
          {totalCombos > 0 && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle size={18} className="text-blue-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-800">
                  Will generate <strong>{totalCombos}</strong> variant{totalCombos !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-blue-600 mt-0.5">
                  {attrs.filter(a => a.values.length).map(a => `${a.name}(${a.values.length})`).join(' × ')}
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep('product')} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-4 py-2.5">
              <ArrowLeft size={16} /> Back
            </button>
            <button onClick={generateMatrix} disabled={totalCombos === 0}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors">
              <Shuffle size={16} /> Generate {totalCombos > 0 ? `${totalCombos} Variants` : 'Matrix'}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Matrix ──────────────────────────────────────────────────── */}
      {step === 'matrix' && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Variants', value: variants.length, cls: 'text-purple-600' },
              { label: 'Duplicates', value: dupCount, cls: dupCount ? 'text-red-600' : 'text-green-600' },
              { label: 'Active', value: variants.filter(v => v.status === 'active').length, cls: 'text-green-600' },
              { label: 'Low Stock', value: variants.filter(v => v.inventory <= v.lowStockThreshold).length, cls: 'text-blue-600' },
            ].map(s => (
              <div key={s.label} className={`bg-white rounded-xl border p-3 text-center ${s.label === 'Duplicates' && dupCount ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
                <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {dupCount > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2 text-sm text-red-700">
              <AlertTriangle size={16} className="flex-shrink-0" />
              <span>{dupCount} duplicate combination{dupCount > 1 ? 's' : ''} detected — remove before saving</span>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Table2 size={18} className="text-purple-600" /> Variant Matrix ({variants.length})
              </h3>
              <div className="flex gap-2">
                <button onClick={() => setStep('attributes')}
                  className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg transition-colors">
                  <Sliders size={14} /> Attributes
                </button>
                <button onClick={removeDuplicates} disabled={!dupCount}
                  className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1.5 px-3 py-1.5 border border-red-200 rounded-lg disabled:opacity-40 transition-colors">
                  <Trash2 size={14} /> Remove Dupes
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Combination</th>
                    <th className="text-left px-4 py-3 font-medium">SKU</th>
                    <th className="text-right px-4 py-3 font-medium">Cost</th>
                    <th className="text-right px-4 py-3 font-medium">Price</th>
                    <th className="text-right px-4 py-3 font-medium">Compare</th>
                    <th className="text-right px-4 py-3 font-medium">Stock</th>
                    <th className="text-center px-4 py-3 font-medium">Status</th>
                    <th className="text-center px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {variants.map(v => {
                    const isDup = dupKeys.has(_comboKey(v.combo));
                    const isEd = editId === v.id;
                    return (
                      <tr key={v.id} className={`hover:bg-gray-50 transition-colors ${isDup ? 'bg-red-50' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(v.combo).map(([k, val]) => (
                              <span key={k} className="inline-flex items-center gap-0.5 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full border border-purple-100">
                                <span className="text-purple-400 text-[10px]">{k}:</span>{val}
                              </span>
                            ))}
                            {isDup && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-semibold">DUPLICATE</span>}
                          </div>
                        </td>
                        {isEd ? (
                          <>
                            <td className="px-3 py-2">
                              <input value={v.sku} onChange={e => updateV(v.id,'sku',e.target.value)} className="w-28 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={v.costPrice} onChange={e => updateV(v.id,'costPrice',parseFloat(e.target.value)||0)} className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={v.sellingPrice} onChange={e => updateV(v.id,'sellingPrice',parseFloat(e.target.value)||0)} className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={v.comparePrice} onChange={e => updateV(v.id,'comparePrice',parseFloat(e.target.value)||0)} className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={v.inventory} onChange={e => updateV(v.id,'inventory',parseInt(e.target.value)||0)} className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <select value={v.status} onChange={e => updateV(v.id,'status',e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none">
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                                <option value="draft">Draft</option>
                              </select>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 font-mono text-xs text-gray-600">{v.sku}</td>
                            <td className="px-4 py-3 text-right text-xs text-gray-500">${v.costPrice.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right font-semibold">${v.sellingPrice.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right text-xs text-gray-400 line-through">${v.comparePrice.toFixed(2)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${v.inventory <= v.lowStockThreshold ? 'text-blue-600' : ''}`}>{v.inventory}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v.status === 'active' ? 'bg-green-100 text-green-700' : v.status === 'draft' ? 'bg-gray-100 text-gray-600' : 'bg-red-100 text-red-600'}`}>
                                {v.status}
                              </span>
                            </td>
                          </>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => setEditId(isEd ? null : v.id)}
                              className={`p-1.5 rounded-lg transition-colors ${isEd ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-purple-600 hover:bg-purple-50'}`}>
                              {isEd ? <Save size={14} /> : <Edit2 size={14} />}
                            </button>
                            <button onClick={() => removeV(v.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Extended fields panel */}
            {editedV && (
              <div className="p-5 bg-purple-50 border-t border-purple-100">
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-4">
                  Extended Fields — {Object.values(editedV.combo).join(' / ')}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Barcode (UPC/EAN)</label>
                    <input value={editedV.barcode} onChange={e => updateV(editedV.id,'barcode',e.target.value)}
                      placeholder="123456789012"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Weight</label>
                    <input value={editedV.weight} onChange={e => updateV(editedV.id,'weight',e.target.value)}
                      placeholder="0.5 lbs"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Dimensions</label>
                    <input value={editedV.dimensions} onChange={e => updateV(editedV.id,'dimensions',e.target.value)}
                      placeholder="10×5×2 in"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Low Stock Alert</label>
                    <input type="number" value={editedV.lowStockThreshold}
                      onChange={e => updateV(editedV.id,'lowStockThreshold',parseInt(e.target.value)||0)}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Variant Image URL</label>
                    <input value={editedV.image} onChange={e => updateV(editedV.id,'image',e.target.value)}
                      placeholder="https://…"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  {editedV.image && (
                    <div className="flex items-center gap-2">
                      <img src={editedV.image} alt="" className="h-12 w-12 object-cover rounded-lg border border-gray-200"
                        onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                      <span className="text-xs text-gray-500">Preview</span>
                    </div>
                  )}
                </div>
                <button onClick={() => setEditId(null)}
                  className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg text-xs hover:bg-purple-700 transition-colors">
                  <Save size={14} /> Done Editing
                </button>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center">
            <button onClick={() => setStep('attributes')} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-4 py-2.5">
              <ArrowLeft size={16} /> Back to Attributes
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{variants.length} variant{variants.length !== 1 ? 's' : ''} ready</span>
              {selId ? (
                <button onClick={saveToProduct} disabled={!!dupCount || !variants.length}
                  className="px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
                  <Save size={16} /> Save All to Product
                </button>
              ) : (
                <button onClick={() => { notify('Select a product to save variants', 'error'); setStep('product'); }}
                  className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
                  <AlertTriangle size={16} /> Select Product First
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 4: Done ────────────────────────────────────────────────────── */}
      {step === 'done' && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle size={40} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Variants Saved!</h2>
          <p className="text-gray-500 max-w-sm">
            <strong>{variants.length}</strong> variant{variants.length !== 1 ? 's' : ''} created for{' '}
            <strong>{selProduct?.name || 'your product'}</strong>
          </p>
          <div className="bg-gray-50 rounded-xl p-4 text-left w-full max-w-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Summary</p>
            <div className="space-y-1 text-sm">
              <p><span className="text-gray-500">Attributes:</span> {attrs.filter(a => a.values.length).map(a => `${a.name}(${a.values.length})`).join(' × ')}</p>
              <p><span className="text-gray-500">Total combinations:</span> {variants.length}</p>
              <p><span className="text-gray-500">Price range:</span> ${Math.min(...variants.map(v => v.sellingPrice)).toFixed(2)} – ${Math.max(...variants.map(v => v.sellingPrice)).toFixed(2)}</p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={resetAll}
              className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
              Start Over
            </button>
            <button onClick={() => navigate('/admin/products')}
              className="px-5 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 flex items-center gap-2 transition-colors">
              <Package size={16} /> View Products
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// AI HUB — Unified AI Management Dashboard
// ============================================================================
function AAIHub() {
  const { notify } = useApp();
  const navigate = useNavigate();
  const [aiProviders, setAiProviders] = useState<AIProvider[]>(() => {
    return loadAIProviders();
  });
  const [serverStatus, setServerStatus] = useState<Record<string, ProviderStatus> | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [orCredits, setOrCredits] = useState<{ total: number; used: number } | null>(null);
  const [checkingCredits, setCheckingCredits] = useState(false);

  const I = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-all';

    const save = (updated: AIProvider[]) => {
    setAiProviders(updated);
    saveAIProviders(updated);
    setSaving(true); notify('AI Providers saved!'); setTimeout(() => setSaving(false), 3000);
  };

  useEffect(() => {
    serverProviderStatus().then((s) => {
      const map: Record<string, ProviderStatus> = {};
      s.providers.forEach(p => { map[p.id] = p; });
      setServerStatus(map);
    }).catch(() => setServerStatus({}));
  }, []);

  const testProvider = async (provider: AIProvider) => {
    setTesting(provider.id);
    try {
      const msg = await serverTestProvider(provider.id, provider.defaultModel);
      setTestResult({ ...testResult, [provider.id]: msg });
    } catch (e: any) {
      setTestResult({ ...testResult, [provider.id]: `Error: ${e.message?.slice(0, 80)}` });
    } finally { setTesting(null); }
  };

  const checkOpenRouterCredits = async () => {
    setCheckingCredits(true);
    try {
      const c = await serverOpenRouterCredits();
      setOrCredits({ total: c.total, used: c.used });
    } catch (e: any) { notify(`Credit check failed: ${e.message}`); }
    finally { setCheckingCredits(false); }
  };

const providerIcons: Record<string, string> = {
    openrouter: '\u{1F310}', gemini: '\u{1F916}', openai: '\u{1F9E0}', anthropic: '\u{1F9EC}'
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-12 h-12 bg-gradient-to-br from-purple-500 via-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-200">
          <Bot size={26} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI Hub</h1>
          <p className="text-sm text-gray-500">Manage AI providers, API keys, credits, and import settings</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => navigate('/admin/ai-import')} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <Wand2 size={16} /> AI Import
          </button>
          <button onClick={() => navigate('/admin/marketing')} className="px-4 py-2 border border-purple-300 text-purple-700 hover:bg-purple-50 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <Megaphone size={16} /> Marketing
          </button>
        </div>
      </div>

      {/* OpenRouter Credits Card */}
      {aiProviders.find(p => p.id === 'openrouter' && p.enabled) && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-sm text-purple-800 flex items-center gap-2">
              <Globe size={16} /> OpenRouter Credits
            </h2>
            <button onClick={checkOpenRouterCredits} disabled={checkingCredits}
              className="px-3 py-1.5 bg-white border border-purple-200 rounded-lg text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
              {checkingCredits ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {checkingCredits ? 'Checking...' : 'Check Credits'}
            </button>
          </div>
          {orCredits ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-purple-700">${orCredits.total.toFixed(2)}</p>
                <p className="text-xs text-gray-500">Total Limit</p>
              </div>
              <div className="bg-white rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-blue-600">${orCredits.used.toFixed(2)}</p>
                <p className="text-xs text-gray-500">Used</p>
              </div>
              <div className="bg-white rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-green-600">${(orCredits.total - orCredits.used).toFixed(2)}</p>
                <p className="text-xs text-gray-500">Remaining</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-purple-600">Click "Check Credits" to view your OpenRouter balance.</p>
          )}
          <p className="text-xs text-purple-400 mt-2">
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="underline hover:text-purple-600">Get OpenRouter credits →</a>
          </p>
        </div>
      )}

      {/* AI Providers */}
      <div className="bg-white rounded-2xl border border-purple-200 p-5">
        <h2 className="font-bold text-sm text-gray-700 mb-4 flex items-center gap-2">
          <Bot size={16} className="text-purple-500" /> AI Provider Configuration
        </h2>
        <p className="text-sm text-gray-500 mb-5">Add API keys and select models for each provider. The default provider is used for all AI operations.</p>
        <div className="space-y-3">
          {aiProviders.map((provider, idx) => (
            <div key={provider.id} className={`border rounded-xl p-4 transition-all ${provider.isDefault ? 'border-purple-300 bg-purple-50/50 shadow-sm' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => save(aiProviders.map((p, i) => ({ ...p, enabled: i === idx ? !p.enabled : p.enabled })))}>
                    {provider.enabled ? <ToggleRight size={24} className="text-green-500" /> : <ToggleLeft size={24} className="text-gray-400" />}
                  </button>
                  <div>
                    <span className="font-semibold text-sm">{providerIcons[provider.id] || ''} {provider.name}</span>
                    {provider.isDefault && <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Default</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => testProvider(provider)} disabled={testing === provider.id}
                    className="px-3 py-1.5 text-xs border rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
                    {testing === provider.id ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                    Test
                  </button>
                  {!provider.isDefault && (
                    <button type="button" onClick={() => save(aiProviders.map(p => ({ ...p, isDefault: p.id === provider.id })))}
                      className="text-xs text-purple-600 hover:text-purple-800 font-medium">Make Default</button>
                  )}
                </div>
              </div>
              {testResult[provider.id] && (
                <div className={`mb-3 p-2 rounded-lg text-xs ${testResult[provider.id].startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                  {testResult[provider.id]}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Server Key</label>
                  <div className={"flex items-center gap-2 text-xs px-3 py-2.5 rounded-xl border " + (serverStatus?.[provider.id]?.configured ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700')}>
                    {serverStatus?.[provider.id]?.configured ? <CheckCircle size={14} className="shrink-0" /> : <AlertTriangle size={14} className="shrink-0" />}
                    {serverStatus?.[provider.id]?.configured
                      ? 'Configured on server — key is safe (env var only)'
                      : 'Not configured — add the provider key env var on the server (see .env.example)'}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">Keys never live in the browser. All AI calls proxy through /api/ai/*.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Model</label>
                  <select value={provider.defaultModel} onChange={e => setAiProviders(prev => prev.map((p, i) => i === idx ? { ...p, defaultModel: e.target.value } : p))}
                    className={I + ' text-xs'}>
                    {provider.models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              {provider.id === 'openrouter' && (
                <p className="text-xs text-gray-400 mt-2">
                  Free models: google/gemini-2.0-flash-exp:free, meta-llama/llama-3.1-8b-instruct:free
                  <br />Paid models require credits. <a href="https://openrouter.ai/docs" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Docs</a>
                </p>
              )}
              {provider.id === 'gemini' && (
                <p className="text-xs text-gray-400 mt-2">
                  Free tier: 1,500 requests/day. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Get API key</a>
                </p>
              )}
              {provider.id === 'deepseek' && (
                <p className="text-xs text-gray-400 mt-2">
                  Budget-friendly and fast. <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Get API key</a>
                </p>
              )}
            </div>
          ))}
        </div>
        {saving && (
          <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-xl text-purple-700 text-sm flex items-center gap-2">
            <CheckCircle size={16} /> AI Providers saved successfully!
          </div>
        )}
        <button type="button" onClick={() => save(aiProviders)}
          className="mt-4 px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors w-full sm:w-auto justify-center">
          <Save size={16} /> Save All AI Providers
        </button>
      </div>

      {/* Quick Start Cards */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wand2 size={18} className="text-blue-600" />
            <h3 className="font-bold text-sm">AI Product Import</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3">Paste any product URL from AliExpress, Amazon, eBay, Etsy, Walmart, Temu — AI extracts all details.</p>
          <button onClick={() => navigate('/admin/ai-import')} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors">
            Launch Import →
          </button>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Megaphone size={18} className="text-green-600" />
            <h3 className="font-bold text-sm">AI Content Generators</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3">Generate product descriptions, ad copy, emails, social posts, blog ideas with AI.</p>
          <button onClick={() => navigate('/admin/marketing')} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-semibold transition-colors">
            Open Marketing →
          </button>
        </div>
        <div className="bg-gradient-to-br from-sky-50 to-orange-50 border border-sky-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Search size={18} className="text-blue-600" />
            <h3 className="font-bold text-sm">SEO Engine</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3">AI-powered SEO optimization: meta tags, structured data, keyword analysis, content scoring.</p>
          <button onClick={() => navigate('/admin/seo-engine')} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors">
            Open SEO Engine →
          </button>
        </div>
        <div className="bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Layers size={18} className="text-pink-600" />
            <h3 className="font-bold text-sm">Variant Generator</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3">AI generates product variants (colors, sizes, materials) with SKUs and pricing.</p>
          <button onClick={() => navigate('/admin/variant-gen')} className="px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-xl text-xs font-semibold transition-colors">
            Open Variant Gen →
          </button>
        </div>
      </div>

      {/* Scraping Configuration */}
      <div className="bg-white rounded-2xl border border-green-200 p-5">
        <h2 className="font-bold text-sm text-gray-700 mb-4 flex items-center gap-2">
          <Link2 size={16} className="text-green-500" /> Web Scraping Configuration
        </h2>
        <div className="rounded-xl border border-dashed border-green-300 bg-green-50 p-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-green-700">scrape.do — Free Web Scraper</p>
            <p className="text-xs text-green-600 mt-0.5">1,000 free requests/month · No credit card · Permanent free tier</p>
          </div>
          <ol className="text-xs text-green-700 space-y-1 list-decimal list-inside">
            <li>Go to scrape.do and create a free account</li>
            <li>Add your token as the <span className="font-mono">SCRAPE_DO_TOKEN</span> environment variable on the server (see .env.example)</li>
            <li>Credential-backed scraping then runs through /api/fetch-page — the token never ships to the browser</li>
          </ol>
          <div className="p-3 bg-white/60 border border-green-200 rounded-xl text-xs text-green-800">
            🔒 Luxedge V2: scraping tokens are server-side only. Without a server token, URL import falls back to public proxies.
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// AI PRODUCT IMPORT ENGINE
// ============================================================================
const SUPPORTED_PLATFORMS = ['AliExpress','Alibaba','Amazon','eBay','Etsy','Walmart','Temu','CJ Dropshipping','Daraz','Shopify Stores','Any public product page'];

function detectPlatform(url: string): string | null {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes('aliexpress.com') || u.includes('aliexpress.us')) return 'AliExpress';
  if (u.includes('alibaba.com')) return 'Alibaba';
  if (u.includes('amazon.com') || u.includes('amzn.to')) return 'Amazon';
  if (u.includes('ebay.com') || u.includes('ebay.co')) return 'eBay';
  if (u.includes('etsy.com')) return 'Etsy';
  if (u.includes('walmart.com')) return 'Walmart';
  if (u.includes('temu.com')) return 'Temu';
  if (u.includes('daraz.pk') || u.includes('daraz.com')) return 'Daraz';
  if (u.includes('cjdropshipping.com')) return 'CJ Dropshipping';
  if (u.includes('myshopify.com') || u.includes('shopify.com')) return 'Shopify Store';
  if (u.startsWith('http')) return 'Website';
  return null;
}

function ConfidenceBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-600 bg-green-50' : score >= 50 ? 'text-blue-600 bg-sky-50' : 'text-red-500 bg-red-50';
  return <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${color}`}>{score}%</span>;
}

function AAIImport() {
  const { setProducts, notify } = useApp();
  const navigate = useNavigate();

  type ImportSource = 'url'|'html'|'text'|'clipboard'|'image';
  type ImportStep = 'source'|'input'|'processing'|'preview'|'done'|'history';

  const [step, setStep] = useState<ImportStep>('source');
  const [source, setSource] = useState<ImportSource>('url');

  // Inputs
  const [urlInput, setUrlInput] = useState('');
  const [htmlInput, setHtmlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{msg:string;ok:boolean}[]>([]);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<any>(null);

  // Results
  const [extracted, setExtracted] = useState<AIExtractedProduct|null>(null);
  const [editField, setEditField] = useState<Partial<AIExtractedProduct>>({});
  const [selectedImgs, setSelectedImgs] = useState<string[]>([]);
  const [heroImg, setHeroImg] = useState('');

  // Providers
  const [aiProviders] = useState<AIProvider[]>(() => {
    return loadAIProviders();
  });

  // History
  const [history, setHistory] = useState<ImportHistoryEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('luxedge_import_history')||'[]'); }
    catch { return []; }
  });

  const addLog = (msg: string, ok=true) => setProgress(p => [...p, {msg, ok}]);

  const startTimer = () => {
    const t0 = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now()-t0)/1000)), 200);
  };
  const stopTimer = () => { clearInterval(timerRef.current); };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    if (text) setTextInput(text);
  }, []);

  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => { setTextInput(`[Image uploaded: ${file.name}] ${ev.target?.result as string}`); };
      reader.readAsDataURL(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setTextInput(`[Image: ${file.name}] ${dataUrl}`);
        addLog(`Image loaded: ${file.name}`);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImport = async () => {
    setLoading(true); setError(''); setProgress([]); setElapsed(0);
    setStep('processing'); startTimer();
    try {
      let rawContent = '';
      let pageImages: string[] = [];

      if (source === 'url') {
        if (!urlInput.trim()) throw new Error('Please enter a URL');
        addLog(`Fetching: ${urlInput}`);
        const pageData = await fetchPageContent(urlInput.trim());
        const parsed = JSON.parse(pageData);
        rawContent = parsed.text;
        pageImages = parsed.images || [];
        addLog(`Page fetched — ${rawContent.length} chars, ${pageImages.length} images found`, true);
      } else if (source === 'html') {
        if (!htmlInput.trim()) throw new Error('Please paste some HTML');
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlInput, 'text/html');
        doc.querySelectorAll('script,style').forEach(el => el.remove());
        pageImages = [];
        doc.querySelectorAll('img').forEach(img => {
          const src = img.getAttribute('src')||img.getAttribute('data-src')||'';
          if (src.startsWith('http')) pageImages.push(src);
        });
        rawContent = doc.body?.innerText || htmlInput;
        addLog(`HTML processed — ${rawContent.length} chars, ${pageImages.length} images`, true);
      } else if (source === 'text' || source === 'clipboard') {
        if (!textInput.trim()) throw new Error('Please paste some content');
        rawContent = textInput;
        addLog(`Content ready — ${rawContent.length} chars`, true);
      } else if (source === 'image') {
        if (!textInput.includes('[Image')) throw new Error('Please upload an image first');
        rawContent = `Product image provided. Extract product information from this image description. Image data: ${textInput.slice(0,200)}...`;
        addLog('Image content prepared', true);
      }

      addLog('Sending to AI for analysis…');
      const prompt = buildExtractionPrompt(rawContent, source);
      const aiText = await callAIProvider(prompt, aiProviders, (m) => addLog(m));

      addLog('Parsing AI response…');
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('AI returned invalid response. Please try again.');
      const data = JSON.parse(jsonMatch[0]) as AIExtractedProduct;

      // Merge page images with AI-found images
      const allImages = [...new Set([...(data.images||[]), ...pageImages])].filter(u => u.startsWith('http')).slice(0, 24);
      data.images = allImages;

      setExtracted(data);
      setEditField({...data});
      setSelectedImgs(allImages.slice(0, 6));
      setHeroImg(allImages[0] || '');

      // Save history
      const activeProvider = aiProviders.find(p => p.isDefault && p.enabled) || aiProviders.find(p => p.enabled);
      const entry: ImportHistoryEntry = {
        id: `imp-${Date.now()}`, source: source === 'url' ? urlInput : source, sourceType: source,
        date: new Date().toISOString(), provider: activeProvider?.name||'Unknown',
        model: activeProvider?.defaultModel||'Unknown', productTitle: data.title,
        status: 'success', importTime: elapsed * 1000
      };
      const newHist = [entry, ...history].slice(0, 50);
      setHistory(newHist);
      localStorage.setItem('luxedge_import_history', JSON.stringify(newHist));

      addLog(`✓ Done in ${elapsed}s — ready to review!`, true);
      setStep('preview');

    } catch (e: any) {
      setError(e.message||'Import failed');
      addLog(`✗ ${e.message}`, false);
      setStep('input');
    } finally { setLoading(false); stopTimer(); }
  };

  const handleSave = () => {
    if (!extracted) return;
    const ef = editField;
    const product: any = {
      id: `ai-${Date.now()}`,
      name: ef.title || extracted.title,
      shortDesc: ef.shortDescription || extracted.shortDescription || '',
      description: ef.longDescription || extracted.longDescription || '',
      price: Number(ef.sellingPrice ?? extracted.sellingPrice) || 0,
      originalPrice: Number(ef.comparePrice ?? extracted.comparePrice) || 0,
      category: ef.category || extracted.category || 'Uncategorized',
      stock: Number(ef.stock ?? extracted.stock) || 100,
      images: selectedImgs.length ? selectedImgs : ['https://images.pexels.com/photos/5632371/pexels-photo-5632371.jpeg'],
      rating: 0, reviews: 0, isActive: false,
      brand: ef.brand || extracted.brand || 'Luxedge',
      condition: 'New',
      tags: ef.tags || extracted.tags || [],
      weight: ef.weight || extracted.weight || '',
      dimensions: ef.dimensions || extracted.dimensions || '',
      origin: ef.origin || extracted.origin || '',
      freeShipping: true, shippingCost: '0', variants: [],
    };
    setProducts(prev => [product, ...prev]);
    notify(`"${product.name}" saved as Draft!`);
    setStep('done');
  };

  const EF = (field: keyof AIExtractedProduct) => ({
    value: (editField[field] ?? extracted?.[field] ?? '') as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>) =>
      setEditField(prev => ({...prev, [field]: e.target.value} as Partial<AIExtractedProduct>))
  });

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';

  // ── SOURCE SELECTION ──
  if (step === 'source') {
    const sources = [
      { id:'url', icon:<Link2 size={24}/>, label:'URL Import', desc:'Paste any product URL', color:'bg-blue-50 border-blue-200 hover:border-blue-400', iconColor:'text-blue-600' },
      { id:'html', icon:<FileText size={24}/>, label:'HTML Import', desc:'Paste copied HTML', color:'bg-orange-50 border-orange-200 hover:border-orange-400', iconColor:'text-orange-600' },
      { id:'text', icon:<PenLine size={24}/>, label:'Text Import', desc:'Paste product description', color:'bg-green-50 border-green-200 hover:border-green-400', iconColor:'text-green-600' },
      { id:'clipboard', icon:<Clipboard size={24}/>, label:'Clipboard', desc:'Ctrl+V anywhere to paste', color:'bg-purple-50 border-purple-200 hover:border-purple-400', iconColor:'text-purple-600' },
      { id:'image', icon:<ImageIcon size={24}/>, label:'Image Upload', desc:'JPG, PNG, WEBP, GIF', color:'bg-pink-50 border-pink-200 hover:border-pink-400', iconColor:'text-pink-600' },
    ];
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center">
            <Bot size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">AI Product Import Engine</h1>
            <p className="text-sm text-gray-500">Import any product in under 60 seconds using AI</p>
          </div>
          <button onClick={() => setStep('history')} className="ml-auto flex items-center gap-2 px-4 py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            <History size={16} /> History ({history.length})
          </button>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Choose Import Source</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sources.map(s => (
              <button key={s.id} onClick={() => { setSource(s.id as ImportSource); setStep('input'); }}
                className={`border-2 rounded-2xl p-5 text-left transition-all ${s.color} ${source===s.id?'ring-2 ring-offset-1':''}`}>
                <div className={`mb-3 ${s.iconColor}`}>{s.icon}</div>
                <p className="font-semibold text-gray-900">{s.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Supported Platforms</p>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_PLATFORMS.map(p => <span key={p} className="px-3 py-1 bg-white border text-xs rounded-full text-gray-600">{p}</span>)}
          </div>
        </div>
      </div>
    );
  }

  // ── INPUT STEP ──
  if (step === 'input') {
    return (
      <div className="space-y-5 max-w-2xl">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep('source')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors"><ArrowLeft size={20}/></button>
          <h1 className="text-xl font-bold">
            {source==='url'?'URL Import':source==='html'?'HTML Import':source==='clipboard'?'Clipboard Import':source==='image'?'Image Upload':'Text Import'}
          </h1>
        </div>

        {error && <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm"><AlertTriangle size={18} className="mt-0.5 shrink-0"/><div><p className="font-semibold">Import Failed</p><p>{error}</p></div></div>}

        {source === 'url' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Product URL</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleImport()}
                    className={inputCls + ' w-full'} placeholder="https://www.aliexpress.com/item/... or any product page URL" />
                  {urlInput.trim() && detectPlatform(urlInput) && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                      {detectPlatform(urlInput)}
                    </span>
                  )}
                </div>
                <button onClick={handleImport} disabled={!urlInput.trim()}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 whitespace-nowrap transition-colors">
                  <Wand2 size={16}/> Import
                </button>
              </div>
            </div>
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
              <p className="text-xs text-blue-700">
                <span className="font-semibold">Smart Import:</span> Paste any product URL — {
                  urlInput.trim() && detectPlatform(urlInput)
                    ? <span>detected as <span className="font-bold text-blue-800">{detectPlatform(urlInput)}</span> product</span>
                    : 'AI will extract title, price, images, specs, description, variants, SEO data automatically'
                }
              </p>
            </div>
            <div className="text-xs text-gray-500">
              <p className="font-medium mb-1">Supported platforms:</p>
              <div className="flex flex-wrap gap-1">{SUPPORTED_PLATFORMS.map(p=><span key={p} className="px-2 py-0.5 bg-gray-100 rounded">{p}</span>)}</div>
            </div>
          </div>
        )}

        {source === 'html' && (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Paste HTML Source Code</label>
            <textarea value={htmlInput} onChange={e=>setHtmlInput(e.target.value)}
              className={inputCls + ' min-h-[200px] font-mono text-xs'} placeholder="Paste the HTML of the product page here..." />
            <button onClick={handleImport} disabled={!htmlInput.trim()}
              className="mt-3 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
              <Wand2 size={16}/> Analyze HTML
            </button>
          </div>
        )}

        {(source === 'text' || source === 'clipboard') && (
          <div onPaste={handlePaste}>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {source==='clipboard' ? 'Press Ctrl+V to paste clipboard content' : 'Paste Product Text/Description'}
            </label>
            <textarea value={textInput} onChange={e=>setTextInput(e.target.value)}
              className={inputCls + ' min-h-[200px]'}
              placeholder={source==='clipboard' ? 'Click here and press Ctrl+V...' : 'Paste product title, description, features, specifications...'} />
            {source==='clipboard' && textInput && <p className="text-xs text-green-600 mt-1">✓ Content pasted ({textInput.length} chars)</p>}
            <button onClick={handleImport} disabled={!textInput.trim()}
              className="mt-3 px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
              <Wand2 size={16}/> {source==='clipboard'?'Import from Clipboard':'Analyze Text'}
            </button>
          </div>
        )}

        {source === 'image' && (
          <div>
            <div onDrop={handleImageDrop} onDragOver={e=>{e.preventDefault();setIsDragging(true)}} onDragLeave={()=>setIsDragging(false)}
              onClick={()=>fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${isDragging?'border-blue-400 bg-blue-50':'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}`}>
              <Upload size={32} className="mx-auto text-gray-400 mb-3"/>
              <p className="font-semibold text-gray-700">Drop image here or click to upload</p>
              <p className="text-xs text-gray-500 mt-1">PNG, JPG, JPEG, WEBP supported</p>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect}/>
            </div>
            {textInput.includes('[Image') && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm flex items-center gap-2">
                <CheckCircle size={16}/> Image loaded — AI will analyze it
              </div>
            )}
            <button onClick={handleImport} disabled={!textInput.includes('[Image')}
              className="mt-3 px-5 py-2.5 bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
              <Bot size={16}/> Analyze Image with AI
            </button>
          </div>
        )}

        <div className="border rounded-xl p-4 bg-sky-50 border-sky-200">
          <p className="text-xs font-semibold text-blue-700 mb-1">⚡ AI Provider</p>
          {(() => {
            const active = aiProviders.find(p=>p.isDefault&&p.enabled) || aiProviders.find(p=>p.enabled);
            return active
              ? <p className="text-xs text-blue-800">{active.name} · {active.defaultModel}</p>
              : <p className="text-xs text-red-600">No AI provider configured! <button onClick={()=>navigate('/admin/settings')} className="underline">Go to Settings → AI Providers</button></p>;
          })()}
        </div>
      </div>
    );
  }

  // ── PROCESSING STEP ──
  if (step === 'processing') {
    return (
      <div className="space-y-6 max-w-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center animate-pulse">
            <Bot size={22} className="text-white"/>
          </div>
          <div>
            <h1 className="text-xl font-bold">AI is analyzing your product…</h1>
            <p className="text-sm text-gray-500 font-mono">{elapsed}s elapsed</p>
          </div>
        </div>
        <div className="bg-gray-900 rounded-2xl p-5 min-h-[200px] font-mono text-sm space-y-1.5">
          {progress.map((p,i) => (
            <div key={i} className={`flex items-start gap-2 ${p.ok?'text-green-400':'text-red-400'}`}>
              <span className="text-gray-600 text-xs mt-0.5">[{String(i+1).padStart(2,'0')}]</span>
              <span>{p.msg}</span>
            </div>
          ))}
          {loading && <div className="flex items-center gap-2 text-blue-400"><Loader2 size={14} className="animate-spin"/><span>Processing…</span></div>}
        </div>
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-red-700 text-sm font-semibold">{error}</p>
            <button onClick={()=>setStep('input')} className="mt-3 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium">← Try Again</button>
          </div>
        )}
      </div>
    );
  }

  // ── PREVIEW STEP ──
  if (step === 'preview' && extracted) {
    const conf = extracted.confidence || {};
    const PreviewField = ({ label, field, multiline=false, conf: c=0 }: {label:string;field:keyof AIExtractedProduct;multiline?:boolean;conf?:number}) => (
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</label>
          {c > 0 && <ConfidenceBadge score={c}/>}
        </div>
        {multiline
          ? <textarea {...EF(field)} className={inputCls + ' text-sm min-h-[80px]'}/>
          : <input {...EF(field)} className={inputCls + ' text-sm'}/>
        }
      </div>
    );

    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={()=>setStep('input')} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={20}/></button>
          <div>
            <h1 className="text-xl font-bold">Review & Edit</h1>
            <p className="text-sm text-gray-500">AI extracted {Object.keys(extracted).length} fields — edit any before saving</p>
          </div>
          <button onClick={handleSave} className="ml-auto px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shadow-lg shadow-green-200">
            <CheckCircle size={16}/> Save as Draft Product
          </button>
        </div>

        <div className="grid lg:grid-cols-2 gap-5">
          {/* LEFT — Core Fields */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border p-5 space-y-4">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><Package size={16} className="text-blue-500"/>Product Info</h2>
              <PreviewField label="Product Title" field="title" conf={conf.title}/>
              <PreviewField label="Luxury Title (Premium)" field="luxuryTitle"/>
              <PreviewField label="SEO Title" field="seoTitle" conf={conf.category}/>
              <PreviewField label="Brand" field="brand" conf={conf.brand}/>
              <div className="grid grid-cols-2 gap-3">
                <PreviewField label="Category" field="category" conf={conf.category}/>
                <PreviewField label="Subcategory" field="subcategory"/>
              </div>
              <PreviewField label="SKU" field="sku"/>
              <PreviewField label="Origin" field="origin"/>
            </div>

            <div className="bg-white rounded-2xl border p-5 space-y-4">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><DollarSign size={16} className="text-green-500"/>Pricing</h2>
              <div className="grid grid-cols-3 gap-3">
                <PreviewField label="Sell Price ($)" field="sellingPrice" conf={conf.price}/>
                <PreviewField label="Compare Price ($)" field="comparePrice"/>
                <PreviewField label="Cost Price ($)" field="costPrice"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <PreviewField label="Stock" field="stock"/>
                <PreviewField label="Weight" field="weight"/>
              </div>
            </div>

            <div className="bg-white rounded-2xl border p-5 space-y-4">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><FileText size={16} className="text-purple-500"/>Descriptions</h2>
              <PreviewField label="Short Description" field="shortDescription" multiline conf={conf.description}/>
              <PreviewField label="Long Description" field="longDescription" multiline/>
            </div>

            <div className="bg-white rounded-2xl border p-5 space-y-4">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><Globe size={16} className="text-blue-500"/>SEO</h2>
              <PreviewField label="Slug" field="slug"/>
              <PreviewField label="Meta Title" field="metaTitle"/>
              <PreviewField label="Meta Description" field="metaDescription" multiline/>
              <PreviewField label="Focus Keyword" field="focusKeyword"/>
            </div>
          </div>

          {/* RIGHT — Images + Extra */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><ImageIcon size={16} className="text-pink-500"/>Images ({extracted.images?.length||0} found)</h2>
                <span className="text-xs text-gray-500">{selectedImgs.length} selected</span>
              </div>
              {extracted.images?.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {extracted.images.slice(0,18).map((img,i) => {
                    const isSelected = selectedImgs.includes(img);
                    const isHero = heroImg === img;
                    return (
                      <div key={i} className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${isSelected?'border-blue-500':'border-transparent'}`}
                        onClick={()=>{ setSelectedImgs(prev => isSelected ? prev.filter(x=>x!==img) : [...prev, img]); if(!heroImg) setHeroImg(img); }}>
                        <img src={img} className="w-full h-20 object-cover" onError={e=>(e.currentTarget.style.display='none')} alt=""/>
                        {isSelected && <div className="absolute top-1 right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center"><CheckCircle size={12} className="text-white"/></div>}
                        {isHero && <div className="absolute bottom-0 left-0 right-0 bg-blue-500 text-white text-[10px] text-center font-bold py-0.5">HERO</div>}
                        {!isHero && isSelected && <button type="button" className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5 hover:bg-blue-500 transition-colors"
                          onClick={e=>{e.stopPropagation();setHeroImg(img);}}>Set Hero</button>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <ImageIcon size={32} className="mx-auto mb-2 opacity-40"/>
                  <p className="text-sm">No images found. Add image URLs manually.</p>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button onClick={()=>setSelectedImgs(extracted.images?.slice(0,12)||[])} className="text-xs text-blue-600 hover:underline">Select All</button>
                <span className="text-gray-300">|</span>
                <button onClick={()=>setSelectedImgs([])} className="text-xs text-gray-500 hover:underline">Clear</button>
              </div>
            </div>

            {/* Features & Tags */}
            <div className="bg-white rounded-2xl border p-5 space-y-3">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><Sparkles size={16} className="text-blue-500"/>Features & Tags</h2>
              {extracted.features?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Features</p>
                  <ul className="space-y-1">
                    {extracted.features.slice(0,6).map((f,i) => <li key={i} className="text-sm text-gray-700 flex items-start gap-2"><span className="text-green-500 mt-0.5">✓</span>{f}</li>)}
                  </ul>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Tags</p>
                <div className="flex flex-wrap gap-1">{(extracted.tags||[]).map(t=><span key={t} className="px-2 py-0.5 bg-gray-100 text-xs rounded-full text-gray-600">{t}</span>)}</div>
              </div>
              {(extracted.colors?.length||0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Colors</p>
                  <div className="flex flex-wrap gap-1">{extracted.colors?.map(c=><span key={c} className="px-2 py-0.5 border text-xs rounded-full">{c}</span>)}</div>
                </div>
              )}
              {(extracted.sizes?.length||0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Sizes</p>
                  <div className="flex flex-wrap gap-1">{extracted.sizes?.map(s=><span key={s} className="px-2 py-0.5 border text-xs rounded-full">{s}</span>)}</div>
                </div>
              )}
            </div>

            {/* Specs */}
            {Object.keys(extracted.specifications||{}).length > 0 && (
              <div className="bg-white rounded-2xl border p-5">
                <h2 className="font-bold text-sm text-gray-700 mb-3 flex items-center gap-2"><Tag size={16} className="text-gray-500"/>Specifications</h2>
                <div className="space-y-1.5">
                  {Object.entries(extracted.specifications).slice(0,12).map(([k,v]) => (
                    <div key={k} className="flex text-sm">
                      <span className="w-2/5 text-gray-500 text-xs font-medium pr-2 leading-5">{k}</span>
                      <span className="flex-1 text-gray-800 text-xs leading-5">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Confidence Overview */}
            <div className="bg-white rounded-2xl border p-5">
              <h2 className="font-bold text-sm text-gray-700 mb-3 flex items-center gap-2"><Star size={16} className="text-blue-500"/>AI Confidence Scores</h2>
              <div className="space-y-2">
                {Object.entries(conf).map(([k,v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-24 capitalize">{k}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${Number(v)>=80?'bg-green-500':Number(v)>=50?'bg-sky-400':'bg-red-400'}`} style={{width:`${v}%`}}/>
                    </div>
                    <span className="text-xs font-bold text-gray-600 w-8 text-right">{v}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="sticky bottom-0 bg-white border-t p-4 -mx-6 flex items-center justify-between gap-4">
          <p className="text-sm text-gray-500">Product will be saved as <span className="font-semibold text-gray-700">Draft</span> — you can publish it from Products page.</p>
          <button onClick={handleSave} className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shadow-lg shadow-green-200">
            <CheckCircle size={18}/> Save Product
          </button>
        </div>
      </div>
    );
  }

  // ── DONE ──
  if (step === 'done') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-5">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
          <CheckCircle size={40} className="text-green-500"/>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Imported!</h1>
          <p className="text-gray-500 mt-1">Saved as Draft — publish it when ready</p>
        </div>
        <div className="flex gap-3">
          <button onClick={()=>navigate('/admin/products')} className="px-6 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold flex items-center gap-2">
            <Package size={16}/> View Products
          </button>
          <button onClick={()=>{ setStep('source'); setExtracted(null); setEditField({}); setSelectedImgs([]); setUrlInput(''); setTextInput(''); setHtmlInput(''); }}
            className="px-6 py-2.5 border rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-2">
            <RefreshCw size={16}/> Import Another
          </button>
        </div>
      </div>
    );
  }

  // ── HISTORY ──
  if (step === 'history') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={()=>setStep('source')} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={20}/></button>
          <h1 className="text-xl font-bold">Import History</h1>
        </div>
        {history.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <History size={40} className="mx-auto mb-3 opacity-40"/>
            <p>No imports yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map(h => (
              <div key={h.id} className="bg-white border rounded-xl p-4 flex items-center gap-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${h.status==='success'?'bg-green-100':'bg-red-100'}`}>
                  {h.status==='success'?<CheckCircle size={18} className="text-green-600"/>:<AlertTriangle size={18} className="text-red-500"/>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 truncate">{h.productTitle}</p>
                  <p className="text-xs text-gray-500">{new Date(h.date).toLocaleDateString()} · {h.provider} · {(h.importTime/1000).toFixed(1)}s</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${h.sourceType==='url'?'bg-blue-100 text-blue-700':h.sourceType==='html'?'bg-orange-100 text-orange-700':'bg-gray-100 text-gray-600'}`}>{h.sourceType}</span>
              </div>
            ))}
          </div>
        )}
        {history.length > 0 && (
          <button onClick={()=>{ setHistory([]); localStorage.removeItem('luxedge_import_history'); }}
            className="text-sm text-red-500 hover:text-red-700">Clear History</button>
        )}
      </div>
    );
  }

  return null;
}


// ============================================================================
// ADMIN — MARKETING & TRAFFIC
// ============================================================================
function AMarketingTraffic() {
  const { notify } = useApp();
  const [globalCfg, setGlobalCfg] = useState<MarketingConfig | null>(null);
  const [cfg, setCfg] = useState<MarketingConfig>(() => JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [adsTxtStatus, setAdsTxtStatus] = useState<'checking' | 'configured' | 'missing' | 'invalid'>('checking');
  const [hasPreview, setHasPreview] = useState(hasPreviewConfig());

  useEffect(() => {
    fetchGlobalConfig().then(g => {
      setGlobalCfg(g);
      const preview = hasPreviewConfig() ? getCachedPreview() : null;
      setCfg(JSON.parse(JSON.stringify(preview || g)));
      setHasPreview(hasPreviewConfig());
    });
  }, []);

  const set = (patch: Partial<MarketingConfig>) => setCfg(c => ({ ...c, ...patch }));
  const setEx = (k: keyof MarketingConfig['exclusions'], v: boolean) => setCfg(c => ({ ...c, exclusions: { ...c.exclusions, [k]: v } }));
  const setPl = (k: PlacementKey, patch: Partial<{ enabled: boolean; slot: string }>) => setCfg(c => ({ ...c, placements: { ...c.placements, [k]: { ...c.placements[k], ...patch } } }));

  const checkAdsTxt = async () => {
    try {
      const r = await fetch('/ads.txt');
      if (!r.ok) { setAdsTxtStatus('missing'); return; }
      const txt = (await r.text()).trim();
      const expected = (cfg.adsTxtRecord || DEFAULT_CONFIG.adsTxtRecord).trim();
      if (txt === expected) setAdsTxtStatus('configured');
      else if (txt.includes('pub-')) setAdsTxtStatus('invalid');
      else setAdsTxtStatus('missing');
    } catch {
      setAdsTxtStatus('missing');
    }
  };
  useEffect(() => { checkAdsTxt(); }, []);

  const handleSave = () => {
    const errs = validateConfig(cfg);
    setErrors(errs);
    if (Object.keys(errs).length > 0) { notify('Please fix the validation errors', 'error'); return; }
    savePreviewConfig(cfg);
    setHasPreview(true);
    setSaved(true);
    notify('Marketing settings saved (preview for this browser)');
    setTimeout(() => setSaved(false), 3000);
  };

  const handleTest = async () => {
    const errs = validateConfig(cfg);
    setErrors(errs);
    if (Object.keys(errs).length > 0) { setTestResult({ ok: false, msg: 'Configuration has validation errors — fix them first.' }); return; }
    await checkAdsTxt();
    const clientOk = CLIENT_ID_RE.test(cfg.adsenseClientId.trim());
    const mode = activeModeLabel(cfg);
    const bits: string[] = [];
    if (cfg.adsenseEnabled && clientOk) bits.push('AdSense script would load with ' + cfg.adsenseClientId);
    if (cfg.autoAdsEnabled) bits.push('Auto Ads on');
    if (adsTxtStatus === 'configured') bits.push('ads.txt present at /ads.txt');
    if (cfg.gaEnabled && cfg.ga4Id) bits.push('GA4 script would load for ' + cfg.ga4Id);
    setTestResult({ ok: true, msg: `OK — ${mode}. ${bits.join(' · ') || 'Nothing enabled yet.'} Note: this only confirms code config; it is NOT a Google approval.` });
  };

  const copyAdsTxt = async () => {
    try { await navigator.clipboard.writeText(cfg.adsTxtRecord); notify('ads.txt entry copied'); }
    catch { notify('Copy failed — select the text manually', 'error'); }
  };

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'site-config.json';
    a.click();
    URL.revokeObjectURL(url);
    notify('Downloaded site-config.json — commit it to the repo to make these settings global for all visitors');
  };

  const resetGlobal = () => {
    clearPreviewConfig();
    setHasPreview(false);
    if (globalCfg) setCfg(JSON.parse(JSON.stringify(globalCfg)));
    setErrors({});
    notify('Local preview cleared — now using the deployed global config');
  };

  const Toggle = ({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) => (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${on ? 'bg-blue-600' : 'bg-gray-300'}`} role="switch" aria-checked={on} aria-label={label}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );

  const I = 'w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all bg-white';
  const L = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
  const Card = ({ title, icon, badge, children }: { title: string; icon: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode }) => (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sm flex items-center gap-2">{icon}{title}</h2>
        {badge}
      </div>
      <div className="p-5 space-y-5">{children}</div>
    </div>
  );

  const StatusPill = ({ ok, text }: { ok: boolean; text: string }) => (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-gray-400'}`} />{text}
    </span>
  );

  const enabledPlacements = PLACEMENT_KEYS.filter(k => cfg.placements[k].enabled && AD_SLOT_RE.test(cfg.placements[k].slot.trim()));
  const adsenseOk = cfg.adsenseEnabled && CLIENT_ID_RE.test(cfg.adsenseClientId.trim());

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Marketing &amp; Traffic</h1>
        <div className="flex items-center gap-2">
          {hasPreview && <StatusPill ok text="Local preview active (this browser)" />}
          <span className="text-[11px] text-gray-400">Code installed ≠ Google approved</span>
        </div>
      </div>

      {/* Traffic Overview */}
      <Card title="Traffic Overview" icon={<TrendingUp size={18} className="text-blue-600" />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Google AdSense</p>
            <p className="font-semibold">{adsenseOk ? 'Configured' : cfg.adsenseEnabled ? 'Invalid config' : 'Disabled'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Auto Ads</p>
            <p className="font-semibold">{adsenseOk && cfg.autoAdsEnabled ? 'Enabled' : 'Disabled'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">ads.txt</p>
            <p className="font-semibold">{adsTxtStatus === 'configured' ? 'Configured' : adsTxtStatus === 'checking' ? 'Checking…' : 'Missing / Invalid'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Manual Ad Units</p>
            <p className="font-semibold">{enabledPlacements.length > 0 ? `${enabledPlacements.length} enabled` : 'None enabled'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Google Analytics</p>
            <p className="font-semibold">{cfg.gaEnabled && cfg.ga4Id ? `Connected (${cfg.ga4Id})` : 'Not configured'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Publisher</p>
            <p className="font-semibold text-[13px]">{cfg.publisherId || '—'}</p>
          </div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 leading-relaxed">
          <strong>Active mode:</strong> {activeModeLabel(cfg)}.
          {!adsenseOk && cfg.adsenseEnabled ? ' Fix the Client ID to enable ads.' : ''}
          These are configuration status cards — no visitor traffic numbers are shown here.
        </div>
      </Card>

      {/* Google AdSense */}
      <Card title="Google AdSense" icon={<Megaphone size={18} className="text-blue-600" />} badge={<StatusPill ok={adsenseOk} text={adsenseOk ? 'Configured' : 'Not configured'} />}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Enable Google AdSense</p>
            <p className="text-xs text-gray-400 mt-0.5">Loads the AdSense script on the public storefront.</p>
          </div>
          <Toggle on={cfg.adsenseEnabled} onChange={v => set({ adsenseEnabled: v })} label="Enable Google AdSense" />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={L}>AdSense Client ID</label>
            <input className={I + (errors.adsenseClientId ? ' border-red-300' : '')} value={cfg.adsenseClientId}
              onChange={e => set({ adsenseClientId: e.target.value, publisherId: e.target.value.trim().startsWith('ca-pub-') ? e.target.value.trim().replace('ca-', '') : cfg.publisherId })} />
            {errors.adsenseClientId ? <p className="text-red-500 text-xs mt-1">{errors.adsenseClientId}</p>
              : <p className="text-xs text-gray-400 mt-1">Public Google AdSense publisher/client identifier. This is not a secret API key.</p>}
          </div>
          <div>
            <label className={L}>Publisher ID</label>
            <input className={I + (errors.publisherId ? ' border-red-300' : '')} value={cfg.publisherId}
              onChange={e => set({ publisherId: e.target.value })} />
            {errors.publisherId ? <p className="text-red-500 text-xs mt-1">{errors.publisherId}</p>
              : <p className="text-xs text-gray-400 mt-1">Kept in sync with the Client ID.</p>}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Enable Auto Ads</p>
            <p className="text-xs text-gray-400 mt-0.5">Lets Google decide ad placement automatically. Loads the script once.</p>
          </div>
          <Toggle on={cfg.autoAdsEnabled} onChange={v => set({ autoAdsEnabled: v })} label="Enable Auto Ads" />
        </div>
      </Card>

      {/* ads.txt */}
      <Card title="ads.txt" icon={<FileText size={18} className="text-blue-600" />} badge={
        <StatusPill ok={adsTxtStatus === 'configured'} text={adsTxtStatus === 'configured' ? 'Configured' : adsTxtStatus === 'checking' ? 'Checking…' : adsTxtStatus === 'invalid' ? 'Invalid' : 'Missing'} />
      }>
        <p className="text-xs text-gray-400">Served at <code className="bg-gray-100 px-1 rounded">https://luxedge.us/ads.txt</code> (committed in <code className="bg-gray-100 px-1 rounded">public/ads.txt</code>).</p>
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-gray-200 bg-gray-50 p-3">
          <code className="text-xs font-mono break-all">{cfg.adsTxtRecord}</code>
          <button onClick={copyAdsTxt} className="shrink-0 px-3.5 py-2 bg-white border border-gray-200 hover:border-blue-300 text-xs font-semibold rounded-lg text-gray-700 transition-colors">Copy ads.txt Entry</button>
        </div>
        {adsTxtStatus === 'missing' && <p className="text-xs text-amber-600">ads.txt was not found at /ads.txt in this environment.</p>}
      </Card>

      {/* Ad Placements */}
      <Card title="Ad Placements" icon={<Layers size={18} className="text-blue-600" />} badge={<StatusPill ok={enabledPlacements.length > 0} text={enabledPlacements.length > 0 ? `${enabledPlacements.length} enabled` : 'None enabled'} />}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Enable Manual Ad Units</p>
            <p className="text-xs text-gray-400 mt-0.5">Places ads at the configured spots below.</p>
          </div>
          <Toggle on={cfg.manualAdsEnabled} onChange={v => set({ manualAdsEnabled: v })} label="Enable Manual Ad Units" />
        </div>

        <div className="space-y-3">
          {PLACEMENT_KEYS.map(k => (
            <div key={k} className="rounded-xl border border-gray-100 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{PLACEMENT_LABELS[k]}</p>
                  {cfg.placements[k].enabled && !cfg.placements[k].slot.trim() && (
                    <p className="text-[11px] text-amber-600 mt-0.5">Create an ad unit in Google AdSense and paste its data-ad-slot ID here.</p>
                  )}
                  {errors[`slot_${k}`] && <p className="text-[11px] text-red-500 mt-0.5">{errors[`slot_${k}`]}</p>}
                </div>
                <Toggle on={cfg.placements[k].enabled} onChange={v => setPl(k, { enabled: v })} label={PLACEMENT_LABELS[k]} />
              </div>
              {cfg.placements[k].enabled && (
                <div className="mt-3">
                  <label className="text-[11px] font-semibold text-gray-500">Google Ad Slot ID</label>
                  <input className={I + ' mt-1' + (errors[`slot_${k}`] ? ' border-red-300' : '')} placeholder="1234567890"
                    value={cfg.placements[k].slot} onChange={e => setPl(k, { slot: e.target.value.replace(/\D/g, '') })} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Density, Mobile, Exclusions */}
      <Card title="Density & Controls" icon={<Sliders size={18} className="text-blue-600" />}>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={L}>Advertising Density (manual placements)</label>
            <select className={I} value={cfg.density} onChange={e => set({ density: e.target.value as MarketingConfig['density'] })}>
              <option value="low">Low</option><option value="balanced">Balanced</option><option value="high">High</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">Controls how many Luxedge-managed manual units render per page. Does not override Google Auto Ads.</p>
          </div>
          <div>
            <label className={L}>Mobile Manual Ad Density</label>
            <select className={I} value={cfg.mobileDensity} onChange={e => set({ mobileDensity: e.target.value as MarketingConfig['mobileDensity'] })} disabled={!cfg.showAdsOnMobile}>
              <option value="low">Low</option><option value="balanced">Balanced</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">Mobile stays light — fewer, non-overlapping units.</p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Show Ads on Mobile</p>
            <p className="text-xs text-gray-400 mt-0.5">Manual ad units on phones &amp; small screens.</p>
          </div>
          <Toggle on={cfg.showAdsOnMobile} onChange={v => set({ showAdsOnMobile: v })} label="Show Ads on Mobile" />
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Disable Ads On</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {([['cart', 'Cart'], ['checkout', 'Checkout'], ['login', 'Login'], ['signup', 'Signup'], ['admin', 'Admin'], ['account', 'Account pages']] as const).map(([k, label]) => (
              <label key={k} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2.5 text-sm cursor-pointer">
                <span>{label}</span>
                <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={cfg.exclusions[k]} onChange={e => setEx(k, e.target.checked)} />
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">Ads NEVER render inside the admin panel regardless of this setting.</p>
        </div>
      </Card>

      {/* Google Analytics */}
      <Card title="Google Analytics" icon={<Globe size={18} className="text-blue-600" />} badge={<StatusPill ok={!!cfg.gaEnabled && !!cfg.ga4Id} text={cfg.gaEnabled && cfg.ga4Id ? 'Connected' : 'Not configured'} />}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Enable Google Analytics (GA4)</p>
            <p className="text-xs text-gray-400 mt-0.5">Loads the gtag.js script and sends page_view + ecommerce events.</p>
          </div>
          <Toggle on={cfg.gaEnabled} onChange={v => set({ gaEnabled: v })} label="Enable Google Analytics" />
        </div>
        <div>
          <label className={L}>GA4 Measurement ID</label>
          <input className={I + (errors.ga4Id ? ' border-red-300' : '')} placeholder="G-XXXXXXXXXX"
            value={cfg.ga4Id} onChange={e => set({ ga4Id: e.target.value })} />
          {errors.ga4Id ? <p className="text-red-500 text-xs mt-1">{errors.ga4Id}</p>
            : <p className="text-xs text-gray-400 mt-1">Paste the GA4 Measurement ID from your Google Analytics property. No API key needed for standard browser tracking.</p>}
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">Events wired to real user actions: <code className="bg-gray-100 px-1 rounded">page_view</code>, <code className="bg-gray-100 px-1 rounded">view_item</code>, <code className="bg-gray-100 px-1 rounded">add_to_cart</code>, <code className="bg-gray-100 px-1 rounded">begin_checkout</code>, <code className="bg-gray-100 px-1 rounded">purchase</code>, <code className="bg-gray-100 px-1 rounded">search</code>. UTM campaign parameters are captured per session.</p>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={handleSave} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
          <Save size={16} /> Save Settings
        </button>
        <button onClick={handleTest} className="px-6 py-2.5 bg-white border border-gray-200 hover:border-blue-300 text-gray-700 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
          <RefreshCw size={16} /> Test Configuration
        </button>
        <button onClick={exportConfig} className="px-6 py-2.5 bg-white border border-gray-200 hover:border-blue-300 text-gray-700 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
          <Download size={16} /> Export site-config.json
        </button>
        {hasPreview && (
          <button onClick={resetGlobal} className="px-6 py-2.5 bg-white border border-gray-200 hover:border-red-300 text-gray-700 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <RotateCcw size={16} /> Reset to Global
          </button>
        )}
      </div>

      {saved && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
          <CheckCircle size={16} /> Settings saved as a preview for this browser. Download site-config.json and commit it to the repo to make these settings global for all visitors.
        </div>
      )}
      {testResult && (
        <div className={`flex items-start gap-2 p-3 rounded-xl text-sm ${testResult.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {testResult.ok ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          {testResult.msg}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 leading-relaxed">
        <strong className="text-gray-700">Global deployment note:</strong> This project is a static site served by Vercel with no backend. Browser
        localStorage only previews changes on this device. To make settings apply to <em>all</em> visitors, download
        <code className="bg-white px-1 rounded"> site-config.json </code>, commit it to the repo at
        <code className="bg-white px-1 rounded"> public/site-config.json </code>, and deploy. The <code className="bg-white px-1 rounded">ads.txt</code>
        file at the site root ships with every deploy. A cookie-consent banner is implemented on the storefront: AdSense and GA4 scripts only load
        after a visitor clicks "Accept All". If you serve personalized ads in the EEA/UK, connect a Google-certified CMP (Consent Management Platform)
        from your AdSense dashboard and paste its ID in the GA4 tag here.
      </div>
    </div>
  );
}


// ============================================================================
// ============================================================================
// ADMIN ROUTES — mounted by App.tsx under /admin/* (lazy-loaded)
// ============================================================================

// Error boundary so a render failure inside the admin chunk shows a message
// instead of unmounting the whole app.
class AdminErrorBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(err: unknown) { return { err: String((err as Error)?.message || err) }; }
  render() {
    if (this.state.err) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
          <div className="max-w-md w-full bg-white rounded-2xl border border-red-200 p-8 text-center shadow-sm">
            <AlertTriangle size={32} className="mx-auto mb-4 text-red-500" />
            <h1 className="text-lg font-bold text-gray-900 mb-2">Something went wrong in the admin area</h1>
            <p className="text-sm text-gray-500 mb-4">{this.state.err}</p>
            <a href="#/admin" className="inline-block px-5 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-sm font-semibold rounded-xl transition-colors">Retry</a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AdminSection() {
  return (
    <AdminErrorBoundary>
    {/* Nested Routes match RELATIVE to the parent /admin/* route (v6). */}
    <Routes>
      <Route path="" element={<AdminLayout><ADashboard /></AdminLayout>} />
      <Route path="products" element={<AdminLayout><AProducts /></AdminLayout>} />
      <Route path="products/new" element={<AdminLayout><AProductEdit /></AdminLayout>} />
      <Route path="products/edit/:id" element={<AdminLayout><AProductEdit /></AdminLayout>} />
      <Route path="orders" element={<AdminLayout><AOrders /></AdminLayout>} />
      <Route path="users" element={<AdminLayout><AUsers /></AdminLayout>} />
      <Route path="categories" element={<AdminLayout><ACategories /></AdminLayout>} />
      <Route path="reviews" element={<AdminLayout><AReviews /></AdminLayout>} />
      <Route path="blogs" element={<AdminLayout><ABlogs /></AdminLayout>} />
      <Route path="seo-engine" element={<AdminLayout><ASEOEngine /></AdminLayout>} />
      <Route path="marketing" element={<AdminLayout><AMarketingGen /></AdminLayout>} />
      <Route path="variant-gen" element={<AdminLayout><AVariantGen /></AdminLayout>} />
      <Route path="ai" element={<AdminLayout><AAIHub /></AdminLayout>} />
      <Route path="ai-import" element={<AdminLayout><AAIImport /></AdminLayout>} />
      <Route path="scout" element={<AdminLayout><ProductScout /></AdminLayout>} />
      <Route path="ai-control" element={<AdminLayout><AiControlCenter /></AdminLayout>} />
      <Route path="settings" element={<AdminLayout><ASettings /></AdminLayout>} />
      <Route path="marketing-traffic" element={<AdminLayout><AMarketingTraffic /></AdminLayout>} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
    </AdminErrorBoundary>
  );
}

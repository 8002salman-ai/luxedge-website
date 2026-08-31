// ============================================================================
// LUXEDGE — ADMIN BLOG MANAGER (Phase E)
//
// Database-backed blog CMS manager. Creating/editing/publishing a post here
// writes to Supabase `blog_posts`/`blog_revisions` — NO repo change, commit,
// build or deployment is ever needed for content operations. Publishing
// updates the storefront (via reloadBlogs), the worker SEO path and the
// dynamic sitemap automatically.
//
// Every write authorizes with the signed-in admin's JWT; RLS governs access.
// Revisions are appended on each create/edit/lifecycle change so Salman can
// recover any earlier version.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, FileText, Eye, Trash, PencilLine, Copy, Archive,
  ArrowCounterClockwise, MagnifyingGlass, FloppyDisk, CalendarPlus, CheckCircle,
} from '@phosphor-icons/react';
import { useApp } from '../App';
import {
  adminListAll, adminCreate, adminUpdate, adminSetLifecycle, adminDelete,
  adminListRevisions, adminRestoreRevision,
  type CmsBlogRow, type CmsBlogRevision,
} from '../services/blog';

const STATUS_META: Record<CmsBlogRow['status'], { label: string; cls: string }> = {
  published: { label: 'Published', cls: 'bg-green-100 text-green-700' },
  scheduled: { label: 'Scheduled', cls: 'bg-yellow-100 text-yellow-700' },
  draft: { label: 'Draft', cls: 'bg-gray-100 text-gray-600' },
  archived: { label: 'Archived', cls: 'bg-red-100 text-red-600' },
};

const slugify = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const emptyDraft = (): Omit<CmsBlogRow, 'id'> => ({
  slug: '', title: '', excerpt: null, content: '', hero_image_url: null, hero_image_alt: null,
  tags: [], author_name: 'Luxedge', author_id: null, status: 'draft',
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  scheduled_at: null, published_at: null, seo_title: null, meta_description: null,
  target_keyword: null, secondary_keywords: [], search_intent: null, faq: [], internal_links: [],
  generated_by: 'manual', automation_locked: false,
});

export default function BlogManager() {
  const { notify, reloadBlogs } = useApp();
  const [rows, setRows] = useState<CmsBlogRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CmsBlogRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Omit<CmsBlogRow, 'id'>>(emptyDraft());
  const [faqJson, setFaqJson] = useState('[]');
  const [tagsText, setTagsText] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [secondaryText, setSecondaryText] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CmsBlogRow['status']>('all');
  const [automationOnly, setAutomationOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; title: string; permanent: boolean } | null>(null);
  const [revisions, setRevisions] = useState<CmsBlogRevision[]>([]);
  const [showRevisionsFor, setShowRevisionsFor] = useState<string | null>(null);

  const load = async () => {
    try {
      setRows(await adminListAll());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message || 'Could not load blog posts.');
    }
  };
  useEffect(() => { void load(); }, []);

  const startCreate = () => {
    setCreating(true);
    setEditing(null);
    setForm(emptyDraft());
    setFaqJson('[]');
    setTagsText('');
    setKeywordsText('');
    setSecondaryText('');
  };

  const startEdit = (r: CmsBlogRow) => {
    setCreating(false);
    setEditing(r);
    setForm({ ...r });
    setFaqJson(JSON.stringify(r.faq || [], null, 2));
    setTagsText((r.tags || []).join(', '));
    setKeywordsText(r.target_keyword || '');
    setSecondaryText((r.secondary_keywords || []).join(', '));
    setShowRevisionsFor(null);
  };

  const toPatch = useMemo((): Partial<Omit<CmsBlogRow, 'id'>> => {
    let faq: { q: string; a: string }[] | null = null;
    try { faq = JSON.parse(faqJson); if (!Array.isArray(faq)) faq = null; } catch { faq = null; }
    return {
      slug: form.slug,
      title: form.title,
      excerpt: form.excerpt || null,
      content: form.content,
      hero_image_url: form.hero_image_url || null,
      hero_image_alt: form.hero_image_alt || null,
      tags: tagsText.split(',').map((s) => s.trim()).filter(Boolean),
      author_name: form.author_name || 'Luxedge',
      target_keyword: keywordsText.trim() || null,
      secondary_keywords: secondaryText.split(',').map((s) => s.trim()).filter(Boolean),
      faq: faq || [],
      ...(form.seo_title ? { seo_title: form.seo_title } : { seo_title: null }),
      ...(form.meta_description ? { meta_description: form.meta_description } : { meta_description: null }),
      ...(form.search_intent ? { search_intent: form.search_intent } : { search_intent: null }),
    };
  }, [form, faqJson, tagsText, keywordsText, secondaryText]);

  const saveDraft = async () => {
    if (!form.title.trim()) { notify('Title is required.', 'error'); return; }
    if (!form.slug.trim()) {
      const auto = slugify(form.title);
      if (!auto) { notify('A valid slug is required.', 'error'); return; }
      setForm((f) => ({ ...f, slug: auto }));
      // Let the state commit then retry next click; for now attempt with auto.
      return saveDraftWith(form.slug || auto);
    }
    return saveDraftWith(form.slug.trim());
  };

  const saveDraftWith = async (slug: string) => {
    setBusy(true);
    try {
      if (creating || (editing && form.status === 'draft' && !editing.published_at)) {
        if (creating) {
          await adminCreate({
            slug,
            title: form.title,
            content: form.content,
            excerpt: form.excerpt || undefined,
            heroImageUrl: form.hero_image_url || undefined,
            heroImageAlt: form.hero_image_alt || undefined,
            tags: form.tags || [],
            authorName: form.author_name || 'Luxedge',
            seoTitle: form.seo_title || undefined,
            metaDescription: form.meta_description || undefined,
            targetKeyword: form.target_keyword || undefined,
            secondaryKeywords: form.secondary_keywords || [],
            searchIntent: form.search_intent || undefined,
            faq: toPatch.faq || undefined,
          });
        } else if (editing) {
          await adminUpdate(editing.id, toPatch);
        }
      } else {
        // Saving an existing published/scheduled post keeps its status; only edit content.
        await adminUpdate(editing!.id, toPatch);
      }
      notify('Saved.');
      await reloadBlogs();
      setCreating(false); setEditing(null);
      await load();
    } catch (e) {
      notify((e as Error).message || 'Save failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const lifecycle = async (action: 'publish' | 'unpublish' | 'archive' | 'restore', id: string) => {
    setBusy(true);
    try {
      await adminSetLifecycle(id, action);
      const target = (rows || []).find((r) => r.id === id);
      const liveUrl = target?.slug ? `/blog/${target.slug}` : '';
      const notice =
        action === 'publish'
          ? `Published live ✓ ${liveUrl}`
          : action === 'unpublish'
            ? 'Unpublished — moved to drafts.'
            : `Post ${action}.`;
      notify(notice);
      await reloadBlogs();
      await load();
    } catch (e) {
      notify((e as Error).message || 'Action failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const schedule = async (id: string) => {
    const at = window.prompt('Publish at (YYYY-MM-DDTHH:MM, local time):', '');
    if (at == null) return;
    if (!at.trim()) { notify('Schedule cancelled.', 'info'); return; }
    const iso = new Date(at.trim()).toISOString();
    setBusy(true);
    try {
      await adminSetLifecycle(id, 'schedule', { scheduled_at: iso });
      notify('Scheduled.');
      await reloadBlogs();
      await load();
    } catch (e) {
      notify((e as Error).message || 'Could not schedule.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (r: CmsBlogRow) => {
    setBusy(true);
    try {
      await adminCreate({
        slug: `${r.slug}-copy`,
        title: `${r.title} (Copy)`,
        content: r.content,
        excerpt: r.excerpt || undefined,
        heroImageUrl: r.hero_image_url || undefined,
        heroImageAlt: r.hero_image_alt || undefined,
        tags: r.tags || [],
        authorName: r.author_name || 'Luxedge',
        seoTitle: r.seo_title || undefined,
        metaDescription: r.meta_description || undefined,
        targetKeyword: r.target_keyword || undefined,
        secondaryKeywords: r.secondary_keywords || [],
        searchIntent: r.search_intent || undefined,
        faq: r.faq || [],
        internalLinks: r.internal_links || [],
      });
      notify('Duplicated as draft.');
      await load();
    } catch (e) {
      notify((e as Error).message || 'Could not duplicate.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await adminDelete(confirm.id, confirm.permanent);
      notify(confirm.permanent ? 'Deleted permanently.' : 'Archived.');
      await reloadBlogs();
      await load();
    } catch (e) {
      notify((e as Error).message || 'Delete failed.', 'error');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const openRevisions = async (id: string) => {
    setShowRevisionsFor(id);
    try { setRevisions(await adminListRevisions(id)); }
    catch (e) { notify((e as Error).message || 'Could not load revisions.', 'error'); }
  };

  const restoreRevision = async (blogId: string, rev: number) => {
    setBusy(true);
    try {
      await adminRestoreRevision(blogId, rev);
      notify('Restored to that revision.');
      const fresh = await adminListAll();
      setRows(fresh);
      const r = fresh.find((x) => x.id === blogId);
      if (r) startEdit(r);
      await reloadBlogs();
    } catch (e) {
      notify((e as Error).message || 'Restore failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => {
    const base = rows || [];
    return {
      published: base.filter((r) => r.status === 'published').length,
      scheduled: base.filter((r) => r.status === 'scheduled').length,
      draft: base.filter((r) => r.status === 'draft').length,
      archived: base.filter((r) => r.status === 'archived').length,
      automation: base.filter((r) => r.generated_by === 'automation').length,
    };
  }, [rows]);

  const visible = useMemo(() => {
    let list = rows || [];
    if (statusFilter !== 'all') list = list.filter((r) => r.status === statusFilter);
    if (automationOnly) list = list.filter((r) => r.generated_by === 'automation');
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((r) => r.title.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q));
    }
    return list;
  }, [rows, statusFilter, automationOnly, query]);

  const input = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-luxe-gold/40 border-gray-300';
  const label = 'block text-xs font-semibold text-gray-500 mb-1';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Blog Manager</h1>
          <p className="text-xs text-gray-500 mt-1">
            Content lives in the Supabase CMS — publishing takes effect immediately with no code/deploy.
          </p>
        </div>
        <button onClick={startCreate} className="flex items-center gap-2 px-4 py-2 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-sm rounded-lg">
          <Plus size={16} /> New Post
        </button>
      </div>

      {/* Dashboard counts */}
      {!creating && !editing && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([
            ['published', counts.published, STATUS_META.published],
            ['scheduled', counts.scheduled, STATUS_META.scheduled],
            ['draft', counts.draft, STATUS_META.draft],
            ['archived', counts.archived, STATUS_META.archived],
          ] as [CmsBlogRow['status'], number, typeof STATUS_META.published][]).map(([key, n, meta]) => (
            <button key={key} onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
              className={`text-left p-4 rounded-xl border bg-white ${statusFilter === key ? 'ring-2 ring-luxe-gold/50' : ''}`}>
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
              <div className="text-2xl font-bold mt-2">{n}</div>
            </button>
          ))}
        </div>
      )}

      {loadError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">Failed to load posts: {loadError}</div>}

      {/* Editor */}
      {(creating || editing) && (
        <div className="bg-white rounded-2xl border shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold">{creating ? 'New Post' : `Editing: ${editing!.title}`}</h2>
            <div className="flex gap-2">
              <button onClick={() => { setCreating(false); setEditing(null); }} className="px-3 py-1.5 text-sm border rounded-lg">Cancel</button>
              <button onClick={saveDraft} disabled={busy} className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-luxe-gold text-white rounded-lg disabled:opacity-50">
                <FloppyDisk size={14} /> Save
              </button>
            </div>
          </div>

          {editing?.status === 'published' && (
            <div className="flex items-center justify-between gap-3 mb-5 px-4 py-2.5 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              <span className="flex items-center gap-2"><CheckCircle size={17} weight="fill" /> This post is <strong className="font-semibold">LIVE</strong> — changes take effect instantly, no deploy needed.</span>
              <Link to={`/blog/${editing.slug}`} className="inline-flex items-center gap-1 text-green-700 font-semibold underline whitespace-nowrap">View live page →</Link>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div>
                <label className={label}>Title *</label>
                <input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Post title" />
              </div>
              <div>
                <label className={label}>Slug (URL) *</label>
                <input className={input} value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} placeholder="my-blog-slug" />
              </div>
              <div>
                <label className={label}>Excerpt</label>
                <textarea className={input} rows={2} value={form.excerpt || ''} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} />
              </div>
              <div>
                <label className={label}>Author</label>
                <input className={input} value={form.author_name || ''} onChange={(e) => setForm({ ...form, author_name: e.target.value })} />
              </div>
              <div>
                <label className={label}>Tags (comma separated)</label>
                <input className={input} value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="horse, grooming" />
              </div>
              <div>
                <label className={label}>Hero image URL</label>
                <input className={input} value={form.hero_image_url || ''} onChange={(e) => setForm({ ...form, hero_image_url: e.target.value })} />
              </div>
              <div>
                <label className={label}>Hero image alt text</label>
                <input className={input} value={form.hero_image_alt || ''} onChange={(e) => setForm({ ...form, hero_image_alt: e.target.value })} />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className={label}>Content (markdown: ## headings, [label](/path) links)</label>
                <textarea className={`${input} font-mono`} rows={10} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
              </div>
              <div>
                <label className={label}>SEO title (max 60)</label>
                <input className={input} maxLength={60} value={form.seo_title || ''} onChange={(e) => setForm({ ...form, seo_title: e.target.value })} />
                <span className="text-[10px] text-gray-400">{(form.seo_title || '').length}/60</span>
              </div>
              <div>
                <label className={label}>Meta description (max 160)</label>
                <textarea className={input} rows={2} maxLength={160} value={form.meta_description || ''} onChange={(e) => setForm({ ...form, meta_description: e.target.value })} />
                <span className="text-[10px] text-gray-400">{(form.meta_description || '').length}/160</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Target keyword</label>
                  <input className={input} value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} />
                </div>
                <div>
                  <label className={label}>Search intent</label>
                  <input className={input} value={form.search_intent || ''} onChange={(e) => setForm({ ...form, search_intent: e.target.value })} placeholder="buyer | informational" />
                </div>
              </div>
              <div>
                <label className={label}>Secondary keywords (comma separated)</label>
                <input className={input} value={secondaryText} onChange={(e) => setSecondaryText(e.target.value)} />
              </div>
              <div>
                <label className={label}>FAQ (JSON array of {`{ "q": "...", "a": "..." }`})</label>
                <textarea className={`${input} font-mono`} rows={3} value={faqJson} onChange={(e) => setFaqJson(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="mt-6 border-t pt-4">
            <p className="text-xs font-semibold text-gray-500 mb-2">Live preview</p>
            <div className="border rounded-lg p-4 bg-gray-50 text-sm">
              <h3 className="text-lg font-bold mb-2">{form.title}</h3>
              <div id="blog-cms-preview" className="space-y-2"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(form.content) }} />
            </div>
          </div>

          {/* Actions for an existing post */}
          {editing && (
            <div className="mt-5 border-t pt-4 flex flex-wrap gap-2">
              <Link to={`/blog/${editing.slug}`} className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg"><Eye size={14} /> View live</Link>
              <Link to="/blog" className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg"><FileText size={14} /> Blog page</Link>
              {editing.status !== 'published' && (
                <button onClick={() => lifecycle('publish', editing.id)} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-green-600 text-white rounded-lg disabled:opacity-50"><Eye size={14} /> Publish now</button>
              )}
              <button onClick={() => schedule(editing.id)} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg"><CalendarPlus size={14} /> Schedule</button>
              {editing.status === 'published' && (
                <button onClick={() => lifecycle('unpublish', editing.id)} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg"><Eye size={14} /> Unpublish</button>
              )}
              {editing.status !== 'archived' && (
                <button onClick={() => lifecycle('archive', editing.id)} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg"><Archive size={14} /> Archive</button>
              )}
              {editing.status === 'archived' && (
                <button onClick={() => lifecycle('restore', editing.id)} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg"><ArrowCounterClockwise size={14} /> Restore</button>
              )}
              <button onClick={() => duplicate(editing)} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg"><Copy size={14} /> Duplicate as draft</button>
              <button onClick={() => setConfirm({ id: editing.id, title: editing.title, permanent: false })} className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg text-red-500"><Trash size={14} /> Delete</button>
              <button onClick={() => openRevisions(editing.id)} className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg"><ArrowCounterClockwise size={14} /> Revisions</button>
            </div>
          )}

          {showRevisionsFor && revisions.length > 0 && (
            <div className="mt-4 border rounded-lg p-4">
              <p className="text-xs font-semibold mb-2">Revision history</p>
              <div className="space-y-1">
                {revisions.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs border-b py-1">
                    <span>#{r.revision} · {r.action} · {r.actor}{r.actor_email ? ` (${r.actor_email})` : ''} · {new Date(r.created_at).toLocaleString()}</span>
                    {r.next ? <button onClick={() => restoreRevision(r.blog_id, r.revision)} className="text-luxe-gold underline">Restore</button> : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters + list */}
      {!creating && !editing && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-2 flex-1 min-w-[200px]">
              <MagnifyingGlass size={16} className="text-gray-400" />
              <input className="text-sm w-full outline-none" placeholder="Search posts…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={automationOnly} onChange={(e) => setAutomationOnly(e.target.checked)} /> Automation only ({counts.automation})
            </label>
          </div>

          {visible.length > 0 ? (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase"><tr>
                  <th className="px-6 py-4">Post</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Generated</th><th className="px-6 py-4">Updated</th><th className="px-6 py-4">Actions</th>
                </tr></thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {r.hero_image_url
                            ? <img src={r.hero_image_url} alt="" className="w-12 h-8 rounded object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                            : <div className="w-12 h-8 rounded bg-gray-100 flex items-center justify-center"><FileText size={14} className="text-gray-300" /></div>}
                          <div>
                            {r.status === 'published'
                              ? <Link to={`/blog/${r.slug}`} className="font-medium text-sm text-luxe-gold hover:underline">{r.title}</Link>
                              : <p className="font-medium text-sm">{r.title}</p>}
                            <p className="text-xs text-gray-400">/{r.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4"><span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_META[r.status].cls}`}>{STATUS_META[r.status].label}</span></td>
                      <td className="px-6 py-4 text-xs text-gray-500">{r.generated_by || 'manual'}</td>
                      <td className="px-6 py-4 text-xs text-gray-500">{new Date(r.updated_at).toLocaleDateString()}</td>
                      <td className="px-6 py-4">
                        <div className="flex gap-1">
                          <button title="Edit" onClick={() => startEdit(r)} className="p-2 hover:bg-luxe-gold-soft rounded text-luxe-gold"><PencilLine size={16} /></button>
                          <Link to={`/blog/${r.slug}`} title="View" className="p-2 hover:bg-luxe-gold-soft rounded text-luxe-gold"><Eye size={16} /></Link>
                          {r.status !== 'published' && <button title="Publish" onClick={() => lifecycle('publish', r.id)} className="p-2 hover:bg-green-50 rounded text-green-600"><Eye size={16} /></button>}
                          {r.status === 'published' && <button title="Unpublish" onClick={() => lifecycle('unpublish', r.id)} className="p-2 hover:bg-yellow-50 rounded text-yellow-600"><Eye size={16} /></button>}
                          <button title="Delete/archive" onClick={() => setConfirm({ id: r.id, title: r.title, permanent: false })} className="p-2 hover:bg-red-50 rounded text-red-500"><Trash size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-white rounded-xl border p-12 text-center text-gray-500">
              <FileText size={48} className="mx-auto text-gray-200 mb-4" />No blog posts found.
            </div>
          )}
        </>
      )}

      {/* Delete confirmation */}
      {confirm && (
        <div className="fixed inset-0 z-[300] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-2">Delete post</h3>
            <p className="text-sm text-gray-600 mb-4">
              <span className="font-semibold">{confirm.title}</span>. Archiving is reversible and removes it from the storefront/sitemap.
              Tick below only to permanently erase (and its revision history).
            </p>
            <label className="flex items-center gap-2 text-sm mb-4">
              <input type="checkbox" checked={confirm.permanent} onChange={(e) => setConfirm({ ...confirm, permanent: e.target.checked })} />
              Permanent delete (irreversible)
            </label>
            <div className="flex gap-3">
              <button onClick={doDelete} disabled={busy} className={`flex-1 py-2.5 rounded-lg font-medium text-white disabled:opacity-50 ${confirm.permanent ? 'bg-red-500' : 'bg-orange-500'}`}>
                {confirm.permanent ? 'Delete permanently' : 'Archive'}
              </button>
              <button onClick={() => setConfirm(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Minimal markdown-ish render for the live preview (headings + inline links). */
export function renderMarkdown(content: string): string {
  const inline = (text: string) =>
    text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-luxe-gold-dark underline">$1</a>');
  return content
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t) return '<br/>';
      if (t.startsWith('### ')) return '<p class="font-semibold">' + inline(t.slice(4)) + '</p>';
      if (t.startsWith('## ')) return '<h4 class="font-bold mt-3">' + inline(t.slice(3)) + '</h4>';
      if (t.startsWith('# ')) return '<h3 class="font-bold mt-3">' + inline(t.slice(2)) + '</h3>';
      return '<p>' + inline(t) + '</p>';
    })
    .join('');
}
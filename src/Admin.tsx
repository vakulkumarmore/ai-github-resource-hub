import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, Download, Edit3, ExternalLink, FileUp, Github, LoaderCircle, Lock, Plus, RefreshCcw, Save, Search, ShieldCheck, Sparkles, Trash2, Undo2, UploadCloud, X } from 'lucide-react';
import Importer, { fetchMetadata, resourceKey, type Resource } from './Importer';
import BulkAnalyzer from './BulkAnalyzer';
import { apiJson } from './apiJson';
import { cleanHashtag, githubDetailsToResource } from './resourceAnalysis';

type AdminTab = 'resources' | 'import' | 'analyze' | 'publish';
type ResourceView = 'new' | 'all' | 'edited' | 'published';
type Props = { publishedCatalog: Resource[]; onSaved: (resources: Resource[]) => void; onBack: () => void };
const pageSize = 30;

function downloadJSON(items: Resource[]) {
  const blob = new Blob([JSON.stringify(items, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'resources-backup.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Admin({ publishedCatalog, onSaved, onBack }: Props) {
  const [owner, setOwner] = useState(false), [checked, setChecked] = useState(false);
  const [draft, setDraft] = useState<Resource[]>(publishedCatalog);
  const [tab, setTab] = useState<AdminTab>('resources');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ResourceView>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Resource[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [analyzingKey, setAnalyzingKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [restorable, setRestorable] = useState<Resource[] | null>(null);

  useEffect(() => {
    fetch('/api/me', { credentials: 'same-origin' })
      .then(r => apiJson<{owner:boolean}>(r, '/api/me')).then(data => setOwner(!!data.owner))
      .catch(error => { setOwner(false); setMessage(error instanceof Error ? error.message : 'Unable to verify login.'); }).finally(() => setChecked(true));
    try {
      const saved = sessionStorage.getItem('hub-admin-unsaved-draft');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.every(item => typeof item.url === 'string')) setRestorable(parsed);
      }
    } catch { /* session storage unavailable */ }
  }, []);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(publishedCatalog), [draft, publishedCatalog]);
  useEffect(() => {
    if (!dirty) return;
    try { sessionStorage.setItem('hub-admin-unsaved-draft', JSON.stringify(draft)); } catch { /* optional draft recovery */ }
  }, [draft, dirty]);

  // The published snapshot defines what is "new". Changes in a private draft are
  // never confused with repositories that are already visible on the public site.
  const publishedByKey = useMemo(() => new Map(publishedCatalog.map(r => [resourceKey(r.url), r])), [publishedCatalog]);
  const newKeys = useMemo(() => new Set(draft.filter(r => !publishedByKey.has(resourceKey(r.url))).map(r => resourceKey(r.url))), [draft, publishedByKey]);
  const editedKeys = useMemo(() => new Set(draft.filter(r => {
    const prior = publishedByKey.get(resourceKey(r.url));
    return prior && JSON.stringify(prior) !== JSON.stringify(r);
  }).map(r => resourceKey(r.url))), [draft, publishedByKey]);
  const added = newKeys.size;
  const updated = editedKeys.size;
  const removed = useMemo(() => publishedCatalog.filter(r => !draft.some(item => resourceKey(item.url) === resourceKey(r.url))).length, [draft, publishedCatalog]);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    // New additions are always at the top, with the most recently staged first.
    // Existing resources retain their prior order.
    const newFirst = draft.filter(r => newKeys.has(resourceKey(r.url))).reverse();
    const existing = draft.filter(r => !newKeys.has(resourceKey(r.url)));
    return [...newFirst, ...existing].filter(r => {
      const key = resourceKey(r.url);
      if (view === 'new' && !newKeys.has(key)) return false;
      if (view === 'edited' && !editedKeys.has(key)) return false;
      if (view === 'published' && newKeys.has(key)) return false;
      return [r.name, r.url, r.category, r.description, ...(r.tags || []), ...(r.hashtags || [])]
        .join(' ').toLowerCase().includes(search);
    });
  }, [draft, query, view, newKeys, editedKeys]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((Math.min(page, totalPages) - 1) * pageSize, Math.min(page, totalPages) * pageSize);
  const visibleKeys = visible.map(r => resourceKey(r.url));
  const changeView = (next: ResourceView) => {
    setView(next); setPage(1); setSelected([]); setEditing(null);
  };

  const applyImported = (items: Resource[]) => {
    const seen = new Set(draft.map(r => resourceKey(r.url)));
    const unique = items.filter(r => {
      const key = resourceKey(r.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!unique.length) { setMessage('All imported URLs are already in the draft.'); return; }
    setDraft(prev => [...prev, ...unique]);
    setPage(1); setQuery(''); setSelected([]); setView('new'); setTab('resources');
    setMessage(`${unique.length} new resources added to your private draft. Showing only unpublished additions. Save Changes is now available.`);
  };
  const applyBulkEnrichment = (next: Resource[], changeCount: number) => {
    setDraft(next);
    setMessage(`${changeCount} resources enriched in your private draft. Review the edits, download a backup, then select Save Changes to GitHub when ready.`);
    setTab('resources'); setPage(1); setQuery(''); setView('edited');
  };
  const update = (url: string, patch: Partial<Resource>) => {
    setDraft(prev => prev.map(r => resourceKey(r.url) === resourceKey(url) ? { ...r, ...patch } : r));
  };
  const analyzeExisting = async (resource: Resource) => {
    if (!window.confirm(`Refresh GitHub details and replace the category, one-liner, tags and hashtags for ${resource.name}? You can edit the suggestions before publishing.`)) return;
    const key = resourceKey(resource.url);
    setAnalyzingKey(key);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST', headers: {'content-type':'application/json'}, credentials:'same-origin',
        body: JSON.stringify({urls:[resource.url]})
      });
      let suggestions: Partial<Resource>;
      if (response.status === 404) suggestions = await fetchMetadata(resource);
      else {
        const result = await apiJson<{error?:string;results?:any[]}>(response, '/api/analyze');
        if (result.results?.[0]?.error) throw new Error(result.error || result.results?.[0]?.error || 'Analysis failed');
        suggestions = githubDetailsToResource(result.results[0], resource);
      }
      update(resource.url, suggestions);
      setMessage(`Updated GitHub details and suggested hashtags for ${resource.name}. Review the changes before publishing.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Analysis failed');
    } finally { setAnalyzingKey(null); }
  };
  const remove = (urls: string[]) => {
    if (!urls.length || !window.confirm(`Remove ${urls.length} resource(s) from your draft? You can undo before publishing.`)) return;
    const keys = new Set(urls.map(resourceKey));
    setSnapshot(draft);
    setDraft(prev => prev.filter(r => !keys.has(resourceKey(r.url))));
    setSelected([]); setEditing(null);
    setMessage(`${urls.length} resource(s) removed from your draft. Nothing is public until you publish.`);
  };
  const undo = () => {
    if (!snapshot) return;
    setDraft(snapshot); setSnapshot(null); setMessage('Deletion undone.');
  };
  const discard = () => {
    if (!window.confirm('Discard all unpublished additions, edits and deletions?')) return;
    setDraft(publishedCatalog); setSelected([]); setSnapshot(null); setEditing(null); setView('all'); setMessage('Draft reset to published catalog.');
    try { sessionStorage.removeItem('hub-admin-unsaved-draft'); } catch { /* ignore */ }
    setRestorable(null);
  };
  const restore = () => {
    if (!restorable) return;
    const containsNew = restorable.some(r => !publishedByKey.has(resourceKey(r.url)));
    setDraft(restorable); setRestorable(null); setTab('resources'); setView(containsNew ? 'new' : 'all'); setPage(1); setMessage('Previous draft recovered. Please review before publishing.');
  };
  const publish = async () => {
    if (!dirty || busy) return;
    if (!window.confirm(`Publish ${draft.length} resources to GitHub? This includes ${added} additions, ${updated} updates and ${removed} deletions.`)) return;
    setBusy(true); setMessage('Publishing your catalog to GitHub...');
    try {
      const response = await fetch('/api/catalog', { method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(draft) });
      const result = await apiJson<{error?: string;message?: string}>(response, '/api/catalog');
      onSaved(draft);
      setDraft(draft); setSnapshot(null); setSelected([]); setRestorable(null); setView('all'); setPage(1);
      try { sessionStorage.removeItem('hub-admin-unsaved-draft'); } catch { /* ignore */ }
      setMessage(result.message || 'Published to GitHub. Your public site will update after Cloudflare deployment.');
      setTab('publish');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Publishing failed. Your draft is still available.');
    } finally { setBusy(false); }
  };

  if (!checked) return <div className="workspace auth-message"><LoaderCircle className="spin"/> Checking your GitHub sign-in...</div>;
  if (!owner) return <main className="workspace auth-message"><div className="auth-card"><div className="auth-icon"><Lock size={24}/></div><h1>Owner workspace</h1><p>Sign in with your configured GitHub account to manage the public catalog.</p><a className="btn primary" href="/api/login"><Github size={18}/> Sign in with GitHub</a><button className="btn subtle" onClick={onBack}>Back to library</button></div></main>;

  return <main className="workspace" id="admin">
    <div className="workspace-header"><div><button className="backlink" onClick={onBack}><ArrowLeft size={16}/> Back to resource library</button><div className="workspace-kicker"><ShieldCheck size={15}/> OWNER WORKSPACE</div><h1>Manage your resources</h1><p>Import, organize and publish from one place. Your changes remain private until you save.</p></div><button className="btn subtle" onClick={() => downloadJSON(draft)}><Download size={16}/> Download backup</button></div>
    {restorable && <div className="notice info-notice"><AlertCircle size={18}/><span>An unpublished draft from this browser is available.</span><button className="btn small" onClick={restore}>Restore draft</button><button className="icon-btn" aria-label="Dismiss recovery" onClick={() => setRestorable(null)}><X size={17}/></button></div>}
    <div className="workspace-stats"><div><strong>{draft.length}</strong><span>Resources in draft</span></div><div><strong>+{added}</strong><span>Added</span></div><div><strong>{updated}</strong><span>Edited</span></div><div><strong>{removed}</strong><span>Removed</span></div></div>
    <nav className="workspace-tabs" aria-label="Admin workspace sections">
      <button className={tab === 'resources' ? 'active' : ''} onClick={() => setTab('resources')}><FileUp size={17}/> Resource manager</button>
      <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}><UploadCloud size={17}/> Bulk importer</button>
      <button className={tab === 'analyze' ? 'active' : ''} onClick={() => setTab('analyze')}><Search size={17}/> Analyze all</button>
      <button className={tab === 'publish' ? 'active' : ''} onClick={() => setTab('publish')}><Save size={17}/> Publishing {dirty && <span className="notification-dot"/>}</button>
    </nav>
    {message && <div className="notice" role="status"><InfoIcon/>{message}<button className="icon-btn" aria-label="Dismiss message" onClick={() => setMessage('')}><X size={15}/></button></div>}

    {tab === 'import' && <Importer catalog={draft} onApply={applyImported} onNavigate={() => setTab('resources')}/>}

    {/* Keep the analyzer mounted when navigating to Resources so batch progress and review aren't lost. */}
    <div hidden={tab !== 'analyze'}><BulkAnalyzer catalog={draft} onApply={applyBulkEnrichment}/></div>

    {tab === 'resources' && <div className="workspace-panel manager-panel">
      <div className="panel-top"><div><h2>Your catalog</h2><p>Search, edit or remove resources. New imports appear here immediately.</p></div><div className="action-row"><button className="btn subtle" onClick={() => setTab('analyze')}><Search size={17}/> Analyze all existing</button><button className="btn primary" onClick={() => setTab('import')}><Plus size={17}/> Add resources</button></div></div>
      <div className="manager-views" role="group" aria-label="Show resource status">
        <button type="button" aria-pressed={view === 'new'} className={view === 'new' ? 'active' : ''} onClick={() => changeView('new')}><Sparkles size={16}/> Newly added <span>{added}</span></button>
        <button type="button" aria-pressed={view === 'all'} className={view === 'all' ? 'active' : ''} onClick={() => changeView('all')}>All resources <span>{draft.length}</span></button>
        <button type="button" aria-pressed={view === 'edited'} className={view === 'edited' ? 'active' : ''} onClick={() => changeView('edited')}>Edited <span>{updated}</span></button>
        <button type="button" aria-pressed={view === 'published'} className={view === 'published' ? 'active' : ''} onClick={() => changeView('published')}>Existing <span>{draft.length - added}</span></button>
      </div>
      {view === 'new' && <div className="manager-view-info" role="status">
        <Sparkles size={17}/><span>{added ? `Showing only ${added} newly added, unpublished resource${added === 1 ? '' : 's'}. Your existing ${draft.length - added} resources are hidden in this view.` : 'No new resources are waiting to be published. Import GitHub links to see them here.'}</span>
        {!added && <button className="btn small" onClick={() => setTab('import')}>Import links</button>}
      </div>}
      <div className="manager-controls"><label className="search-box compact"><Search size={18}/><input placeholder="Search within this view" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }}/></label><button className="btn subtle" disabled={!snapshot} onClick={undo}><Undo2 size={16}/> Undo delete</button><button className="btn subtle" disabled={!dirty} onClick={discard}><RefreshCcw size={16}/> Discard</button></div>
      <div className="selection-bar"><label><input type="checkbox" checked={visibleKeys.length > 0 && visibleKeys.every(k => selected.includes(k))} onChange={e => setSelected(prev => e.target.checked ? Array.from(new Set([...prev, ...visibleKeys])) : prev.filter(k => !visibleKeys.includes(k)))}/> Select page ({visible.length})</label><span>{filtered.length} in this view · {selected.length} selected</span><button className="btn danger small" disabled={!selected.length} onClick={() => remove(selected)}><Trash2 size={15}/> Delete selected ({selected.length})</button></div>
      <div className="manager-items">
        {visible.map(r => <div className="managed-resource" key={resourceKey(r.url)}>
          <div className="managed-resource-main"><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.includes(resourceKey(r.url))} onChange={e => setSelected(prev => e.target.checked ? [...prev, resourceKey(r.url)] : prev.filter(x => x !== resourceKey(r.url)))}/><div className="managed-resource-body"><div className="managed-title"><strong>{r.name}</strong>{newKeys.has(resourceKey(r.url)) ? <span className="resource-status-badge is-new">New</span> : editedKeys.has(resourceKey(r.url)) ? <span className="resource-status-badge is-edited">Edited</span> : null}<span className="category-tag">{r.category}</span></div><a href={r.url} target="_blank" rel="noopener noreferrer">{r.url} <ExternalLink size={13}/></a></div><div className="managed-buttons"><button className="btn subtle small" onClick={() => setEditing(editing === resourceKey(r.url) ? null : resourceKey(r.url))}><Edit3 size={15}/> {editing === resourceKey(r.url) ? 'Close' : 'Edit'}</button><button className="icon-btn delete-btn" aria-label={`Delete ${r.name}`} onClick={() => remove([r.url])}><Trash2 size={17}/></button></div></div>
          {editing === resourceKey(r.url) && <div className="edit-fields"><label>Name<input value={r.name} onChange={e => update(r.url, { name: e.target.value })}/></label><label>Category<input value={r.category} onChange={e => update(r.url, { category: e.target.value })}/></label><label className="wide">One-line summary<input maxLength={180} value={r.oneLiner ?? r.description} onChange={e => update(r.url, { oneLiner: e.target.value })}/></label><label className="wide">GitHub description<textarea rows={2} value={r.description} onChange={e => update(r.url, { description: e.target.value })}/></label><label>Hashtags (comma separated)<input value={(r.hashtags || []).join(', ')} onChange={e => update(r.url, { hashtags: e.target.value.split(/[\s,]+/).map(cleanHashtag).filter(Boolean) })}/></label><label>Tags (comma separated)<input value={(r.tags || []).join(', ')} onChange={e => update(r.url, { tags: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}/></label><label>Language<input value={r.language || ''} onChange={e => update(r.url, { language: e.target.value })}/></label><label>License<input value={r.license || ''} onChange={e => update(r.url, { license: e.target.value })}/></label><label>Project homepage (HTTPS)<input value={r.homepage || ''} onChange={e => update(r.url, { homepage: e.target.value })}/></label><label className="wide">Custom project image / logo URL (optional, HTTPS)<input type="url" placeholder="https://example.com/project-logo.png" value={r.imageUrl || ''} onChange={e => update(r.url, { imageUrl: e.target.value || undefined })}/><small>Overrides the GitHub preview. Leave blank to use the repository social preview and owner avatar automatically.</small></label><div className="analysis-actions"><button className="btn subtle small" disabled={analyzingKey === resourceKey(r.url)} onClick={() => analyzeExisting(r)}>{analyzingKey === resourceKey(r.url) ? <LoaderCircle className="spin" size={15}/> : <Search size={15}/>} {analyzingKey === resourceKey(r.url) ? 'Analyzing…' : 'Refresh GitHub details & suggestions'}</button></div></div>}
        </div>)}
        {!visible.length && <div className="no-results">{view === 'new' && added === 0 ? 'No new resources yet. Import GitHub URLs to add some.' : 'No resources match this view. Try clearing the search or choose All resources.'}</div>}
      </div>
      {totalPages > 1 && <div className="pagination"><span>Page {Math.min(page, totalPages)} of {totalPages}</span><div><button className="btn subtle small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ArrowLeft size={15}/> Previous</button><button className="btn subtle small" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next <ArrowRight size={15}/></button></div></div>}
    </div>}

    {tab === 'publish' && <div className="workspace-panel publish-panel"><div className="publish-icon"><Github size={26}/></div><h2>Publish your resource catalog</h2><p>Review your pending changes, then save them directly to <strong>vakulkumarmore/ai-github-resource-hub</strong>. Your Cloudflare deployment will update the public website.</p><div className="publish-steps"><div><strong>{draft.length}</strong><span>Total resources</span></div><div><strong>+{added}</strong><span>New links</span></div><div><strong>{updated}</strong><span>Edits</span></div><div><strong>{removed}</strong><span>Deletions</span></div></div>{dirty ? <div className="notice info-notice"><AlertCircle size={18}/> You have unpublished changes.</div> : <div className="notice"><CheckCircle2 size={18}/> Your draft matches the published catalog.</div>}<div className="publish-actions"><button className="btn subtle" onClick={() => downloadJSON(draft)}><Download size={16}/> Download backup</button><button className="btn primary" disabled={!dirty || busy} onClick={publish}>{busy ? <LoaderCircle className="spin" size={17}/> : <Save size={17}/>} {busy ? 'Publishing...' : `Save Changes to GitHub (${draft.length})`}</button></div><p className="publish-note">You can safely leave this page after a successful save. Cloudflare deployment and browser caching may take a short time.</p></div>}

    <div className="publish-bar"><div><span className={dirty ? 'dirty-indicator' : 'clean-indicator'}/><strong>{dirty ? `${added} added · ${updated} edited · ${removed} deleted` : 'All changes published'}</strong><span>{draft.length} resources in catalog</span></div><div><button className="btn subtle" onClick={() => downloadJSON(draft)}><Download size={16}/> Backup</button><button className="btn primary" disabled={!dirty || busy} onClick={publish}>{busy ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} {busy ? 'Saving...' : `Save Changes to GitHub (${draft.length})`}</button></div></div>
  </main>;
}

function InfoIcon() { return <Check size={16}/>; }

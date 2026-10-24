import React, { useMemo, useState } from 'react';
import { ArrowRight, Check, Download, ExternalLink, Github, Info, LoaderCircle, Plus, Search, Sparkles, UploadCloud } from 'lucide-react';

export type Resource = {
  id: string;
  name: string;
  url: string;
  category: string;
  description: string;
  tags: string[];
  language?: string;
  type?: string;
  stars?: number;
  forks?: number;
  updatedAt?: string;
};

export const resourceKey = (url: string) => url.toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '');

export function suggestCategory(text: string) {
  const s = text.toLowerCase();
  if (/claude|anthropic|claude.code/.test(s)) return 'Claude';
  if (/mcp|model.context.protocol/.test(s)) return 'MCP';
  if (/agent|llm|machine.learning|langchain|openai|ollama|huggingface|generative.ai|ai.tools|artificial.intelligence/.test(s)) return 'AI & Machine Learning';
  if (/power.automate|workflow|automation|n8n|zapier/.test(s)) return 'Automation';
  if (/react|vue|nextjs|frontend|web|css|javascript/.test(s)) return 'Web Development';
  if (/data|sql|analytics|dashboard|pandas/.test(s)) return 'Data & Analytics';
  if (/security|devops|terraform|kubernetes|docker/.test(s)) return 'Security & DevOps';
  if (/tool|utility|terminal|cli|editor/.test(s)) return 'Developer Tools';
  return 'Uncategorized';
}

export type ParsedLink = { url: string; owner: string; repo?: string };
export function parseGitHubLinks(raw: string): ParsedLink[] {
  const found = raw.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[a-z0-9-]+(?:\/[a-z0-9_.-]+)?/gi) || [];
  const reserved = new Set(['topics', 'explore', 'settings', 'login', 'features', 'marketplace', 'orgs', 'search', 'notifications', 'sponsors', 'collections', 'new']);
  const unique = new Map<string, ParsedLink>();
  for (const match of found) {
    try {
      const parsed = new URL(match.startsWith('http') ? match : `https://${match}`);
      const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
      if (!owner || reserved.has(owner.toLowerCase())) continue;
      const cleanedRepo = repo?.replace(/\.git$/i, '');
      const url = `https://github.com/${owner}${cleanedRepo ? `/${cleanedRepo}` : ''}`;
      unique.set(resourceKey(url), { url, owner, repo: cleanedRepo });
    } catch { /* Ignore malformed links */ }
  }
  return Array.from(unique.values());
}

export function starterResource(link: ParsedLink): Resource {
  const label = link.repo || link.owner;
  return {
    id: `${link.owner}-${link.repo || 'profile'}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    name: label,
    url: link.url,
    category: suggestCategory(`${link.owner} ${label}`),
    description: link.repo ? `GitHub repository by ${link.owner}.` : `GitHub profile for ${link.owner}.`,
    tags: [],
    type: link.repo ? 'repository' : 'profile',
  };
}

export async function fetchMetadata(resource: Resource): Promise<Partial<Resource>> {
  const parts = new URL(resource.url).pathname.split('/').filter(Boolean);
  const endpoint = parts[1] ? `repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}` : `users/${encodeURIComponent(parts[0])}`;
  const response = await fetch(`https://api.github.com/${endpoint}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(response.status === 403 ? 'GitHub API rate limit reached. Try later.' : `GitHub returned ${response.status}`);
  const data = await response.json();
  const name = data.name || resource.name;
  const description = data.description || data.bio || resource.description;
  const tags = Array.isArray(data.topics) ? data.topics.slice(0, 8) : resource.tags;
  return {
    name, description, tags,
    category: suggestCategory([name, description, parts.join(' '), ...tags].join(' ')),
    language: data.language || resource.language || '',
    stars: typeof data.stargazers_count === 'number' ? data.stargazers_count : undefined,
    forks: typeof data.forks_count === 'number' ? data.forks_count : undefined,
    updatedAt: data.pushed_at || data.updated_at || undefined,
  };
}

type Props = { catalog: Resource[]; onApply: (items: Resource[]) => void; onNavigate?: () => void };
export default function Importer({ catalog, onApply, onNavigate }: Props) {
  const [raw, setRaw] = useState('');
  const [items, setItems] = useState<Resource[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(20);
  const [errors, setErrors] = useState(0);
  const preview = useMemo(() => items.filter(r => [r.name, r.url, r.category].join(' ').toLowerCase().includes(query.toLowerCase())), [items, query]);
  const eligible = useMemo(() => {
    const known = new Set(catalog.map(r => resourceKey(r.url)));
    return items.filter(r => !known.has(resourceKey(r.url)));
  }, [items, catalog]);

  const analyze = () => {
    const links = parseGitHubLinks(raw);
    if (!links.length) { setStatus('Paste valid github.com repository or profile URLs first.'); return; }
    const known = new Set(catalog.map(r => resourceKey(r.url)));
    const staged = new Set(items.map(r => resourceKey(r.url)));
    const newItems = links.filter(l => !known.has(resourceKey(l.url)) && !staged.has(resourceKey(l.url))).map(starterResource);
    setItems(previous => [...previous, ...newItems]);
    setApplied(false);
    setLimit(20);
    setErrors(0);
    setStatus(`${newItems.length} new links added to the import preview. ${links.length - newItems.length} already in the catalog or preview.`);
  };

  const enrich = async () => {
    const pending = items.filter(r => !r.updatedAt && r.type !== 'profile').slice(0, 10);
    if (!pending.length) { setStatus('No additional repository details to fetch in this batch.'); return; }
    setBusy(true);
    let successes = 0, failures = 0;
    for (const r of pending) {
      try {
        const meta = await fetchMetadata(r);
        setItems(existing => existing.map(item => resourceKey(item.url) === resourceKey(r.url) ? { ...item, ...meta } : item));
        successes++;
      } catch { failures++; }
    }
    setErrors(n => n + failures);
    setStatus(`Metadata updated for ${successes} links. ${failures ? `${failures} lookups failed or were rate-limited.` : 'Ready to add to your manager.'}`);
    setBusy(false);
  };
  const update = (url: string, patch: Partial<Resource>) => setItems(old => old.map(r => r.url === url ? { ...r, ...patch } : r));
  const apply = () => {
    if (!eligible.length) return;
    onApply(eligible);
    setApplied(true);
    setStatus(`${eligible.length} resources added to your Admin Resource Manager draft. They are not public until you publish.`);
    onNavigate?.();
  };
  const download = () => {
    const map = new Map<string, Resource>();
    [...catalog, ...items].forEach(r => map.set(resourceKey(r.url), r));
    const blob = new Blob([JSON.stringify([...map.values()], null, 2) + '\n'], { type: 'application/json' });
    const uri = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = uri; a.download = 'resources-backup.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(uri), 1000);
  };

  return <div className="workspace-panel">
    <div className="panel-heading"><span className="mini-icon"><UploadCloud size={21}/></span><div><h2>Bulk import GitHub links</h2><p>Paste up to hundreds of links. We'll prepare the catalog instantly, then fetch optional GitHub details in smaller batches.</p></div></div>
    <label className="field-label" htmlFor="import-input">GitHub URLs</label>
    <textarea id="import-input" className="import-textarea" rows={6} value={raw} onChange={e => setRaw(e.target.value)} placeholder={'https://github.com/anthropics/claude-code\nhttps://github.com/ollama/ollama\nhttps://github.com/langchain-ai/langchain'} />
    <div className="action-row">
      <button className="btn primary" onClick={analyze}><Search size={16}/> Analyze links</button>
      {items.length > 0 && <button className="btn subtle" disabled={busy} onClick={enrich}>{busy ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} {busy ? 'Fetching...' : 'Fetch details (up to 10)'}</button>}
      {items.length > 0 && <button className="btn subtle" onClick={download}><Download size={16}/> Download backup</button>}
    </div>
    <div className="helper-line"><Info size={15}/> GitHub limits unauthenticated API requests. Large imports work without metadata; use Fetch details in batches when needed.</div>
    {status && <div className="notice" role="status">{status}</div>}
    {items.length > 0 && <>
      <div className="import-review-head"><div><h3>{eligible.length} new resources to add</h3><p>{items.length} analyzed · {errors} metadata errors · duplicates omitted</p></div><button className="btn primary" disabled={busy || applied || !eligible.length} onClick={apply}>{applied ? <Check size={16}/> : <Plus size={16}/>} {applied ? 'Added to manager' : `Add ${eligible.length} to manager`} {!applied && <ArrowRight size={15}/>}</button></div>
      <label className="search-box compact"><Search size={17}/><input placeholder="Search imported links" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <div className="import-review-list">
        {preview.slice(0, limit).map(r => <div className="import-review-item" key={r.url}>
          <div className="import-review-name"><Github size={18}/><div><strong>{r.name}</strong><a href={r.url} target="_blank" rel="noopener noreferrer">{r.url} <ExternalLink size={12}/></a></div></div>
          <div className="import-review-edit"><label>Category<input value={r.category} onChange={e => update(r.url, { category: e.target.value })}/></label><label>Description<input value={r.description} onChange={e => update(r.url, { description: e.target.value })}/></label></div>
        </div>)}
      </div>
      {preview.length > limit && <button className="btn subtle show-more" onClick={() => setLimit(x => x + 30)}>Show more imported links ({preview.length - limit} remaining)</button>}
      <div className="import-bottom"><span>Review the draft in Resource Manager before making it public.</span><button className="btn primary" disabled={busy || applied || !eligible.length} onClick={apply}>{applied ? 'Added to manager' : `Add ${eligible.length} to manager`} <ArrowRight size={16}/></button></div>
    </>}
  </div>;
}

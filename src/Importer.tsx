import React, { useMemo, useState } from 'react';
import { ArrowRight, Check, Download, ExternalLink, Github, Info, LoaderCircle, Plus, Search, Sparkles, UploadCloud } from 'lucide-react';
import { categorize, cleanHashtag, githubDetailsToResource, makeOneLiner, suggestHashtags, type GitHubDetails } from './resourceAnalysis';

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
  /** Optional manually chosen HTTPS project cover or logo URL. */
  imageUrl?: string;
  /** Short editorial summary displayed on public resource cards. */
  oneLiner?: string;
  /** Suggested social tags. Owner can edit these before publishing. */
  hashtags?: string[];
  homepage?: string;
  license?: string;
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
    category: categorize({ name: label, url: link.url }),
    description: link.repo ? `GitHub repository by ${link.owner}.` : `GitHub profile for ${link.owner}.`,
    oneLiner: makeOneLiner('', label),
    hashtags: suggestHashtags({name: label, category: categorize({name: label, url: link.url}), topics: []}),
    tags: [],
    type: link.repo ? 'repository' : 'profile',
  };
}

export async function fetchMetadata(resource: Resource): Promise<Partial<Resource>> {
  const parts = new URL(resource.url).pathname.split('/').filter(Boolean);
  const endpoint = parts[1] ? `repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}` : `users/${encodeURIComponent(parts[0])}`;
  const response = await fetch(`https://api.github.com/${endpoint}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(response.status === 403 ? 'GitHub API rate limit reached. Try later.' : `GitHub returned ${response.status}`);
  return githubDetailsToResource(await response.json() as GitHubDetails, resource);
}

/** Prefer an authenticated same-origin Worker for batches; keep browser fallback for incremental rollout. */
async function fetchBatch(resources: Resource[]): Promise<Array<{url: string; metadata?: Partial<Resource>; error?: string}>> {
  const response = await fetch('/api/analyze', {
    method: 'POST', credentials: 'same-origin', headers: {'content-type': 'application/json'},
    body: JSON.stringify({urls: resources.map(r => r.url)}),
  });
  if (response.status === 404) {
    // Frontend deployed before the Worker upgrade. Public GitHub requests are more limited.
    const results = [];
    for (const resource of resources) {
      try { results.push({url: resource.url, metadata: await fetchMetadata(resource)}); }
      catch (error) { results.push({url: resource.url, error: error instanceof Error ? error.message : 'Lookup failed'}); }
    }
    return results;
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Metadata lookup failed (HTTP ${response.status})`);
  }
  const data = await response.json() as {results: GitHubDetails[]};
  return data.results.map(detail => {
    const item = resources.find(r => resourceKey(r.url) === resourceKey(detail.url));
    if (!item || detail.error) return {url: detail.url, error: detail.error || 'Unknown URL'};
    return {url: detail.url, metadata: githubDetailsToResource(detail, item)};
  });
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
  const [analyzed, setAnalyzed] = useState<string[]>([]);
  const [progress, setProgress] = useState('');
  const preview = useMemo(() => items.filter(r => [r.name, r.url, r.category].join(' ').toLowerCase().includes(query.toLowerCase())), [items, query]);
  const eligible = useMemo(() => {
    const known = new Set(catalog.map(r => resourceKey(r.url)));
    return items.filter(r => !known.has(resourceKey(r.url)));
  }, [items, catalog]);

  const analyze = async () => {
    const links = parseGitHubLinks(raw);
    if (!links.length) { setStatus('Paste valid github.com repository or profile URLs first.'); return; }
    const known = new Set(catalog.map(r => resourceKey(r.url)));
    const staged = new Set(items.map(r => resourceKey(r.url)));
    const newItems = links.filter(l => !known.has(resourceKey(l.url)) && !staged.has(resourceKey(l.url))).map(starterResource);
    setItems(previous => [...previous, ...newItems]);
    setApplied(false);
    setLimit(20);
    setErrors(0);
    setStatus(`${newItems.length} new links staged. ${links.length - newItems.length} already listed. Fetching GitHub details and suggested summaries for the first batch…`);
    if (newItems.length) await analyzeItems(newItems.slice(0, 10));
  };

  const analyzeItems = async (pending: Resource[]) => {
    if (!pending.length) return;
    setBusy(true);
    let successes = 0, failures = 0;
    let processed = 0;
    try {
      for (let i = 0; i < pending.length; i += 10) {
        const batch = pending.slice(i, i + 10);
        const results = await fetchBatch(batch);
        for (const result of results) {
          if (result.metadata) {
            setItems(old => old.map(item => resourceKey(item.url) === resourceKey(result.url) ? { ...item, ...result.metadata } : item));
            setAnalyzed(old => [...new Set([...old, resourceKey(result.url)])]);
            successes++;
          } else failures++;
        }
        processed += batch.length;
        setProgress(`${processed} of ${pending.length} in this run`);
      }
      setErrors(old => old + failures);
      setStatus(`Analyzed ${successes} links with GitHub metadata, suggested categories, hashtags and one-liners.${failures ? ` ${failures} failed; you can retry.` : ''} Review the suggestions before publishing.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Analysis failed. Your staged URLs are safe.');
    } finally { setBusy(false); }
  };
  const enrich = async (all = false) => {
    const done = new Set(analyzed);
    const pending = items.filter(r => !done.has(resourceKey(r.url)));
    if (!pending.length) { setStatus('All staged links have been analyzed.'); return; }
    await analyzeItems(all ? pending : pending.slice(0, 10));
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
      <button className="btn primary" disabled={busy} onClick={analyze}><Search size={16}/> Analyze links & details</button>
      {items.length > 0 && <><button className="btn subtle" disabled={busy} onClick={() => enrich(false)}>{busy ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} {busy ? 'Analyzing...' : 'Analyze next 10'}</button><button className="btn subtle" disabled={busy} onClick={() => enrich(true)}>Analyze all remaining</button></>}
      {items.length > 0 && <button className="btn subtle" onClick={download}><Download size={16}/> Download backup</button>}
    </div>
    <div className="helper-line"><Info size={15}/> Suggestions use GitHub descriptions, topics and languages, not generative AI. Your authenticated Worker handles batches; review categories, hashtags and one-liners before publishing.</div>
    {status && <div className="notice" role="status">{status} {busy && progress}</div>}
    {items.length > 0 && <>
      <div className="import-review-head"><div><h3>{eligible.length} new resources to add</h3><p>{analyzed.length} enriched of {items.length} staged · {errors} metadata errors · duplicates omitted</p></div><button className="btn primary" disabled={busy || applied || !eligible.length} onClick={apply}>{applied ? <Check size={16}/> : <Plus size={16}/>} {applied ? 'Added to manager' : `Add ${eligible.length} to manager`} {!applied && <ArrowRight size={15}/>}</button></div>
      <label className="search-box compact"><Search size={17}/><input placeholder="Search imported links" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <div className="import-review-list">
        {preview.slice(0, limit).map(r => <div className="import-review-item" key={r.url}>
          <div className="import-review-name"><Github size={18}/><div><strong>{r.name}</strong><a href={r.url} target="_blank" rel="noopener noreferrer">{r.url} <ExternalLink size={12}/></a></div></div>
          <div className="import-review-edit"><label>Category<input value={r.category} onChange={e => update(r.url, { category: e.target.value })}/></label><label>One-line summary<input maxLength={180} value={r.oneLiner ?? r.description} onChange={e => update(r.url, { oneLiner: e.target.value })}/></label><label>Hashtags<input value={(r.hashtags || []).join(' ')} onChange={e => update(r.url, { hashtags: e.target.value.split(/[\s,]+/).map(cleanHashtag).filter(Boolean) })}/></label><details className="import-original"><summary>GitHub details</summary><p>{r.description}</p>{r.language && <small>Language: {r.language}</small>}{typeof r.stars === 'number' && <small> · Stars: {r.stars.toLocaleString()}</small>}{typeof r.forks === 'number' && <small> · Forks: {r.forks.toLocaleString()}</small>}{r.license && <small> · License: {r.license}</small>}{r.updatedAt && <small> · Last updated: {new Date(r.updatedAt).toLocaleDateString()}</small>}{r.homepage && <p>Homepage: <a href={r.homepage} target="_blank" rel="noopener noreferrer">{r.homepage}</a></p>}</details></div>
        </div>)}
      </div>
      {preview.length > limit && <button className="btn subtle show-more" onClick={() => setLimit(x => x + 30)}>Show more imported links ({preview.length - limit} remaining)</button>}
      <div className="import-bottom"><span>Review the draft in Resource Manager before making it public.</span><button className="btn primary" disabled={busy || applied || !eligible.length} onClick={apply}>{applied ? 'Added to manager' : `Add ${eligible.length} to manager`} <ArrowRight size={16}/></button></div>
    </>}
  </div>;
}

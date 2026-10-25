import React, { useEffect, useMemo, useRef, useState } from 'react';
import './bulkAnalysis.css';
import { apiJson } from './apiJson';
import { AlertCircle, ArrowRight, Check, CheckCircle2, Download, LoaderCircle, PauseCircle, Play, RefreshCcw, Search, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import type { Resource } from './Importer';
import { resourceKey } from './Importer';
import { githubDetailsToResource, type GitHubDetails } from './resourceAnalysis';
import { applyEnrichment, buildEnrichmentProposal, defaultEnrichmentOptions, type EnrichmentOptions } from './catalogEnrichment';

type Props = { catalog: Resource[]; onApply: (next: Resource[], changeCount: number) => void };
type Result = { url: string; suggestion?: Partial<Resource>; error?: string };
type RunState = 'idle' | 'running' | 'paused' | 'complete';
const ANALYSIS_CACHE_KEY = 'hub-analysis-results-v15';
const readCachedResults = (): Map<string, Result> => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(ANALYSIS_CACHE_KEY) || 'null') as {timestamp?:number; entries?:Array<[string,Result]>} | null;
    if (saved?.timestamp && Date.now() - saved.timestamp < 24 * 3600_000 && Array.isArray(saved.entries)) return new Map(saved.entries);
  } catch { /* browser storage optional */ }
  return new Map();
};
const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  function onAbort() { clearTimeout(timer); reject(new DOMException('Canceled', 'AbortError')); }
  if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, {once: true});
});

async function lookupBatch(batch: Resource[], signal: AbortSignal): Promise<Result[]> {
  const response = await fetch('/api/analyze', {
    method: 'POST', credentials: 'same-origin', signal,
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({urls: batch.map(item => item.url)}),
  });
  const body = await apiJson<{results: GitHubDetails[]}>(response, '/api/analyze');
  if (!Array.isArray(body.results)) throw new Error('The analysis service did not return a list of results.');
  const returned = new Map<string, GitHubDetails>(body.results.map((r: GitHubDetails) => [resourceKey(r.url), r]));
  return batch.map(resource => {
    const result = returned.get(resourceKey(resource.url));
    if (!result) return {url: resource.url, error: 'No result returned for this URL'};
    if (result.error) return {url: resource.url, error: result.error};
    return {url: resource.url, suggestion: githubDetailsToResource(result, resource)};
  });
}

export default function BulkAnalyzer({catalog, onApply}: Props) {
  const [results, setResults] = useState<Map<string, Result>>(readCachedResults);
  const resultsRef = useRef(results);
  const [state, setState] = useState<RunState>('idle');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [batchSize, setBatchSize] = useState(10);
  const [scope, setScope] = useState<'all' | 'missing'>('all');
  const [options, setOptions] = useState<EnrichmentOptions>(defaultEnrichmentOptions);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState('');
  const [reviewLimit, setReviewLimit] = useState(25);
  const [message, setMessage] = useState('');
  const [completeCount, setCompleteCount] = useState(0);
  const [targetCount, setTargetCount] = useState(0);
  const [batchNumber, setBatchNumber] = useState(0);
  const [stoppedForLimit, setStoppedForLimit] = useState(false);

  useEffect(() => () => { mounted.current = false; controller.current?.abort(); }, []);
  useEffect(() => {
    try {
      if (results.size) sessionStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify({timestamp: Date.now(), entries: Array.from(results.entries())}));
      else sessionStorage.removeItem(ANALYSIS_CACHE_KEY);
    } catch { /* Optional recovery cache; never blocks analysis */ }
  }, [results]);
  // Imported / deleted resources can change the catalog. Invalidate previous analyses
  // for URLs that no longer exist; don't apply stale suggestions to unknown items.
  const keys = useMemo(() => new Set(catalog.map(r => resourceKey(r.url))), [catalog]);
  const candidates = useMemo(() => catalog.filter(r => scope === 'all' ||
    !(r.oneLiner?.trim()) || !(r.hashtags?.length) || !r.updatedAt || r.stars == null ||
    r.category === 'Uncategorized'), [catalog, scope]);

  const updateResults = (next: Map<string, Result>) => {
    resultsRef.current = next;
    if (mounted.current) setResults(next);
  };
  const stop = () => {
    controller.current?.abort();
    controller.current = null;
    setState('paused');
    setMessage('Analysis paused. Completed results are retained for review or resuming.');
  };
  const resetReview = () => {
    if (controller.current || !window.confirm('Clear completed analysis suggestions and start over? Your resource catalog and unpublished edits will not change.')) return;
    updateResults(new Map()); setExcluded(new Set()); setCompleteCount(0); setTargetCount(0); setBatchNumber(0);
    setState('idle'); setMessage('Analysis suggestions cleared. You can run a fresh analysis.'); setStoppedForLimit(false);
  };
  const run = async (retryFailed = false) => {
    if (controller.current) return;
    const work = candidates.filter(item => {
      const result = resultsRef.current.get(resourceKey(item.url));
      return retryFailed ? !!result?.error : (!result || !!result.error);
    });
    if (!work.length) { setMessage(retryFailed ? 'No failed lookups to retry.' : 'All eligible resources have been analyzed.'); return; }
    const abort = new AbortController();
    controller.current = abort;
    setState('running'); setStoppedForLimit(false); setMessage('Fetching repository details from GitHub...');
    setCompleteCount(0); setTargetCount(work.length); setBatchNumber(0);
    let count = 0, requests = 0, limitHit = false;
    try {
      for (let offset = 0; offset < work.length; offset += batchSize) {
        if (abort.signal.aborted) break;
        const batch = work.slice(offset, offset + batchSize);
        const returned = await lookupBatch(batch, abort.signal);
        const next = new Map(resultsRef.current);
        returned.forEach(item => next.set(resourceKey(item.url), item));
        updateResults(next);
        count += batch.length; requests += 1;
        if (mounted.current) { setCompleteCount(count); setBatchNumber(requests); }
        // GitHub may return the rate-limit condition as per-resource errors.
        if (returned.some(item => /rate limit|secondary limit|abuse|access restriction/i.test(item.error || ''))) {
          limitHit = true;
          setStoppedForLimit(true);
          setMessage('GitHub reported a rate limit or access restriction. Analysis stopped; wait before retrying failed resources.');
          break;
        }
        if (offset + batchSize < work.length) await pause(1600, abort.signal);
      }
      if (!limitHit) setMessage(`Completed this run: ${count} of ${work.length} resources checked. Review suggested changes below before applying.`);
      if (mounted.current) setState(limitHit ? 'paused' : 'complete');
    } catch (error) {
      if (abort.signal.aborted) return;
      setMessage(error instanceof Error ? error.message : 'Analysis interrupted. Completed results are retained.');
      if (mounted.current) setState('paused');
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  };

  const proposals = useMemo(() => catalog.map(resource => {
    const result = results.get(resourceKey(resource.url));
    if (!result?.suggestion) return null;
    return buildEnrichmentProposal(resource, result.suggestion, options);
  }).filter((p): p is NonNullable<typeof p> => !!p), [catalog, results, options]);
  const changed = useMemo(() => proposals.filter(p => p.changes.length), [proposals]);
  const filtered = useMemo(() => changed.filter(p => [p.resource.name, p.resource.url, p.resource.category].join(' ').toLowerCase().includes(filter.toLowerCase())), [changed, filter]);
  const chosen = useMemo(() => changed.filter(p => !excluded.has(resourceKey(p.resource.url))), [changed, excluded]);
  const success = [...results.entries()].filter(([k, r]) => keys.has(k) && !!r.suggestion).length;
  const failures = [...results.entries()].filter(([k, r]) => keys.has(k) && !!r.error).length;
  const hasAnalyses = !!success || !!failures;
  const showResults = filtered.slice(0, reviewLimit);
  const progress = targetCount ? Math.round((completeCount / targetCount) * 100) : 0;

  const apply = () => {
    if (!chosen.length || state === 'running') return;
    const selected = new Set(chosen.map(p => resourceKey(p.resource.url)));
    const suggestions = new Map<string, Partial<Resource>>();
    results.forEach((r, key) => { if (r.suggestion) suggestions.set(key, r.suggestion); });
    const next = applyEnrichment(catalog, suggestions, selected, options, resourceKey);
    const modified = next.filter((r, i) => JSON.stringify(r) !== JSON.stringify(catalog[i])).length;
    if (!modified) { setMessage('No draft changes to apply.'); return; }
    if (!window.confirm(`Apply suggested changes to ${modified} draft resources? This will NOT publish them to GitHub.`)) return;
    onApply(next, modified);
    setExcluded(new Set());
    setMessage(`Applied ${modified} enriched resources to the Admin draft. Review and use Save Changes to GitHub when ready.`);
  };
  const exportReview = () => {
    const data = changed.map(p => ({url: p.resource.url, name: p.resource.name, selected: !excluded.has(resourceKey(p.resource.url)), changes: p.changes}));
    const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
    const a = document.createElement('a'); a.href = href; a.download = 'github-analysis-review.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  return <div className="workspace-panel enrichment-panel">
    <div className="panel-heading"><span className="mini-icon"><Sparkles size={22}/></span><div><h2>Analyze existing resources</h2><p>Enrich your current catalog in small GitHub API batches. Nothing changes publicly until you review, apply to draft, and publish.</p></div></div>
    <div className="enrich-stats">
      <div><strong>{catalog.length}</strong><span>In your draft</span></div><div><strong>{success}</strong><span>Analyzed</span></div>
      <div><strong>{changed.length}</strong><span>Suggested updates</span></div><div><strong>{failures}</strong><span>Errors</span></div>
    </div>
    <div className="enrich-settings">
      <div className="enrich-options-row"><label>Analyze <select value={scope} disabled={state === 'running'} onChange={e => setScope(e.target.value as 'all' | 'missing')}><option value="all">All current resources</option><option value="missing">Only incomplete resources</option></select></label>
        <label>Batch size <select value={batchSize} disabled={state === 'running'} onChange={e => setBatchSize(Number(e.target.value))}><option value={5}>5 resources</option><option value={10}>10 resources</option></select></label></div>
      <fieldset className="enrich-fieldset"><legend>What can be updated?</legend>
        <label><input type="checkbox" checked={options.refreshMetadata} onChange={e => setOptions(o => ({...o, refreshMetadata: e.target.checked}))}/> Refresh stars, forks, language, last updated, license and homepage</label>
        <label><input type="checkbox" checked={options.fillMissingEditorial} onChange={e => setOptions(o => ({...o, fillMissingEditorial: e.target.checked}))}/> Fill missing one-liners, hashtags, categories, descriptions and tags</label>
        <label className="enrich-warning"><input type="checkbox" checked={options.replaceEditorial} onChange={e => setOptions(o => ({...o, replaceEditorial: e.target.checked}))}/> Also replace existing descriptions, categories, one-liners and hashtags (off by default)</label>
      </fieldset>
    </div>
    <div className="action-row enrich-actions">
      <button className="btn primary" disabled={state === 'running' || !candidates.length} onClick={() => run(false)}>{state === 'running' ? <LoaderCircle className="spin" size={16}/> : state === 'paused' ? <Play size={16}/> : <Sparkles size={16}/>} {state === 'running' ? 'Analyzing…' : hasAnalyses ? 'Continue remaining' : `Analyze ${candidates.length} resources`}</button>
      {state === 'running' && <button className="btn subtle" onClick={stop}><PauseCircle size={16}/> Pause</button>}
      {failures > 0 && state !== 'running' && <button className="btn subtle" onClick={() => run(true)}><RefreshCcw size={16}/> Retry {failures} failed</button>}
      {hasAnalyses && <button className="btn subtle" onClick={exportReview}><Download size={16}/> Export review</button>}
      {hasAnalyses && state !== 'running' && <button className="btn subtle" onClick={resetReview}><RefreshCcw size={16}/> Start fresh analysis</button>}
    </div>
    {targetCount > 0 && <div className="enrich-progress" aria-live="polite"><div className="enrich-progress-heading"><span>{state === 'running' ? 'Analyzing' : state === 'paused' ? 'Paused' : 'Batch finished'} · {completeCount} / {targetCount}</span><strong>{progress}%</strong></div><div className="enrich-track" role="progressbar" aria-valuemin={0} aria-valuemax={targetCount} aria-valuenow={completeCount}><span style={{width:`${progress}%`}}/></div><span>Batch {batchNumber} · {success} total succeeded · {failures} failed</span></div>}
    {message && <div className={`notice ${stoppedForLimit ? 'info-notice' : ''}`} role="status">{stoppedForLimit ? <AlertCircle size={16}/> : <CheckCircle2 size={16}/>} {message}</div>}
    {hasAnalyses && <>
      <div className="enrich-review-header"><div><h3>Review suggestions</h3><p>{changed.length} resources would change · {chosen.length} selected · {success - changed.length} already complete</p></div><button className="btn primary" disabled={!chosen.length || state === 'running'} onClick={apply}><Check size={17}/> Apply {chosen.length} to draft <ArrowRight size={15}/></button></div>
      <div className="enrich-review-controls"><label className="search-box compact"><Search size={17}/><input placeholder="Search suggested changes" value={filter} onChange={e => {setFilter(e.target.value); setReviewLimit(25);}}/></label><button className="btn subtle small" onClick={() => setExcluded(new Set())}>Select all</button><button className="btn subtle small" onClick={() => setExcluded(new Set(changed.map(p => resourceKey(p.resource.url))))}>Select none</button></div>
      <div className="enrich-review-list">
        {showResults.map(proposal => <div className="enrich-review-item" key={resourceKey(proposal.resource.url)}>
          <label className="enrich-review-title"><input type="checkbox" checked={!excluded.has(resourceKey(proposal.resource.url))} onChange={e => { const key = resourceKey(proposal.resource.url); setExcluded(old => {const next = new Set(old); e.target.checked ? next.delete(key) : next.add(key); return next;}); }}/><span><strong>{proposal.resource.name}</strong><small>{proposal.resource.url}</small></span><span className="enrich-count">{proposal.changes.length} updates</span></label>
          <details><summary>Review field changes</summary><div className="enrich-diff">{proposal.changes.map(change => <div className="enrich-diff-row" key={change.field}><strong>{change.label}</strong><div><span className="enrich-before">{change.before}</span><ArrowRight size={14}/><span className="enrich-after">{change.after}</span></div></div>)}</div></details>
        </div>)}
      </div>
      {filtered.length > reviewLimit && <button className="btn subtle show-more" onClick={() => setReviewLimit(n => n + 25)}>Show {Math.min(25, filtered.length - reviewLimit)} more ({filtered.length - reviewLimit} remaining)</button>}
      {failures > 0 && <details className="enrich-errors"><summary><XCircle size={15}/> {failures} analysis errors</summary>{[...results.entries()].filter(([k,v]) => keys.has(k) && v.error).map(([k,v]) => <p key={k}>{v.url}: {v.error}</p>)}</details>}
      <div className="enrich-review-footer"><span><ShieldCheck size={17}/> Only selected changes are applied to your private draft. Publishing remains a separate action.</span><button className="btn primary" disabled={!chosen.length || state === 'running'} onClick={apply}>Apply selected ({chosen.length})</button></div>
    </>}
    {!hasAnalyses && <div className="enrich-empty"><ShieldCheck size={22}/><p>Existing curated descriptions and categories are protected by default. Analyze, review, and approve each batch before publishing.</p></div>}
  </div>;
}

import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckSquare, ExternalLink, Github, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import type { Resource } from './Importer';
import { resourceKey } from './Importer';
import reportJSON from './repo-health.json';
import './healthReview.css';

type HealthEntry = {
  url: string;
  status?: string;
  checkedAt?: string;
  lastPushAt?: string | null;
  daysSincePush?: number | null;
  flags?: string[];
  stars?: number | null;
  forks?: number | null;
  openIssues?: number | null;
  openPullRequests?: number | null;
  archived?: boolean;
  disabled?: boolean;
  publishedAdvisoryFound?: boolean | null;
  advisoryCheckedAt?: string;
};
type Report = { generatedAt?: string | null; scanned?: number; failedBatches?: number; entries: HealthEntry[] };
type Props = {
  catalog: Resource[];
  onStageRemoval: (urls: string[]) => void;
};
type Filter = 'review' | 'stale' | 'archived' | 'unavailable' | 'advisories' | 'issues' | 'all';
const report = reportJSON as Report;
const options: Array<{key: Filter; label: string}> = [
  {key:'review', label:'Needs review'}, {key:'stale', label:'No push in 1+ year'},
  {key:'archived', label:'Archived / disabled'}, {key:'unavailable', label:'Unavailable'},
  {key:'advisories', label:'Published advisories'}, {key:'issues', label:'Many open issues'},
  {key:'all', label:'All checked'},
];
const reasonLabels: Record<string, string> = {
  stale_365d: 'No code push for 1+ year', archived: 'Archived', disabled: 'Disabled',
  unavailable: 'Unavailable on GitHub', many_open_issues: '150+ open issues',
  published_advisories: 'Published security advisory (may be resolved)',
};
const reviewFlags = (entry: HealthEntry) => entry.flags || [];
const matches = (entry: HealthEntry, filter: Filter) => {
  const flags = reviewFlags(entry);
  switch (filter) {
    case 'review': return flags.length > 0;
    case 'stale': return flags.includes('stale_365d');
    case 'archived': return flags.includes('archived') || flags.includes('disabled');
    case 'unavailable': return flags.includes('unavailable');
    case 'advisories': return flags.includes('published_advisories');
    case 'issues': return flags.includes('many_open_issues');
    default: return true;
  }
};
const stamp = (date?: string | null) => date && !Number.isNaN(Date.parse(date))
  ? new Date(date).toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'}) : 'Not available';

export default function HealthReview({catalog, onStageRemoval}: Props) {
  const [filter, setFilter] = useState<Filter>('review');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const byUrl = useMemo(() => new Map(catalog.map(resource => [resourceKey(resource.url), resource])), [catalog]);
  const entries = useMemo(() => report.entries.filter(row => byUrl.has(resourceKey(row.url))), [byUrl]);
  const filtered = useMemo(() => entries.filter(row => {
    const matchQuery = !query.trim() || [row.url, byUrl.get(resourceKey(row.url))?.name, byUrl.get(resourceKey(row.url))?.category]
      .join(' ').toLowerCase().includes(query.trim().toLowerCase());
    return matchQuery && matches(row, filter);
  }), [entries, filter, query, byUrl]);
  const limit = 25;
  const pages = Math.max(1, Math.ceil(filtered.length / limit));
  const visible = filtered.slice((Math.min(page, pages) - 1) * limit, Math.min(page, pages) * limit);
  const selectedSet = new Set(selected);
  const selectedInDraft = selected.filter(url => byUrl.has(resourceKey(url)));
  const totals = {
    review: entries.filter(x => matches(x,'review')).length,
    stale: entries.filter(x => matches(x,'stale')).length,
    archived: entries.filter(x => matches(x,'archived')).length,
    unavailable: entries.filter(x => matches(x,'unavailable')).length,
    advisories: entries.filter(x => matches(x,'advisories')).length,
    issues: entries.filter(x => matches(x,'issues')).length,
    all: entries.length,
  };
  const selectVisible = (checked: boolean) => setSelected(prev => checked
    ? [...new Set([...prev, ...visible.map(x => x.url)])]
    : prev.filter(url => !visible.some(x => resourceKey(x.url) === resourceKey(url))));
  const stage = () => {
    if (!selectedInDraft.length) return;
    // Parent asks for a final confirmation and provides undo before publication.
    onStageRemoval(selectedInDraft);
    setSelected([]);
  };
  return <section className="workspace-panel health-review">
    <header className="health-header">
      <div><p className="health-kicker"><ShieldAlert size={16}/> REPOSITORY HEALTH</p><h2>Review repository health</h2><p>Find inactive, archived, inaccessible or issue-heavy repositories. Nothing is removed automatically.</p></div>
      <a className="btn subtle small" href="https://github.com/vakulkumarmore/ai-github-resource-hub/actions/workflows/daily-repository-health.yml" target="_blank" rel="noopener noreferrer"><Github size={16}/> Run or view check <ExternalLink size={14}/></a>
    </header>
    <div className="health-meta"><CalendarClock size={17}/> {report.generatedAt
      ? <>Last GitHub check: <strong>{stamp(report.generatedAt)}</strong> · {report.scanned ?? 0} repositories checked</>
      : <>No automatic check has run yet. Enable GitHub Actions and run the daily health workflow once.</>}
      {report.failedBatches ? <span className="health-alert">· {report.failedBatches} batches failed. Some results are older.</span> : null}
    </div>
    <div className="health-numbers">
      <div><strong>{totals.review.toLocaleString()}</strong><span>Need review</span></div>
      <div><strong>{totals.stale.toLocaleString()}</strong><span>Inactive 1+ year</span></div>
      <div><strong>{totals.archived.toLocaleString()}</strong><span>Archived / disabled</span></div>
      <div><strong>{totals.unavailable.toLocaleString()}</strong><span>Unavailable</span></div>
    </div>
    <p className="health-guidance"><AlertTriangle size={16}/> These are screening signals, not a measured security rating. Many open issues do not imply vulnerabilities, and a published advisory may already have been fixed. Always open the repository and review before removal.</p>
    <div className="health-filters" role="group" aria-label="Repository health filter">{options.map(option => <button key={option.key} type="button" className={filter === option.key ? 'active' : ''} aria-pressed={filter === option.key} onClick={() => {setFilter(option.key); setPage(1); setSelected([]);}}>{option.label} <span>{totals[option.key]}</span></button>)}</div>
    <div className="health-controls"><label className="search-box compact"><Search size={17}/><input placeholder="Search health results" value={query} onChange={e => {setQuery(e.target.value); setPage(1);}}/></label>
      <button type="button" className="btn danger small" disabled={!selectedInDraft.length} onClick={stage}><Trash2 size={16}/> Stage {selectedInDraft.length} for removal</button>
    </div>
    <div className="health-selection"><label><input type="checkbox" checked={!!visible.length && visible.every(x => selectedSet.has(x.url))} onChange={e => selectVisible(e.target.checked)}/> Select this page</label><span>{filtered.length.toLocaleString()} matching · {selectedInDraft.length} selected</span>{selectedInDraft.length > 0 && <button type="button" className="btn subtle small" onClick={() => setSelected([])}><X size={14}/> Clear selection</button>}</div>
    <div className="health-list">
      {visible.map(entry => {
        const resource = byUrl.get(resourceKey(entry.url));
        if (!resource) return null;
        return <article key={entry.url} className="health-item"><label className="health-checkbox"><input type="checkbox" aria-label={`Select ${resource.name}`} checked={selectedSet.has(entry.url)} onChange={e => setSelected(prev => e.target.checked ? [...new Set([...prev, entry.url])] : prev.filter(u => u !== entry.url))}/></label>
          <div className="health-item-body"><div className="health-title"><a href={entry.url} target="_blank" rel="noopener noreferrer">{resource.name} <ExternalLink size={13}/></a><span>{resource.category || 'Uncategorized'}</span></div>
            <div className="health-flags">{reviewFlags(entry).length
              ? reviewFlags(entry).map(flag => <span key={flag} className={flag === 'stale_365d' ? 'health-flag muted' : 'health-flag'}>{reasonLabels[flag] || flag}</span>)
              : <span className="health-ok">No review flags from available signals</span>}
            </div>
            <div className="health-facts"><span>Last push: <strong>{stamp(entry.lastPushAt)}</strong></span><span>★ {typeof entry.stars === 'number' ? entry.stars.toLocaleString() : 'Unknown'}</span><span>Forks: {entry.forks ?? 'Unknown'}</span><span>Open issues: {entry.openIssues ?? 'Unknown'}</span><span>Open PRs: {entry.openPullRequests ?? 'Unknown'}</span></div>
          </div>
        </article>;
      })}
      {visible.length === 0 && <div className="no-results">{!report.generatedAt ? 'Run the workflow to populate this dashboard.' : 'Nothing matches these review filters.'}</div>}
    </div>
    {pages > 1 && <div className="pagination"><span>Page {Math.min(page,pages)} of {pages}</span><div><button className="btn subtle small" disabled={page<=1} onClick={() => setPage(p=>p-1)}>Previous</button><button className="btn subtle small" disabled={page>=pages} onClick={() => setPage(p=>p+1)}>Next</button></div></div>}
    <footer className="health-footer"><CheckSquare size={17}/><span>Stage removals → review your draft in Resource Manager → download a backup → Save Changes to GitHub. Use Undo Delete before publishing if needed.</span></footer>
  </section>;
}

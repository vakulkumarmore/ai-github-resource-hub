import React, { useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, Check, CheckSquare2, ExternalLink, Github, RefreshCcw, Search, Sparkles, Star, TrendingUp, X } from 'lucide-react';
import { categorize, githubDetailsToResource } from './resourceAnalysis';
import { resourceKey, type Resource } from './Importer';
import reportJSON from './daily-discoveries.json';
import './dailyDiscoveries.css';

type Suggestion = {
  url: string; fullName: string; name: string; description: string;
  topics: string[]; stars: number; forks: number; createdAt: string;
  pushedAt: string | null; language: string | null; homepage: string | null;
  starsPerDay: number; starGainSinceLastScan: number | null; observationHours: number | null;
  firstSeenAt: string; lastSeenAt: string;
};
type Report = {
  version: number; generatedAt: string | null; searchWindowDays: number;
  queriesSucceeded: number; queriesAttempted: number; partial: boolean;
  failedTopics: Array<{topic: string; error: string}>; candidates: Suggestion[];
};
type Props = { catalog: Resource[]; onStage: (items: Resource[]) => void };
const report = reportJSON as Report;
const dismissedKey = 'ai-hub-dismissed-discoveries-v34';
const readDismissed = (): string[] => {
  try { const value = JSON.parse(localStorage.getItem(dismissedKey) || '[]'); return Array.isArray(value) ? value.filter(x => typeof x === 'string') : []; }
  catch { return []; }
};
const formatDate = (value?: string | null) => {
  if (!value || Number.isNaN(Date.parse(value))) return 'Not yet checked';
  return new Date(value).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
};
const categoryOf = (r: Suggestion) => categorize({
  name:r.name, description:r.description, topics:r.topics, url:r.url,
});
const isNewToday = (r: Suggestion) => !!report.generatedAt &&
  r.firstSeenAt?.slice(0, 10) === report.generatedAt.slice(0, 10);

function toResource(r: Suggestion): Resource {
  const category = categoryOf(r);
  const description = r.description || 'GitHub repository discovered through recent topic searches.';
  const suggested = githubDetailsToResource({
    url: r.url, name:r.name, description, topics:r.topics, language:r.language,
    stargazers_count:r.stars, forks_count:r.forks, pushed_at:r.pushedAt,
    homepage:r.homepage, archived:false,
  }, {url:r.url, name:r.name, category, description, tags:r.topics, language:r.language || ''});
  return {
    id:r.fullName.toLowerCase().replace(/[^a-z0-9]+/g,'-'),
    url:r.url,
    type:'repository',
    ...suggested,
  };
}

export default function DailyDiscoveries({catalog,onStage}:Props) {
  const [query,setQuery] = useState('');
  const [category,setCategory] = useState('all');
  const [sort,setSort] = useState<'pace'|'stars'|'new'>('pace');
  const [selected,setSelected] = useState<string[]>([]);
  const [dismissed,setDismissed] = useState<string[]>(readDismissed);
  const [showAll,setShowAll] = useState(false);
  const known = useMemo(() => new Set(catalog.map(item => resourceKey(item.url))),[catalog]);
  const unseen = useMemo(() => report.candidates.filter(item =>
    !known.has(resourceKey(item.url)) && !dismissed.includes(resourceKey(item.url))
  ),[known,dismissed]);
  const categories = useMemo(() => [...new Set(unseen.map(categoryOf))].sort(),[unseen]);
  const filtered = useMemo(() => unseen.filter(item => {
    if (category !== 'all' && categoryOf(item) !== category) return false;
    const q=query.trim().toLowerCase();
    return !q || [item.name,item.fullName,item.description,item.language || '',...item.topics].join(' ').toLowerCase().includes(q);
  }).sort((a,b) => sort==='stars' ? b.stars-a.stars : sort==='new' ?
    b.firstSeenAt.localeCompare(a.firstSeenAt) || b.starsPerDay-a.starsPerDay :
    b.starsPerDay-a.starsPerDay || b.stars-a.stars),[unseen,category,query,sort]);
  const visible = filtered.slice(0,showAll?80:24);
  const selectedItems = unseen.filter(item => selected.includes(resourceKey(item.url)));
  const selectVisible = (checked:boolean) => setSelected(prev => checked
    ? [...new Set([...prev,...visible.map(item => resourceKey(item.url))])]
    : prev.filter(k => !visible.some(item => resourceKey(item.url) === k)));
  const saveDismissed = (items:string[]) => {
    setDismissed(items);
    try { localStorage.setItem(dismissedKey,JSON.stringify(items)); } catch {/* optional browser storage */}
  };
  const dismiss = (url:string) => {
    const key=resourceKey(url);
    saveDismissed([...new Set([...dismissed,key])]);
    setSelected(prev => prev.filter(x => x!==key));
  };
  const stage = () => {
    if (!selectedItems.length) return;
    if (selectedItems.length>25) {window.alert('Select no more than 25 discoveries per approval batch.');return;}
    onStage(selectedItems.map(toResource));
    setSelected([]);
  };
  const newToday = unseen.filter(isNewToday).length;
  const selectedVisible = visible.length>0 && visible.every(item=>selected.includes(resourceKey(item.url)));

  return <section className="workspace-panel daily-discoveries">
    <div className="daily-discovery-head">
      <div><p className="daily-discovery-eyebrow"><TrendingUp size={16}/> DAILY GITHUB DISCOVERY</p>
        <h2>Popular new repositories</h2>
        <p>Fresh AI projects that are not in your catalog. Review the suggestions, then check and approve any you want to add.</p>
      </div>
      <a className="btn subtle small" href="https://github.com/vakulkumarmore/ai-github-resource-hub/actions/workflows/daily-trending-discoveries.yml" target="_blank" rel="noopener noreferrer">
        <RefreshCcw size={15}/> View or run daily search <ExternalLink size={13}/>
      </a>
    </div>
    <div className="daily-discovery-info"><CalendarClock size={16}/> Last discovery: <strong>{formatDate(report.generatedAt)}</strong>
      <span>· Looks back {report.searchWindowDays || 60} days</span>
      {report.partial && <span className="daily-discovery-warning">· Partial search, {report.queriesSucceeded}/{report.queriesAttempted} topics checked</span>}
    </div>
    <div className="daily-discovery-stats">
      <div><strong>{unseen.length}</strong><span>New suggestions</span></div>
      <div><strong>{newToday}</strong><span>First found today</span></div>
      <div><strong>{selectedItems.length}</strong><span>Selected for review</span></div>
    </div>
    <div className="daily-discovery-explainer">
      <Sparkles size={17}/><span>Popularity is estimated from <strong>stars per day since repository creation</strong>. This is not a verified 24-hour growth ranking or a security endorsement. Suggestions are never automatically published.</span>
    </div>
    <div className="daily-discovery-controls">
      <label className="search-box compact"><Search size={17}/><input aria-label="Search suggested repositories" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search discoveries, topics or languages"/></label>
      <select aria-label="Discovery category" value={category} onChange={e=>setCategory(e.target.value)}>
        <option value="all">All categories</option>{categories.map(c=><option key={c} value={c}>{c}</option>)}
      </select>
      <select aria-label="Sort discoveries" value={sort} onChange={e=>setSort(e.target.value as typeof sort)}>
        <option value="pace">Top average stars/day</option>
        <option value="stars">Most total stars</option>
        <option value="new">Recently discovered</option>
      </select>
    </div>
    <div className="daily-discovery-actions">
      <label><input type="checkbox" disabled={!visible.length} checked={selectedVisible} onChange={e=>selectVisible(e.target.checked)}/> Select visible ({visible.length})</label>
      <span>{filtered.length} matches · {selectedItems.length} selected</span>
      <button type="button" className="btn primary small" disabled={!selectedItems.length || selectedItems.length>25} onClick={stage}>
        <Check size={15}/> Stage {selectedItems.length} for approval <ArrowRight size={15}/>
      </button>
    </div>
    <div className="daily-discovery-list">
      {visible.map(item=><article className="daily-discovery-item" key={resourceKey(item.url)}>
        <input type="checkbox" aria-label={'Select '+item.fullName} checked={selected.includes(resourceKey(item.url))}
          onChange={e=>setSelected(prev=>e.target.checked?[...new Set([...prev,resourceKey(item.url)])]:prev.filter(x=>x!==resourceKey(item.url)))}/>
        <div className="daily-discovery-body">
          <div className="daily-discovery-title">
            <a href={item.url} target="_blank" rel="noopener noreferrer"><Github size={15}/>{item.fullName}<ExternalLink size={12}/></a>
            {isNewToday(item)&&<span className="daily-discovery-new">New today</span>}
            <span className="category-tag">{categoryOf(item)}</span>
          </div>
          <p>{item.description}</p>
          <div className="daily-discovery-metrics">
            <span><Star size={14}/>{item.stars.toLocaleString()} stars</span>
            <span><TrendingUp size={14}/>{item.starsPerDay.toLocaleString()} avg stars/day</span>
            {item.starGainSinceLastScan != null && <span>+{item.starGainSinceLastScan} stars in {item.observationHours}h observed</span>}
            <span>Created {formatDate(item.createdAt)}</span>
            {item.language && <span>{item.language}</span>}
          </div>
        </div>
        <button type="button" className="btn subtle small" onClick={()=>dismiss(item.url)} title="Hide this suggestion on this browser"><X size={14}/> Dismiss</button>
      </article>)}
      {visible.length===0 && <div className="daily-discovery-empty">
        <CheckSquare2 size={24}/><strong>{!report.generatedAt?'The first daily search has not run yet.':'No unmatched discoveries in this view.'}</strong>
        <p>{!report.generatedAt?'Use View or run daily search to run the GitHub Actions workflow. The results will appear after its report is committed and deployed.':'Try clearing your filters. Published and staged links are automatically excluded.'}</p>
      </div>}
    </div>
    {filtered.length>visible.length && <button type="button" className="btn subtle daily-discovery-more" onClick={()=>setShowAll(true)}>Show all {filtered.length} suggestions</button>}
    <p className="daily-discovery-footer">Staging sends repositories to <strong>Resource manager → Newly added</strong>. They must pass <strong>Check GitHub</strong>, receive your <strong>Approve</strong> action, and be published separately. Dismissals are saved only in this browser.</p>
  </section>;
}

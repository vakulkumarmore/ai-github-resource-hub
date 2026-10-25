import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownAZ, ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ChevronDown, ExternalLink, FilterX, Github, Grid2X2, Heart, LayoutList, LoaderCircle, Menu, Moon, Search, Shield, SlidersHorizontal, Sparkles, Star, Sun, X, ArrowUpRight, Clock3, Compass, TrendingUp, Lightbulb, RefreshCw, CalendarDays } from 'lucide-react';
import resources from './resources.json';
import { fetchMetadata, resourceKey, type Resource } from './Importer';
import Admin from './Admin';
import RepoVisual from './RepoVisual';
import NeedDiscovery from './NeedDiscovery';
import CatalogAssistant from './CatalogAssistant';
import { DISCOVERY_NEEDS, rankForNeed } from './discoveryNeeds';
import { countHashtags, hashtagKey, resourceHashtags } from './hashtagUtils';
import { apiJson } from './apiJson';
import { daysSinceUpdated, isUpdatedWithinDays, readableUpdatedAt, safeUpdatedTime } from './discoveryUtils';
import './style.css';
import './largeCatalog.css';

type Sort = 'featured' | 'name' | 'category' | 'stars' | 'recent';
type Freshness = 'all' | '30' | '90' | '365' | 'unknown';
type View = 'list' | 'grid';
const initialCatalog = resources as Resource[];
const DEFAULT_PAGE_SIZE = 24;
const number = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n);
const names = (url: string) => { const parts = new URL(url).pathname.split('/').filter(Boolean); return { owner: parts[0] || 'GitHub', repo: parts[1] || '' }; };
const readJson = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
function App() {
  const [published, setPublished] = useState<Resource[]>(initialCatalog);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogWarning, setCatalogWarning] = useState('');
  const [screen, setScreen] = useState<'library' | 'about' | 'admin'>('library');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [filterNeed, setFilterNeed] = useState<string | null>(null);
  const [dark, setDark] = useState<boolean>(() => readJson('ai-hub-dark-mode', false));
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [freshness, setFreshness] = useState<Freshness>('all');
  const [language, setLanguage] = useState('All languages');
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showGuide, setShowGuide] = useState<boolean>(() => !readJson('ai-hub-guide-dismissed-v21', false));
  const [pageSize, setPageSize] = useState<number>(() => { const stored = readJson<number>('ai-hub-page-size', DEFAULT_PAGE_SIZE); return [24,48,96].includes(stored) ? stored : DEFAULT_PAGE_SIZE; });
  const [category, setCategory] = useState('All resources');
  const [activeHashtag, setActiveHashtag] = useState('');
  const [showAllHashtags, setShowAllHashtags] = useState(false);
  const [sort, setSort] = useState<Sort>('featured');
  const [view, setView] = useState<View>(() => readJson<View>('ai-hub-view', 'list'));
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => readJson('resource-hub-favorites', []));
  const [page, setPage] = useState(1);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [stats, setStats] = useState<Record<string, Partial<Resource>>>(() => readJson('ai-hub-metadata-cache', {}));
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsNote, setStatsNote] = useState('');

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#admin')) setScreen('admin');
    else if (hash === '#about') setScreen('about');
    const onHash = () => setScreen(window.location.hash.startsWith('#admin') ? 'admin' : window.location.hash === '#about' ? 'about' : 'library');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    fetch('/api/catalog').then(r => apiJson<unknown>(r, '/api/catalog'))
      .then(data => { if (Array.isArray(data)) { setPublished(data as Resource[]); setCatalogWarning(''); } else { throw new Error('/api/catalog returned JSON but not a resource array.'); } })
      .catch(error => setCatalogWarning(error instanceof Error ? error.message : 'Unable to load the live resource catalog.'))
      .finally(() => setCatalogLoading(false));
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('ai-hub-dark-mode', JSON.stringify(dark)); }, [dark]);
  useEffect(() => { localStorage.setItem('ai-hub-view', JSON.stringify(view)); }, [view]);
  useEffect(() => { localStorage.setItem('ai-hub-page-size', JSON.stringify(pageSize)); }, [pageSize]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    published.forEach(r => counts.set(r.category || 'Uncategorized', (counts.get(r.category || 'Uncategorized') || 0) + 1));
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [published]);
  const hashtagCounts = useMemo(() => countHashtags(published), [published]);
  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    published.forEach(r => { if (r.language?.trim()) counts.set(r.language, (counts.get(r.language) || 0) + 1); });
    return [...counts.entries()].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [published]);
  const catalog = useMemo(() => published.map(r => { const meta = stats[resourceKey(r.url)]; return meta ? { ...r, stars: meta.stars ?? r.stars, forks: meta.forks ?? r.forks, updatedAt: meta.updatedAt ?? r.updatedAt } : r; }), [published, stats]);
  // Search over an indexed string per repository rather than rebuilding 1,000+ strings on every keystroke.
  const searchIndex = useMemo(() => {
    const index = new Map<string, string>();
    catalog.forEach(r => index.set(resourceKey(r.url), [r.name, r.url, r.description, r.oneLiner || '', r.category, r.language || '', ...(r.tags || []), ...resourceHashtags(r)].join(' ').toLowerCase()));
    return index;
  }, [catalog]);
  const activityCounts = useMemo(() => ({
    recent30: catalog.filter(r => r.type !== 'profile' && isUpdatedWithinDays(r.updatedAt, 30)).length,
    withDates: catalog.filter(r => safeUpdatedTime(r.updatedAt) !== null).length,
  }), [catalog]);
  const selectedNeedUrls = useMemo(() => {
    const need = DISCOVERY_NEEDS.find(item => item.id === filterNeed);
    return need ? new Set(rankForNeed(catalog, need).map(item => resourceKey(item.resource.url))) : null;
  }, [catalog, filterNeed]);
  const filtered = useMemo(() => {
    const q = deferredSearch.toLowerCase().trim();
    return catalog.filter(r => {
      if (category !== 'All resources' && r.category !== category) return false;
      if (selectedNeedUrls && !selectedNeedUrls.has(resourceKey(r.url))) return false;
      if (favoritesOnly && !(favorites.includes(resourceKey(r.url)) || favorites.includes(r.id))) return false;
      if (language !== 'All languages' && r.language !== language) return false;
      if (activeHashtag && !resourceHashtags(r).some(tag => hashtagKey(tag) === activeHashtag)) return false;
      if (freshness === 'unknown' && safeUpdatedTime(r.updatedAt) !== null) return false;
      if (freshness !== 'all' && freshness !== 'unknown' && (r.type === 'profile' || !isUpdatedWithinDays(r.updatedAt, Number(freshness)))) return false;
      if (!q) return true;
      return searchIndex.get(resourceKey(r.url))?.includes(q) || false;
    }).sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'category') return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
      if (sort === 'stars') return (b.stars ?? -1) - (a.stars ?? -1) || a.name.localeCompare(b.name);
      if (sort === 'recent') return (safeUpdatedTime(b.updatedAt) ?? -1) - (safeUpdatedTime(a.updatedAt) ?? -1) || a.name.localeCompare(b.name);
      return 0;
    });
  }, [catalog, category, activeHashtag, favoritesOnly, favorites, deferredSearch, sort, freshness, language, searchIndex, selectedNeedUrls]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const chooseCategory = (value: string) => { setFilterNeed(null); setCategory(value); setPage(1); setMobileFilters(false); };
  const chooseSearch = (value: string) => { setSearch(value); setPage(1); };
  const browseRecentlyUpdated = () => { setFilterNeed(null); setFreshness('30'); setSort('recent'); setCategory('All resources'); setFavoritesOnly(false); setActiveHashtag(''); setLanguage('All languages'); setSearch(''); setPage(1); document.getElementById('browse')?.scrollIntoView({behavior:'smooth'}); };
  const startExploring = (term: string) => { setFilterNeed(null); chooseSearch(term); setCategory('All resources'); setFreshness('all'); setLanguage('All languages'); setFavoritesOnly(false); setActiveHashtag(''); document.getElementById('browse')?.scrollIntoView({behavior:'smooth'}); };
  const dismissGuide = () => { setShowGuide(false); localStorage.setItem('ai-hub-guide-dismissed-v21','true'); };
  const chooseHashtag = (tag: string) => {
    setFilterNeed(null);
    const key = hashtagKey(tag);
    setActiveHashtag(previous => previous === key ? '' : key);
    setPage(1);
    document.getElementById('browse')?.scrollIntoView({ behavior: 'smooth' });
  };
  const toggleFavorite = (url: string) => {
    const key = resourceKey(url);
    setFavorites(old => { const next = old.includes(key) ? old.filter(x => x !== key) : [...old, key]; localStorage.setItem('resource-hub-favorites', JSON.stringify(next)); return next; });
  };
  const openAbout = () => { setAssistantOpen(false); setScreen('about'); window.location.hash = 'about'; window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openAdmin = () => { setAssistantOpen(false); setScreen('admin'); window.location.hash = 'admin'; window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openLibrary = () => { setScreen('library'); window.history.replaceState(null, '', window.location.pathname); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const loadStats = async () => {
    const candidates = visible.filter(r => r.type !== 'profile' && (r.stars == null || r.updatedAt == null)).slice(0, 10);
    if (!candidates.length) { setStatsNote('Dates and stars are already available for this page. Use Admin → Analyze All to refresh the saved catalog.'); return; }
    setStatsBusy(true); setStatsNote(`Loading GitHub details for ${candidates.length} visible repositories...`);
    let success = 0;
    const updates: Record<string, Partial<Resource>> = {};
    for (const r of candidates) {
      try { const meta = await fetchMetadata(r); updates[resourceKey(r.url)] = { stars: meta.stars, forks: meta.forks, updatedAt: meta.updatedAt }; success++; } catch { break; }
    }
    setStats(old => { const next = { ...old, ...updates }; try { localStorage.setItem('ai-hub-metadata-cache', JSON.stringify(next)); } catch {} return next; });
    setStatsNote(success < candidates.length ? `${success} updated. GitHub may be rate-limiting requests; try again later.` : `${success} repositories updated.`);
    setStatsBusy(false);
  };
  const clearFilters = () => { setFilterNeed(null); chooseCategory('All resources'); chooseSearch(''); setFavoritesOnly(false); setActiveHashtag(''); setLanguage('All languages'); setFreshness('all'); setSort('featured'); setPage(1); };
  const browseNeed = (needId: string) => {
    setFilterNeed(needId); setCategory('All resources'); setSearch(''); setFreshness('all'); setLanguage('All languages'); setActiveHashtag(''); setFavoritesOnly(false); setSort('stars'); setPage(1);
    window.location.hash = '';
    setScreen('library');
    window.setTimeout(() => document.getElementById('browse')?.scrollIntoView({behavior:'smooth'}), 40);
  };
  const activeNeedLabel = DISCOVERY_NEEDS.find(need => need.id === filterNeed)?.title || '';
  const activeHashtagLabel = hashtagCounts.find(item => hashtagKey(item.tag) === activeHashtag)?.tag || activeHashtag;
  return <div className="site-shell">
    <header className="site-header"><div className="header-inner">
      <button className="site-logo" onClick={openLibrary} aria-label="Go to AI GitHub Resource Hub home"><span className="logo-mark"><Github size={22}/></span><span className="logo-text"><strong>AI GitHub</strong><span>RESOURCE HUB</span></span></button>
      <nav className="header-nav" aria-label="Primary navigation"><button className={screen === 'library' ? 'active' : ''} onClick={openLibrary}>Explore</button><button className={screen === 'about' ? 'active' : ''} onClick={openAbout}>About</button><button className={screen === 'admin' ? 'active' : ''} onClick={openAdmin}>Admin workspace</button></nav>
      <div className="header-actions"><span className="header-count">{published.length} resources</span><button className="icon-button" title={dark ? 'Switch to light theme' : 'Switch to dark theme'} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setDark(!dark)}>{dark ? <Sun size={19}/> : <Moon size={19}/>}</button><button className="btn header-admin" onClick={openAdmin}><Shield size={16}/> Manage</button></div>
    </div></header>
    {catalogWarning && <div role="alert" className="notice" style={{margin:'12px auto',maxWidth:1100,padding:16}}><strong>Live catalog unavailable. Showing the bundled resource list.</strong><div>{catalogWarning}</div><div>Do not publish from an outdated catalog until the API is restored.</div></div>}

    {screen === 'library' ? <main className="public-main">
      <section className="intro"><div className="intro-copy"><div className="eyebrow"><Sparkles size={14}/> THE OPEN SOURCE AI DIRECTORY</div><h1>Discover brilliant tools. <span>Build what’s next.</span></h1><p>Explore handpicked AI projects, developer tools, Claude resources and automation. Real repositories, useful context, and everything organized in one place.</p><div className="intro-highlights"><span><CheckCircle2 size={16}/> Visual repo previews</span><span><CheckCircle2 size={16}/> Easy to explore</span><span><CheckCircle2 size={16}/> Always growing</span></div><div className="creator-credit"><span className="creator-avatar" aria-hidden="true">VM</span><span className="creator-copy"><span>Created &amp; curated by</span><strong className="creator-name">Vakul Kumar More</strong></span></div></div><div className="intro-aside"><div className="aside-icon"><BookOpen size={22}/></div><span className="aside-caption">EXPLORE THE COLLECTION</span><strong>{published.length.toLocaleString()}</strong><span className="aside-caption">resources across {categories.length} categories</span><button onClick={() => document.getElementById('browse')?.scrollIntoView({ behavior: 'smooth' })}>Browse all resources <ArrowRight size={16}/></button></div></section>
      <NeedDiscovery resources={catalog} activeNeedId={filterNeed} onShowAll={browseNeed} onAsk={() => setAssistantOpen(true)} />
      {showGuide && <section className="visitor-guide" aria-label="How to use the GitHub Resource Hub">
        <div className="visitor-guide-head"><div><span className="guide-eyebrow"><Lightbulb size={15}/> FIRST TIME HERE?</span><h2>Find a useful project in three steps</h2><p>You don't need to know GitHub to explore this collection.</p></div><button className="icon-button" title="Dismiss introduction" aria-label="Dismiss introduction" onClick={dismissGuide}><X size={18}/></button></div>
        <div className="guide-steps"><div><span className="guide-number">1</span><strong>Search or choose a topic</strong><p>Look for an AI tool, a language or an area you're curious about.</p></div><div><span className="guide-number">2</span><strong>Compare the projects</strong><p>Read the one-line summary and check stars and last activity where available.</p></div><div><span className="guide-number">3</span><strong>Open on GitHub</strong><p>Click View repo to explore the project's README, code and setup instructions.</p></div></div>
        <div className="guide-examples"><span>Try exploring</span><button onClick={() => startExploring('Claude')}>Claude tools</button><button onClick={() => startExploring('MCP')}>MCP servers</button><button onClick={() => startExploring('Automation')}>Automation</button><button onClick={browseRecentlyUpdated}>Recently updated <ArrowRight size={14}/></button></div>
      </section>}
      <section className="browse-section" id="browse"><div className="browse-header"><div><span className="section-eyebrow">DISCOVER & EXPLORE</span><h2>Resource library</h2><p>Browse visual repository previews, find the right tools, and bookmark your favorites.</p></div><div className="browse-summary"><span className="tiny-dot"/> {catalogLoading ? 'Syncing with GitHub' : `${published.length.toLocaleString()} available resources`}</div></div>
      {hashtagCounts.length > 0 && <section className="hashtag-discovery" aria-label="Browse popular hashtags">
        <div className="hashtag-discovery-heading">
          <div><span className="hashtag-eyebrow"><Sparkles size={15}/> DISCOVER BY TOPIC</span><h3>Explore hashtags</h3><p>Choose a topic to see matching repositories. Select it again to remove the filter.</p></div>
          {activeHashtag && <button className="hashtag-clear" onClick={() => { setActiveHashtag(''); setPage(1); }}><X size={14}/> Clear hashtag</button>}
        </div>
        <div className="hashtag-cloud">
          {hashtagCounts.slice(0, showAllHashtags ? 48 : 12).map(({ tag, count }) =>
            <button key={hashtagKey(tag)} type="button" className={`hashtag-pill ${activeHashtag === hashtagKey(tag) ? 'selected' : ''}`} aria-pressed={activeHashtag === hashtagKey(tag)} onClick={() => chooseHashtag(tag)}>
              <span>{tag}</span><span className="hashtag-count">{count}</span>
            </button>)}
          {hashtagCounts.length > 12 && <button className="hashtag-toggle" type="button" onClick={() => setShowAllHashtags(value => !value)} aria-expanded={showAllHashtags}>{showAllHashtags ? 'Show fewer' : `Show top ${Math.min(48, hashtagCounts.length)} of ${hashtagCounts.length}` } <ChevronDown size={15} className={showAllHashtags ? 'hashtag-chevron-up' : ''}/></button>}
        </div>
      </section>}
      <div className="explore-layout">
        <aside className={`category-sidebar ${mobileFilters ? 'open' : ''}`}><div className="sidebar-heading"><span>Categories</span><button className="mobile-close" onClick={() => setMobileFilters(false)} aria-label="Close filters"><X size={19}/></button></div><div className="category-list"><button className={category === 'All resources' && !favoritesOnly ? 'selected' : ''} onClick={() => { chooseCategory('All resources'); setFavoritesOnly(false); }}><BookOpen size={17}/><span>All resources</span><em>{published.length}</em></button><button className={favoritesOnly ? 'selected' : ''} onClick={() => { setFilterNeed(null); setFavoritesOnly(true); setCategory('All resources'); setPage(1); setMobileFilters(false); }}><Heart size={17}/><span>My favorites</span><em>{favorites.length}</em></button></div><div className="sidebar-divider"/><div className="category-list">{(showAllCategories || categories.length <= 12 ? categories : categories.slice(0, 12)).map(([name, count]) => <button key={name} className={category === name && !favoritesOnly ? 'selected' : ''} onClick={() => { chooseCategory(name); setFavoritesOnly(false); }}><span className="category-bullet"/><span title={name}>{name}</span><em>{count}</em></button>)}{categories.length > 12 && <button className="sidebar-more" onClick={() => setShowAllCategories(v => !v)} aria-expanded={showAllCategories}>{showAllCategories ? 'Show fewer categories' : `Show all ${categories.length} categories`} <ChevronDown size={15}/></button>}</div><div className="sidebar-note"><Sparkles size={17}/><strong>Made for discovery</strong><p>Save favorites and revisit them anytime on this device.</p></div></aside>
        <div className="browse-main">
          <div className="discovery-shortcuts" role="group" aria-label="Quick discovery options"><span>Quick explore</span><button type="button" className={freshness === '30' ? 'active' : ''} onClick={browseRecentlyUpdated}><Clock3 size={14}/> Recently updated <em>{activityCounts.recent30}</em></button><button type="button" className={sort === 'stars' ? 'active' : ''} onClick={() => { setSort('stars'); setFreshness('all'); setPage(1); }}><TrendingUp size={14}/> Most starred</button><button type="button" onClick={() => startExploring('MCP')}><Compass size={14}/> MCP tools</button><button type="button" onClick={() => startExploring('agent')}><Sparkles size={14}/> AI agents</button></div>
          <div className="search-toolbar"><label className="search-box"><Search size={20}/><input placeholder={`Search ${published.length.toLocaleString()} resources by name, topic, category or language…`} value={search} onChange={e => chooseSearch(e.target.value)} aria-label="Search GitHub resources"/>{search && <button className="search-clear" onClick={() => chooseSearch('')} aria-label="Clear search"><X size={17}/></button>}</label><button className="btn subtle mobile-filter-button" onClick={() => setMobileFilters(true)}><SlidersHorizontal size={17}/> Categories</button></div>
          <div className="advanced-filters" role="group" aria-label="Filter and sort repositories">
            <label><span><Clock3 size={14}/> Last GitHub activity</span><select value={freshness} onChange={e => { setFreshness(e.target.value as Freshness); setPage(1); }}><option value="all">Any date</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option><option value="unknown">Date unavailable</option></select></label>
            <label><span>Language</span><select value={language} onChange={e => { setLanguage(e.target.value); setPage(1); }}><option value="All languages">All languages</option>{languages.map(([lang, count]) => <option key={lang} value={lang}>{lang} ({count})</option>)}</select></label>
            <label><span><ArrowDownAZ size={14}/> Sort by</span><select value={sort} onChange={e => { setSort(e.target.value as Sort); setPage(1); }}><option value="featured">Curated order</option><option value="recent">Last updated (newest)</option><option value="stars">Most GitHub stars</option><option value="name">Name A–Z</option><option value="category">Category</option></select></label>
            <button type="button" className="filter-clear-action" onClick={clearFilters}><FilterX size={15}/> Clear filters</button>
          </div>
          <div className="activity-context" role="status"><CalendarDays size={15}/><span>Last updated reflects GitHub activity when metadata was last analyzed, not when this hub added the link. Dates are available for <strong>{activityCounts.withDates.toLocaleString()}</strong> of {catalog.length.toLocaleString()} resources.</span></div>
          <div className="result-toolbar"><div className="result-count"><strong>{filtered.length.toLocaleString()}</strong> resources {filterNeed && <span className="filter-chip">{activeNeedLabel}<button onClick={() => {setFilterNeed(null);setPage(1);}} aria-label="Clear selected use case"><X size={12}/></button></span>}{category !== 'All resources' && <span className="filter-chip">{category}<button onClick={() => chooseCategory('All resources')} aria-label="Clear category"><X size={12}/></button></span>}{favoritesOnly && <span className="filter-chip">Favorites <button onClick={() => setFavoritesOnly(false)} aria-label="Clear favorites"><X size={12}/></button></span>}{freshness !== 'all' && <span className="filter-chip">{freshness === 'unknown' ? 'Date unavailable' : `Updated in ${freshness} days`}<button onClick={() => setFreshness('all')} aria-label="Clear activity filter"><X size={12}/></button></span>}{language !== 'All languages' && <span className="filter-chip">{language}<button onClick={() => setLanguage('All languages')} aria-label="Clear language filter"><X size={12}/></button></span>}{activeHashtag && <span className="filter-chip">{activeHashtagLabel}<button onClick={() => { setActiveHashtag(''); setPage(1); }} aria-label="Clear hashtag filter"><X size={12}/></button></span>}</div><div className="result-actions"><button className="stats-trigger" disabled={statsBusy || !visible.length} onClick={loadStats}>{statsBusy ? <LoaderCircle className="spin" size={15}/> : <Star size={15}/>} Fill missing GitHub details</button><div className="view-switch" role="group" aria-label="Display style"><button title="List view" aria-label="List view" aria-pressed={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><LayoutList size={18}/></button><button title="Grid view" aria-label="Grid view" aria-pressed={view === 'grid'} className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}><Grid2X2 size={18}/></button></div></div></div>
          {statsNote && <div className="stats-note" role="status">{statsNote} <button onClick={() => setStatsNote('')} aria-label="Dismiss message"><X size={14}/></button></div>}
          <div className={`resource-results ${view === 'grid' ? 'grid-view' : 'list-view'}`}>{visible.map(r => <ResourceItem key={resourceKey(r.url)} resource={r} favorite={(favorites.includes(resourceKey(r.url)) || favorites.includes(r.id))} onToggle={() => toggleFavorite(r.url)} onTag={chooseHashtag}/>)}</div>
          {!filtered.length && <div className="empty-state"><FilterX size={33}/><h3>No resources found</h3><p>Try different keywords, clear your filters, or choose another category. If you filtered for recent updates, some repositories may not have an activity date yet.</p><button className="btn primary" onClick={clearFilters}>Clear all filters</button></div>}
          {!!filtered.length && <div className="pagination"><span>Showing <strong>{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)}</strong> of {filtered.length.toLocaleString()}</span><div className="page-controls"><label className="page-size-control">Per page <select aria-label="Resources per page" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}><option value={24}>24</option><option value={48}>48</option><option value={96}>96</option></select></label><button className="btn subtle small" disabled={currentPage === 1} onClick={() => { setPage(p => p - 1); document.getElementById('browse')?.scrollIntoView(); }}><ArrowLeft size={15}/> Previous</button><span className="page-number">{currentPage} / {totalPages}</span><button className="btn subtle small" disabled={currentPage === totalPages} onClick={() => { setPage(p => p + 1); document.getElementById('browse')?.scrollIntoView(); }}>Next <ArrowRight size={15}/></button></div></div>}
        </div>
      </div></section>
    </main> : screen === 'about' ? <main className="about-page" id="about">
      <div className="about-page-inner">
        <button className="about-breadcrumb" onClick={openLibrary}><ArrowLeft size={16}/> Back to resources</button>
        <header className="about-heading">
          <p className="about-overline">ABOUT THE CREATOR</p>
          <h1>Hi, I’m Vakul Kumar More.</h1>
          <p className="about-deck">I work with technology to solve real problems, and I believe finding useful tools should be simple.</p>
        </header>
        <div className="about-facts" aria-label="Professional background">
          <span>21 years of experience</span><span className="about-separator" aria-hidden="true">·</span><span>Public-sector technology</span><span className="about-separator" aria-hidden="true">·</span><span>AI &amp; automation</span>
        </div>
        <section className="about-text-block" aria-labelledby="about-background">
          <h2 id="about-background">A little about me</h2>
          <p>I’m a technology professional with 21 years of experience developing and supporting digital solutions, including work with Baltimore City government. My background spans enterprise applications, IT portfolio management, DevOps, data analytics, Microsoft Power Platform, and automation.</p>
          <p>I’m especially interested in practical uses of AI that make everyday work easier. I also enjoy sharing what I learn and supporting STEM and community initiatives.</p>
        </section>
        <section className="about-text-block" aria-labelledby="about-why">
          <h2 id="about-why">Why I created this hub</h2>
          <p>I often come across excellent open-source projects, but useful GitHub links can quickly get lost across bookmarks, messages, and notes. I built <strong>AI GitHub Resource Hub</strong> to organize those finds into one searchable collection.</p>
          <p>My goal is simple: help people discover a useful project, understand what it does, and get started faster. I’ll keep expanding the library as I find resources worth sharing.</p>
        </section>
        <div className="about-next">
          <div><strong>Ready to explore?</strong><p>Browse the library of AI tools, frameworks, and developer resources.</p></div>
          <button className="btn primary" onClick={openLibrary}>Explore resources <ArrowRight size={16}/></button>
        </div>
      </div>
    </main> : catalogLoading ? <div className="workspace auth-message"><LoaderCircle className="spin"/> Loading published resources...</div> : <Admin publishedCatalog={published} onSaved={items => { setPublished(items); setCatalogLoading(false); }} onBack={openLibrary}/>}
    {screen === 'library' && <CatalogAssistant resources={catalog} open={assistantOpen} onOpenChange={setAssistantOpen} onExplore={browseNeed} onSearch={startExploring} />}
    <footer className="site-footer"><div><span className="footer-logo"><Github size={18}/> AI GitHub Resource Hub</span><span>Created &amp; curated by <strong className="footer-author">Vakul Kumar More</strong></span><button className="footer-about-link" onClick={openAbout}>About the Creator <ArrowUpRight size={13}/></button></div><span>Independent resource directory · Powered by GitHub &amp; Cloudflare</span></footer>
  </div>;
}

type ItemProps = { resource: Resource; favorite: boolean; onToggle: () => void; onTag: (tag: string) => void };
function ResourceItem({ resource: r, favorite, onToggle, onTag }: ItemProps) {
  const { owner, repo } = names(r.url);
  return <article className="resource-item">
    <div className="item-top">
      <RepoVisual resource={r} />
      <div className="resource-details">
        <div className="resource-title-line">
          <a className="resource-name" href={r.url} target="_blank" rel="noopener noreferrer">{r.name}<ExternalLink size={14}/></a>
          <span className="category-tag">{r.category || 'Uncategorized'}</span>
        </div>
        <div className="resource-path">{owner}{repo && <span> / {repo}</span>}</div>
        <p className="resource-description" title={r.oneLiner ? r.description : undefined}>{r.oneLiner || r.description}</p>
        <div className="resource-bottom">
          <div className="resource-tags">{resourceHashtags(r).slice(0, 4).map(tag => <button onClick={() => onTag(tag)} key={hashtagKey(tag)} title={`Filter by ${tag}`}>{tag}</button>)}</div>
          <div className="resource-meta">
            {r.language && <span className="meta-lang"><span className="language-dot"/>{r.language}</span>}
            {typeof r.stars === 'number' && <span title="GitHub stars"><Star size={14}/>{number(r.stars)}</span>}
            {r.type !== 'profile' && <span className={`resource-updated ${daysSinceUpdated(r.updatedAt) !== null && daysSinceUpdated(r.updatedAt)! <= 90 ? 'is-recent' : ''}`} title={safeUpdatedTime(r.updatedAt) !== null ? `Last GitHub activity recorded: ${new Date(safeUpdatedTime(r.updatedAt)!).toLocaleString('en-US', {dateStyle:'medium', timeStyle:'short'})}` : 'GitHub activity date is not available in this catalog'}><Clock3 size={13}/>{safeUpdatedTime(r.updatedAt) !== null ? `Updated ${readableUpdatedAt(r.updatedAt)}` : 'Update date unavailable'}</span>}
          </div>
        </div>
      </div>
      <div className="resource-quick">
        <button className={`favorite-toggle ${favorite ? 'is-favorite' : ''}`} onClick={onToggle} aria-label={favorite ? `Remove ${r.name} from favorites` : `Add ${r.name} to favorites`} title="Save to favorites"><Heart size={18} fill={favorite ? 'currentColor' : 'none'}/></button>
        {r.homepage?.startsWith('https://') && <a className="homepage-link" href={r.homepage} target="_blank" rel="noopener noreferrer" title="Project website">Website <ArrowUpRight size={14}/></a>}<a className="visit-button" href={r.url} target="_blank" rel="noopener noreferrer">View repo <ArrowRight size={16}/></a>
      </div>
    </div>
  </article>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

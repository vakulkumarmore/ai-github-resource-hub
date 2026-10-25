import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bot, BookOpen, Check, Code2, Cpu, Database, ExternalLink, Film, Image, MessageCircle, Mic, Palette, Plug, Puzzle, Search, ShieldCheck, Sparkles, Star, Workflow, X } from 'lucide-react';
import type { Resource } from './Importer';
import { DISCOVERY_NEEDS, rankForNeed, type Need } from './discoveryNeeds';
import RepoVisual from './RepoVisual';
import './needDiscovery.css';

const icons: Record<string, typeof Film> = {
  film: Film, bot: Bot, puzzle: Puzzle, sparkles: Sparkles, palette: Palette,
  code: Code2, plug: Plug, image: Image, mic: Mic, workflow: Workflow,
  database: Database, cpu: Cpu, shield: ShieldCheck, book: BookOpen,
};

type Props = { resources: Resource[]; activeNeedId: string | null; onShowAll: (id: string) => void; onAsk: () => void };
export default function NeedDiscovery({resources, activeNeedId, onShowAll, onAsk}: Props) {
  const [selected, setSelected] = useState('video');
  useEffect(() => { if (activeNeedId) setSelected(activeNeedId); }, [activeNeedId]);
  const [allCategories, setAllCategories] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const summaries = useMemo(() => DISCOVERY_NEEDS.map(need => ({need, ranked:rankForNeed(resources, need)})), [resources]);
  const chosen = summaries.find(row => row.need.id === selected) || summaries[0];
  const choose = (id: string) => { setSelected(id); setTimeout(() => topRef.current?.scrollIntoView({behavior:'smooth', block:'nearest'}), 0); };
  const visible = allCategories ? summaries : summaries.slice(0, 8);
  return <section className="need-discovery" aria-labelledby="need-discovery-title">
    <div className="need-discovery-header">
      <div><span className="need-eyebrow"><Sparkles size={15}/> START WITH YOUR GOAL</span><h2 id="need-discovery-title">What do you want to do?</h2><p>Choose a task. We'll show the most relevant open-source projects instead of making you browse the entire catalog.</p></div>
      <button type="button" className="need-ask-cta" onClick={onAsk}><MessageCircle size={17}/> Describe your need <ArrowRight size={15}/></button>
    </div>
    <div className="need-card-grid">
      {visible.map(({need, ranked}) => {
        const Icon = icons[need.icon] || Sparkles;
        return <button type="button" key={need.id} className={`need-card need-${need.tone} ${selected === need.id ? 'is-selected' : ''}`} onClick={() => choose(need.id)} aria-pressed={selected === need.id}>
          <span className="need-icon"><Icon size={23}/></span>
          <span className="need-card-title">{need.title}</span>
          <span className="need-card-desc">{need.description}</span>
          <span className="need-card-foot">{ranked.length.toLocaleString()} matching {ranked.length === 1 ? 'repo' : 'repos'}<span>Top 10 <ArrowRight size={14}/></span></span>
        </button>;
      })}
    </div>
    {summaries.length > 8 && <div className="need-more-wrap"><button type="button" className="need-more" onClick={() => setAllCategories(value => !value)}>{allCategories ? 'Show fewer needs' : `See all ${summaries.length} use cases`} <ArrowRight size={15}/></button></div>}
    {chosen && <div className="need-top-panel" ref={topRef}>
      <div className="need-top-head"><div><span className="need-eyebrow">DISCOVER TOP REPOSITORIES</span><h3>{chosen.ranked.length ? `Top ${Math.min(10,chosen.ranked.length)} for ${chosen.need.title}` : `Explore ${chosen.need.title}`}</h3><p>Ranked by topic match, with GitHub stars and activity as tie-breakers where available.</p></div><button type="button" disabled={!chosen.ranked.length} onClick={() => onShowAll(chosen.need.id)}>Browse all {chosen.ranked.length} <ArrowRight size={16}/></button></div>
      {chosen.ranked.length ? <div className="need-top-list">{chosen.ranked.slice(0,10).map(({resource}, index) => <a className="need-top-item" key={resource.url} href={resource.url} target="_blank" rel="noopener noreferrer">
        <span className="need-rank">{index + 1}</span><div className="need-top-avatar"><RepoVisual resource={resource}/></div>
        <span className="need-top-copy"><strong>{resource.name}</strong><small>{resource.oneLiner || resource.description || 'View project on GitHub'}</small></span>
        <span className="need-top-stats">{typeof resource.stars === 'number' && <span><Star size={13}/> {resource.stars.toLocaleString('en-US')}</span>}<ExternalLink size={15}/></span>
      </a>)}</div> : <div className="need-top-empty"><Search size={22}/><strong>No confidently matched resources yet</strong><p>You can still search the full library or add projects for this category in your Admin Workspace.</p></div>}
      <div className="need-disclaimer"><Check size={14}/> Top 10 is an automated discovery list, not a community rating, product endorsement or security audit.</div>
    </div>}
  </section>;
}

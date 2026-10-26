import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, GitCompareArrows, Minus, RotateCcw, Star, X } from 'lucide-react';
import type { Resource } from './Importer';
import './compareTray.css';

type Props = {
  selected: Resource[];
  onRemove: (url: string) => void;
  onClear: () => void;
};
const show = (value?: string | number | null) => value === undefined || value === null || value === '' ? 'Not listed' : String(value);
const activity = (updated?: string) => {
  if (!updated) return 'Not available';
  const time = Date.parse(updated);
  if (!Number.isFinite(time)) return 'Not available';
  return new Date(time).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
};
export default function CompareTray({ selected, onRemove, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {if (event.key === 'Escape') setOpen(false);};
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => { if (selected.length < 2) setOpen(false); }, [selected.length]);
  if (!selected.length) return null;
  return <>
    <aside className="compare-tray" aria-label="Selected repositories for comparison">
      <div className="compare-tray-heading"><GitCompareArrows size={19}/><div><strong>Help me choose</strong><small>{selected.length} of 3 repositories selected</small></div></div>
      <div className="compare-tray-list">{selected.map(repo => <span className="compare-tray-pill" key={repo.url}>{repo.name}<button type="button" onClick={() => onRemove(repo.url)} title={`Remove ${repo.name}`} aria-label={`Remove ${repo.name}`}><X size={12}/></button></span>)}</div>
      <div className="compare-tray-actions"><button type="button" className="compare-tray-clear" onClick={onClear}><RotateCcw size={14}/> Clear</button><button type="button" className="compare-tray-primary" disabled={selected.length < 2} onClick={() => setOpen(true)}>Compare {selected.length} <ArrowRight size={16}/></button></div>
    </aside>
    {open && <div className="compare-modal-backdrop" onMouseDown={event => {if (event.target === event.currentTarget) setOpen(false);}}>
      <section role="dialog" aria-modal="true" aria-labelledby="compare-title" className="compare-modal">
        <div className="compare-modal-header"><div><span className="compare-overline">SIDE-BY-SIDE COMPARISON</span><h2 id="compare-title">Which repository fits your goal?</h2><p>Compare documented repository details. Stars and activity do not prove quality, security, or suitability.</p></div><button ref={closeRef} className="compare-close" type="button" onClick={() => setOpen(false)} aria-label="Close comparison"><X size={21}/></button></div>
        <div className="compare-table-scroll"><table className="compare-table"><thead><tr><th scope="col">Compare</th>{selected.map(r => <th scope="col" key={r.url}><div className="compare-repo-heading"><strong>{r.name}</strong><span>{r.category || 'Uncategorized'}</span><a href={r.url} target="_blank" rel="noopener noreferrer">Open on GitHub <ArrowRight size={13}/></a></div></th>)}</tr></thead><tbody>
          <tr><th scope="row">What it does</th>{selected.map(r => <td key={r.url}>{r.oneLiner || r.description || 'No summary available'}</td>)}</tr>
          <tr><th scope="row">Category</th>{selected.map(r => <td key={r.url}>{show(r.category)}</td>)}</tr>
          <tr><th scope="row">Language</th>{selected.map(r => <td key={r.url}>{show(r.language)}</td>)}</tr>
          <tr><th scope="row">GitHub stars</th>{selected.map(r => <td key={r.url}>{typeof r.stars === 'number' ? <span className="compare-metric"><Star size={14}/>{r.stars.toLocaleString('en-US')}</span> : 'Not available'}</td>)}</tr>
          <tr><th scope="row">Last GitHub activity*</th>{selected.map(r => <td key={r.url}>{activity(r.updatedAt)}</td>)}</tr>
          <tr><th scope="row">License</th>{selected.map(r => <td key={r.url}>{show(r.license)}</td>)}</tr>
          <tr><th scope="row">Topics</th>{selected.map(r => <td key={r.url}><div className="compare-topic-list">{(r.tags || []).slice(0, 5).map(tag => <span key={tag}>{tag}</span>)}{!r.tags?.length && <span className="compare-no-value">Not listed</span>}</div></td>)}</tr>
        </tbody></table></div>
        <footer className="compare-modal-footer"><span><Check size={14}/> *Dates reflect saved GitHub metadata, not a live status check. Review each README before using a project.</span><button type="button" onClick={() => setOpen(false)}>Done</button></footer>
      </section>
    </div>}
  </>;
}

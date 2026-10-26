import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Check, GitCompareArrows, MessageCircle, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import type { Resource } from './Importer';
import { respondFromCatalog, type ChatContext } from './chatDiscovery';
import './catalogAssistant.css';

type Message = { role: 'visitor' | 'assistant'; text: string; resources?: Resource[]; total?: number; suggestions?: string[]; needId?: string };
type Props = {
  resources: Resource[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExplore: (needId: string) => void;
  onSearch: (term: string) => void;
  onCompare: (url: string) => void;
  isCompared: (url: string) => boolean;
  comparisonCount: number;
};
const prompts = ['Generate videos from text', 'Build an AI agent', 'Find Claude skills', 'Design a website'];
const greeting: Message = { role: 'assistant', text: 'Hi! 👋 What are you trying to build? Tell me in your own words and I’ll suggest matching GitHub projects from this library.' };
export default function CatalogAssistant({ resources, open, onOpenChange, onExplore, onSearch, onCompare, isCompared, comparisonCount }: Props) {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([greeting]);
  const [context, setContext] = useState<ChatContext | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { if (open) scrollRef.current?.scrollTo({top: scrollRef.current.scrollHeight, behavior:'smooth'}); }, [messages, open]);
  const ask = (question: string) => {
    const q = question.trim().slice(0, 300);
    if (!q) return;
    if (q === 'Start a new search') { setContext(undefined); setMessages([greeting]); setQuery(''); inputRef.current?.focus(); return; }
    const answer = respondFromCatalog(resources, q, context);
    setContext(answer.next);
    setMessages(current => [...current,
      { role:'visitor', text:q },
      { role:'assistant', text:answer.text, resources:answer.results, total:answer.total, suggestions:answer.suggestions, needId:answer.next.needId },
    ]);
    setQuery('');
  };
  const reset = () => {setContext(undefined);setMessages([greeting]);setQuery('');inputRef.current?.focus();};
  return <>
    {!open && <button type="button" className="catalog-assistant-launcher" onClick={() => onOpenChange(true)} aria-label="Open Resource Finder chat"><MessageCircle size={20}/><span>Ask Resource Finder</span></button>}
    {open && <section role="dialog" aria-modal="false" aria-label="Resource Finder chat" className="catalog-chat-panel">
      <div className="catalog-chat-head"><div className="catalog-chat-headmark"><Bot size={22}/></div><div className="catalog-chat-heading"><strong>Resource Finder</strong><span><i className="catalog-chat-online"/> Search {resources.length.toLocaleString()} curated links</span></div><button type="button" onClick={reset} title="New conversation" aria-label="Start a new conversation"><RotateCcw size={17}/></button><button type="button" onClick={() => onOpenChange(false)} title="Close chat" aria-label="Close Resource Finder"><X size={19}/></button></div>
      <div className="catalog-chat-messages" ref={scrollRef} aria-live="polite" aria-relevant="additions">
        {messages.map((message, index) => <div key={index} className={`catalog-chat-message ${message.role}`}>
          {message.role === 'assistant' && <div className="catalog-chat-mini-avatar" aria-hidden="true"><Bot size={14}/></div>}
          <div className="catalog-chat-message-content">
            <div className="catalog-chat-bubble">{message.text}</div>
            {!!message.resources?.length && <div className="catalog-chat-results">
              {message.resources.map(repo => <article key={repo.url} className="catalog-chat-result">
                <div className="catalog-chat-repo-top"><strong>{repo.name}</strong><span>{repo.category || 'Repository'}</span></div>
                <p>{repo.oneLiner || repo.description || 'See details in the GitHub README.'}</p>
                <div className="catalog-chat-result-actions"><a href={repo.url} target="_blank" rel="noopener noreferrer">View repository <ArrowRight size={13}/></a><button type="button" className={isCompared(repo.url) ? 'is-selected' : ''} onClick={() => onCompare(repo.url)} aria-pressed={isCompared(repo.url)} disabled={!isCompared(repo.url) && comparisonCount >= 3}>{isCompared(repo.url) ? <Check size={13}/> : <GitCompareArrows size={13}/>} {isCompared(repo.url) ? 'Selected' : 'Compare'}</button></div>
              </article>)}
              {!!message.needId && <button type="button" className="catalog-chat-explore" onClick={() => {onOpenChange(false);onExplore(message.needId!);}}>Browse all matching projects <ArrowRight size={14}/></button>}
            </div>}
            {message.role === 'assistant' && (!!message.suggestions?.length || index === 0) && <div className="catalog-chat-prompts"><span>{index === 0 ? 'POPULAR REQUESTS' : 'KEEP EXPLORING'}</span><div>{(index === 0 ? prompts : message.suggestions || []).map(prompt => <button key={prompt} type="button" onClick={() => ask(prompt)}><Sparkles size={12}/>{prompt}</button>)}</div></div>}
          </div>
        </div>)}
      </div>
      {comparisonCount >= 2 && <div className="catalog-chat-compare-hint"><GitCompareArrows size={16}/><span>{comparisonCount} repositories ready to compare</span><button type="button" onClick={() => onOpenChange(false)}>View comparison <ArrowRight size={13}/></button></div>}
      <form className="catalog-chat-form" onSubmit={event => {event.preventDefault(); ask(query);}}><input ref={inputRef} aria-label="Ask Resource Finder" maxLength={300} placeholder="Ask a question or describe a task…" value={query} onChange={e => setQuery(e.target.value)}/><button type="submit" disabled={!query.trim()} aria-label="Send message"><Send size={18}/></button></form>
      <p className="catalog-chat-footnote">Searches this site's published catalog, not the whole web. Suggestions use saved metadata; this is not a generative AI chatbot. <button type="button" onClick={() => {onOpenChange(false);onSearch(context?.topic || '');}}>Open full search <ArrowRight size={12}/></button></p>
    </section>}
  </>;
}

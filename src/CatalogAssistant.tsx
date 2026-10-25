import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, ExternalLink, MessageCircle, Search, Send, Sparkles, X } from 'lucide-react';
import type { Resource } from './Importer';
import { recommendationForQuestion } from './discoveryNeeds';
import './catalogAssistant.css';

type Message = { role: 'visitor' | 'assistant'; text: string; resources?: Resource[]; total?: number; needId?: string };
type Props = { resources: Resource[]; open: boolean; onOpenChange: (open: boolean) => void; onExplore: (needId: string) => void; onSearch: (term: string) => void };
const prompts = ['I want to generate videos', 'Help me build AI agents', 'Find Claude skills', 'Show me design tools'];

/** A transparent, on-device catalog search assistant. No prompts leave the visitor's browser. */
export default function CatalogAssistant({resources, open, onOpenChange, onExplore, onSearch}: Props) {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([{
    role:'assistant',
    text:'What would you like to build or explore? Tell me your goal and I’ll find relevant repositories in this hub.',
  }]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({top: scrollRef.current.scrollHeight, behavior:'smooth'});
  }, [messages, open]);
  const ask = (question: string) => {
    const trimmed = question.trim().slice(0, 250);
    if (!trimmed) return;
    const {need, results, total} = recommendationForQuestion(resources, trimmed, 5);
    const text = results.length
      ? `Here ${results.length === 1 ? 'is a repository' : `are ${results.length} repositories`} matching ${need ? need.title.toLowerCase() : 'your request'}. ${total > results.length ? `I found ${total} matches in the hub.` : ''} Open the GitHub README to confirm each project's capabilities and setup.`
      : `I couldn't find a confident match in the current catalog. Try a shorter term, or select a topic below.`;
    setMessages(previous => [...previous, {role:'visitor', text:trimmed}, {role:'assistant', text, resources:results, total, needId:need?.id}]);
    setQuery('');
  };
  const closeAndExplore = (needId: string) => { onOpenChange(false); onExplore(needId); };
  return <>
    {!open && <button type="button" className="catalog-assistant-launcher" onClick={() => onOpenChange(true)} aria-label="Open resource search assistant"><MessageCircle size={20}/><span>Find a tool</span></button>}
    {open && <section role="dialog" aria-modal="false" aria-label="GitHub resource search assistant" className="catalog-chat-panel">
      <div className="catalog-chat-head"><div className="catalog-chat-headmark"><Bot size={21}/></div><div><strong>Resource Finder</strong><span>Ask what you want to do</span></div><button type="button" onClick={() => onOpenChange(false)} title="Close assistant" aria-label="Close resource finder"><X size={19}/></button></div>
      <div className="catalog-chat-messages" ref={scrollRef} aria-live="polite">
        {messages.map((message, index) => <div key={index} className={`catalog-chat-message ${message.role}`}>
          <div className="catalog-chat-bubble">{message.text}</div>
          {!!message.resources?.length && <div className="catalog-chat-results">
            {message.resources.map(repo => <a key={repo.url} href={repo.url} target="_blank" rel="noopener noreferrer" className="catalog-chat-result">
              <span><strong>{repo.name}</strong><small>{repo.oneLiner || repo.description || repo.category}</small></span><ExternalLink size={14}/>
            </a>)}
            {message.needId ? <button type="button" className="catalog-chat-explore" onClick={() => closeAndExplore(message.needId!)}>Explore all {message.total} matching repositories <ArrowRight size={15}/></button> : <button type="button" className="catalog-chat-explore" onClick={() => { onOpenChange(false); onSearch(messages.slice(0, index).reverse().find(m=>m.role === 'visitor')?.text || ''); }}>Search the full library <Search size={14}/></button>}
          </div>}
        </div>)}
        {messages.length === 1 && <div className="catalog-chat-prompts"><span>Try asking</span>{prompts.map(prompt => <button type="button" key={prompt} onClick={() => ask(prompt)}><Sparkles size={13}/>{prompt}</button>)}</div>}
      </div>
      <form className="catalog-chat-form" onSubmit={event => {event.preventDefault(); ask(query);}}><input ref={inputRef} aria-label="What do you want to build?" maxLength={250} placeholder="e.g., generate videos from text" value={query} onChange={e => setQuery(e.target.value)}/><button type="submit" disabled={!query.trim()} aria-label="Find repositories"><Send size={17}/></button></form>
      <p className="catalog-chat-footnote">Searches this catalog only. No AI service or chat data upload. Results are suggestions, not endorsements.</p>
    </section>}
  </>;
}

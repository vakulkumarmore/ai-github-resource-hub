import type { Resource } from './Importer';
import { recommendationForQuestion } from './discoveryNeeds';

export type ChatContext = {
  topic: string;
  needId?: string;
  language?: string;
  recentDays?: number;
  mostStarred?: boolean;
  offset: number;
};
export type ChatAnswer = {
  text: string;
  results: Resource[];
  total: number;
  next: ChatContext;
  suggestions: string[];
};
const LANGUAGES = ['Python', 'TypeScript', 'JavaScript', 'Go', 'Rust', 'Java', 'C#', 'C++', 'Ruby', 'Swift', 'Kotlin', 'PHP'];
const normal = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const days = (date?: string) => { const n = Date.parse(date || ''); return Number.isFinite(n) && n <= Date.now() ? (Date.now() - n) / 86400000 : null; };
const isFollowUp = (q: string) => /^(show more|more options|more results|what else|anything else|only |just |filter |most (starred|popular)|sort by (stars|popularity)|recent(ly)?|updated (recently|in)|last (30|90) days|compare (them|these)|which (one|ones)|and (python|javascript|typescript|rust|go)|what about (python|javascript|typescript|rust|go))/i.test(q);

/** A deterministic, local-only catalog search. Never infers quality or safety from star counts. */
export function respondFromCatalog(resources: Resource[], question: string, previous?: ChatContext, pageSize = 4): ChatAnswer {
  const raw = question.trim().slice(0, 300);
  const q = normal(raw);
  const more = /^(show more|more options|more results|what else|anything else)\b/.test(q);
  const followUp = !!previous && (more || isFollowUp(q));
  const topic = followUp ? previous!.topic : raw;
  const askedLanguage = LANGUAGES.find(language => new RegExp(`\\b${language.toLowerCase().replace(/[+]/g, '\\+')}\\b`, 'i').test(q));
  const language = followUp ? (askedLanguage || previous!.language) : askedLanguage;
  const wantsRecent = /recent|last (30|90) days|updated/.test(q);
  const recentDays = wantsRecent ? (/90/.test(q) ? 90 : 30) : followUp ? previous!.recentDays : undefined;
  const mostStarred = /most (starred|popular)|sort by (stars|popularity)/.test(q) ? true : followUp ? previous!.mostStarred : false;
  const offset = more && previous ? previous.offset + pageSize : 0;
  const {need, results: initial} = recommendationForQuestion(resources, topic, resources.length);
  let matches = initial;
  if (language) matches = matches.filter(r => normal(r.language || '') === normal(language));
  if (recentDays) matches = matches.filter(r => { const age = days(r.updatedAt); return age !== null && age <= recentDays; });
  if (mostStarred) matches = [...matches].sort((a,b) => (b.stars ?? -1) - (a.stars ?? -1));
  const results = matches.slice(offset, offset + pageSize);
  const scope = [need?.title.toLowerCase() || 'your search', language, recentDays ? `updated within ${recentDays} days` : '', mostStarred ? 'sorted by GitHub stars' : ''].filter(Boolean).join(' · ');
  let text = '';
  if (results.length) {
    text = more ? `Here are ${results.length} more matches for ${scope}.` : `I found ${matches.length} matching ${matches.length === 1 ? 'project' : 'projects'} for ${scope}. Here are ${results.length} to start with.`;
  } else if (matches.length && more) {
    text = 'You’ve reached the end of these matches. You can change your filters or explore a different goal.';
  } else if (language || recentDays) {
    text = `I couldn't find a match with those filters${language ? ` (${language})` : ''}${recentDays ? ` (last ${recentDays} days)` : ''}. Try removing a filter or describing your goal differently.`;
  } else {
    text = 'I could not find a confident match in the published library. Try naming a task, framework, or technology, such as “video generation” or “Claude skills.”';
  }
  const suggestions = results.length ? [
    ...(offset + pageSize < matches.length ? ['Show more'] : []),
    ...(!mostStarred ? ['Most starred'] : []),
    ...(!recentDays ? ['Updated recently'] : []),
    ...(!language ? ['Only Python'] : []),
    'Start a new search',
  ] : ['Start a new search', 'Video generation', 'Claude skills', 'AI agents'];
  return { text, results, total: matches.length, suggestions: suggestions.slice(0, 4), next: {topic, needId:need?.id, language, recentDays, mostStarred, offset} };
}

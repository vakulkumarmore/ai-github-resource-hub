import type { Resource } from './Importer';
import { cleanHashtag, suggestHashtags } from './resourceAnalysis';

/**
 * Display saved hashtags first. Older catalog entries automatically receive
 * display-only suggestions from their curated categories and GitHub topics.
 * Display-only suggestions never modify src/resources.json or the admin draft.
 */
export function resourceHashtags(resource: Resource): string[] {
  const explicit = (resource.hashtags || []).map(cleanHashtag).filter(Boolean);
  const suggested = suggestHashtags({
    name: resource.name,
    category: resource.category,
    topics: resource.tags || [],
  });
  const fallbackCategory = cleanHashtag(resource.category || '');
  const candidates = explicit.length ? explicit : [fallbackCategory, ...suggested];
  const unique = new Map<string, string>();
  for (const tag of candidates) {
    const normalized = cleanHashtag(tag);
    if (normalized && !unique.has(normalized.toLowerCase())) unique.set(normalized.toLowerCase(), normalized);
  }
  return Array.from(unique.values()).slice(0, 6);
}

export function hashtagKey(tag: string): string {
  return cleanHashtag(tag).toLowerCase();
}

export type HashtagCount = { tag: string; count: number };

/** One count per repository, not per repeated occurrence. */
export function countHashtags(catalog: Resource[]): HashtagCount[] {
  const counts = new Map<string, HashtagCount>();
  for (const resource of catalog) {
    for (const tag of resourceHashtags(resource)) {
      const key = hashtagKey(tag);
      if (key === '#opensource') continue; // generic topic should not swamp discovery
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

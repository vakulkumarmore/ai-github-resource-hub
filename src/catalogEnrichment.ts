import type { Resource } from './Importer';

/** These settings deliberately default to non-destructive enrichment. */
export type EnrichmentOptions = {
  refreshMetadata: boolean;
  fillMissingEditorial: boolean;
  replaceEditorial: boolean;
};
export const defaultEnrichmentOptions: EnrichmentOptions = {
  refreshMetadata: true,
  fillMissingEditorial: true,
  replaceEditorial: false,
};

export type EnrichmentChange = {
  field: keyof Resource;
  label: string;
  before: string;
  after: string;
};
export type EnrichmentProposal = {
  resource: Resource;
  patch: Partial<Resource>;
  changes: EnrichmentChange[];
};

const metadataFields: Array<keyof Resource> = [
  'stars', 'forks', 'updatedAt', 'language', 'license', 'homepage',
];
const editorialFields: Array<keyof Resource> = [
  'description', 'category', 'oneLiner', 'tags', 'hashtags',
];
const names: Record<string, string> = {
  stars: 'Stars', forks: 'Forks', updatedAt: 'Last updated', language: 'Language',
  license: 'License', homepage: 'Project homepage', description: 'Description',
  category: 'Category', oneLiner: 'One-line summary', tags: 'Topics / tags',
  hashtags: 'Hashtags',
};
const isBlank = (value: unknown) => value == null || value === '' || (Array.isArray(value) && value.length === 0);
const isPlaceholder = (field: keyof Resource, value: unknown): boolean => {
  if (isBlank(value)) return true;
  if (typeof value !== 'string') return false;
  if (field === 'category') return /^(uncategorized|unknown|other)$/i.test(value.trim());
  if (field === 'description') return /^(github (repository by|profile for)|explore the .* project on github\.?)/i.test(value.trim());
  if (field === 'oneLiner') return /^explore (the )?.*(project on github|a github project tagged|an open-source project written in)/i.test(value.trim());
  return false;
};
const format = (value: unknown) => Array.isArray(value) ? value.join(', ') : (value == null ? 'Not set' : String(value));
const equivalent = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Convert the metadata suggestion into a safe patch. No repo identity fields (id, url)
 * are touched. By default existing editorial text and curated tags survive intact.
 */
export function buildEnrichmentProposal(
  original: Resource,
  suggested: Partial<Resource>,
  options: EnrichmentOptions = defaultEnrichmentOptions,
): EnrichmentProposal {
  const patch: Partial<Resource> = {};
  const changes: EnrichmentChange[] = [];
  const add = (field: keyof Resource, candidate: unknown) => {
    const current = original[field];
    if (isBlank(candidate) || equivalent(current, candidate)) return;
    (patch as Record<string, unknown>)[field] = candidate;
    changes.push({field, label: names[field] || field, before: format(current), after: format(candidate)});
  };
  if (options.refreshMetadata) {
    metadataFields.forEach(field => add(field, suggested[field]));
  }
  if (options.fillMissingEditorial || options.replaceEditorial) {
    editorialFields.forEach(field => {
      if (options.replaceEditorial || isPlaceholder(field, original[field])) add(field, suggested[field]);
    });
  }
  return {resource: original, patch, changes};
}

/** Uses only current draft values at apply time, so later manual edits aren't silently lost. */
export function applyEnrichment(
  draft: Resource[],
  suggestions: ReadonlyMap<string, Partial<Resource>>,
  selected: ReadonlySet<string>,
  options: EnrichmentOptions,
  normalizeKey: (url: string) => string,
): Resource[] {
  return draft.map(resource => {
    const key = normalizeKey(resource.url);
    const suggestion = suggestions.get(key);
    if (!selected.has(key) || !suggestion) return resource;
    const {patch, changes} = buildEnrichmentProposal(resource, suggestion, options);
    return changes.length ? {...resource, ...patch} : resource;
  });
}

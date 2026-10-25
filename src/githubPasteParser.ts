/**
 * Permissive, read-only extraction of GitHub repository/profile links from pasted text.
 * Supports Markdown, CSV, JSON arrays/objects, escaped JSON URLs and adjacent URLs.
 * This module has no React/DOM dependencies and can be regression-tested in Node.
 */
export type ParsedGitHubLink = { url: string; owner: string; repo?: string };
export type GitHubPasteReport = {
  links: ParsedGitHubLink[];
  /** Number of repeated GitHub URLs found in a single paste. */
  duplicates: number;
  /** GitHub site navigation and unrecognized GitHub paths that were ignored. */
  ignored: number;
  format: 'JSON' | 'text';
};

const GITHUB_HOST = /(?:https?:\/\/)?(?:www\.)?github\.com\//gi;
const RESERVED = new Set([
  'about', 'account', 'apps', 'collections', 'contact', 'codespaces', 'dashboard',
  'discussions', 'enterprise', 'events', 'explore', 'features', 'issues', 'join',
  'login', 'logout', 'marketplace', 'new', 'notifications', 'organizations', 'orgs',
  'pricing', 'pulls', 'search', 'security', 'settings', 'signup', 'site',
  'sponsors', 'team', 'topics', 'trending', 'users',
]);
const OWNER_RE = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const REPO_RE = /^[a-z\d_.-]{1,100}$/i;

const keyOf = (url: string) => url.toLowerCase().replace(/\/+$/, '').replace(/\.git$/i, '');

function normalize(raw: string): string {
  // Common formats from copying HTML, JSON, GitHub API output, or documents.
  let result = raw
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\\u002[fF]/g, '/').replace(/\\u003[aA]/g, ':')
    .replace(/\\\//g, '/')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
  // Some tools copy an entire URL percent-encoded into text/JSON.
  result = result.replace(/https?%3A%2F%2Fgithub\.com%2F[^\s"'<>]+/gi, encoded => {
    try { return decodeURIComponent(encoded); } catch { return encoded; }
  });
  return result;
}

function parseParts(owner: string, repo?: string): ParsedGitHubLink | null {
  if (!OWNER_RE.test(owner) || RESERVED.has(owner.toLowerCase())) return null;
  let r = repo?.replace(/\.git$/i, '').replace(/[.]+$/, '');
  if (r && !REPO_RE.test(r)) return null;
  // Do not treat /owner/ paths with special GitHub meaning as a repository.
  return {owner, ...(r ? {repo: r} : {}), url: `https://github.com/${owner}${r ? `/${r}` : ''}`};
}

function parseHostSegment(segment: string): ParsedGitHubLink | null {
  // The host prefix has already been consumed; never absorb /tree/, /blob/,
  // ?tab=, CSV commas, quotes, Markdown punctuation, or another URL.
  const clean = segment.split(/[\s"'`,;:!<>()[\]{}|\\?#]/, 1)[0];
  const [owner, repo] = clean.split('/');
  if (!owner) return null;
  return parseParts(owner, repo || undefined);
}

/** Extract bare "owner/repo" aliases only from well-formed JSON values. */
function structuredJsonAliases(source: unknown): ParsedGitHubLink[] {
  const found: ParsedGitHubLink[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 12 || !value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(v => {
      if (typeof v === 'string' && /^[a-z\d-]+\/[a-z\d_.-]+(?:\.git)?$/i.test(v)) {
        const [owner, repo] = v.split('/');
        const link = parseParts(owner, repo);
        if (link) found.push(link);
      } else visit(v, depth + 1);
    }); return; }
    const object = value as Record<string, unknown>;
    const full = object.full_name || object.fullName || object.repository;
    if (typeof full === 'string' && /^[a-z\d-]+\/[a-z\d_.-]+(?:\.git)?$/i.test(full)) {
      const [owner, repo] = full.split('/');
      const link = parseParts(owner, repo);
      if (link) found.push(link);
    } else {
      const ownerValue = object.owner;
      const owner = typeof ownerValue === 'string' ? ownerValue :
        ownerValue && typeof ownerValue === 'object' && typeof (ownerValue as Record<string, unknown>).login === 'string' ?
          (ownerValue as Record<string, string>).login : undefined;
      const repo = typeof object.repo === 'string' ? object.repo :
        typeof object.repo_name === 'string' ? object.repo_name :
          (typeof object.name === 'string' && ownerValue && typeof ownerValue === 'object') ? object.name : undefined;
      if (owner && repo) { const link = parseParts(owner, repo); if (link) found.push(link); }
    }
    Object.values(object).forEach(v => visit(v, depth + 1));
  };
  visit(source, 0);
  return found;
}

export function analyzeGitHubPaste(raw: string): GitHubPasteReport {
  const result: GitHubPasteReport = { links: [], duplicates: 0, ignored: 0, format: 'text' };
  if (!raw.trim()) return result;
  const unique = new Set<string>();
  const add = (link: ParsedGitHubLink | null) => {
    if (!link) { result.ignored++; return; }
    const key = keyOf(link.url);
    if (unique.has(key)) { result.duplicates++; return; }
    unique.add(key);
    result.links.push(link);
  };

  let json: unknown;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { json = JSON.parse(trimmed); result.format = 'JSON'; } catch { /* pasted fragment, still extract URLs */ }
  }

  const normalized = normalize(raw);
  const hosts = Array.from(normalized.matchAll(GITHUB_HOST));
  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i];
    const start = host.index ?? 0;
    const end = i + 1 < hosts.length ? (hosts[i + 1].index ?? normalized.length) : normalized.length;
    // Avoid matches such as https://notgithub.com/owner/repo.
    // An explicit scheme may be glued immediately to the previous URL.
    if (!/^https?:\/\//i.test(host[0]) && start > 0 && /[\w.-]/.test(normalized[start - 1])) {
      const previous = i > 0 ? hosts[i - 1] : undefined;
      const between = previous ? normalized.slice((previous.index ?? 0) + previous[0].length, start) : '';
      // Allow two GitHub links pasted together without even a protocol on the
      // second one; still reject domains such as https://notgithub.com/.
      if (!/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(between)) continue;
    }
    add(parseHostSegment(normalized.slice(start + host[0].length, end)));
  }

  if (result.format === 'JSON') {
    // JSON can also carry only `full_name` or `owner`/`repo`, without a URL.
    // Ignore aliases already found as URLs rather than inflating duplicate counts.
    for (const link of structuredJsonAliases(json)) {
      const key = keyOf(link.url);
      if (!unique.has(key)) { unique.add(key); result.links.push(link); }
    }
  }
  return result;
}

export function parseGitHubLinks(raw: string): ParsedGitHubLink[] {
  return analyzeGitHubPaste(raw).links;
}

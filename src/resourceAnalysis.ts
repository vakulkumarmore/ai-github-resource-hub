/**
 * Editorial suggestions based only on GitHub-supplied metadata.
 * No LLM, paid API, or invented project claims are involved.
 * All suggestions stay editable before publishing.
 */
export type GitHubDetails = {
  url: string;
  name?: string;
  description?: string | null;
  bio?: string | null;
  topics?: string[];
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  pushed_at?: string | null;
  updated_at?: string | null;
  homepage?: string | null;
  html_url?: string;
  license?: { spdx_id?: string; name?: string } | null;
  archived?: boolean;
  type?: 'profile' | 'repository';
  error?: string;
};

const categories: Array<[RegExp, string]> = [
  [/claude|anthropic|claude-code|claude code|agent.skills/i, 'Claude'],
  [/\bmcp\b|model.context.protocol|mcp-server/i, 'MCP Servers'],
  [/\brag\b|retrieval.augmented|vector.database|embedding/i, 'RAG & Vector Search'],
  [/\bagent(s|ic)?\b|multi.agent|autonomous/i, 'AI Agents'],
  [/\bllm\b|large.language.model|transformers?|ollama|hugging.?face|generative.?ai|text.generation/i, 'LLMs & Models'],
  [/power.automate|workflow|automation|\bn8n\b|zapier|orchestrat/i, 'Automation'],
  [/computer.vision|image.generation|diffusion|\bocr\b|stable.diffusion/i, 'Computer Vision & Images'],
  [/\bvoice\b|speech|audio|\btts\b|\basr\b/i, 'Voice & Audio AI'],
  [/security|pentest|vulnerability|devsecops|owasp/i, 'Security'],
  [/devops|terraform|kubernetes|docker|ci\/cd|observability/i, 'DevOps & Cloud'],
  [/power.bi|analytics|dashboard|visualization|data.science|\bsql\b/i, 'Data & Analytics'],
  [/\breact\b|\bnextjs\b|\bvue\b|web.dev|frontend|website/i, 'Web Development'],
  [/cli|terminal|developer.tool|code.editor|productivity|utilities/i, 'Developer Tools'],
];

export function categorize(details: { name?: string; description?: string; topics?: string[]; url?: string }): string {
  const parts = [details.name || '', ...(details.topics || []), details.description || '', details.url || ''];
  const haystack = parts.join(' ').toLowerCase();
  for (const [pattern, category] of categories) if (pattern.test(haystack)) return category;
  return 'Developer Tools';
}

function tidy(sentence: string): string {
  return sentence.replace(/\[[^\]]+\]\([^)]*\)/g, m => m.replace(/^\[([^\]]+)\].*/, '$1'))
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[`*_\r\n]+/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[.!?;:,\s]+$/, '');
}

export function makeOneLiner(description: string | undefined, repoName: string, topics: string[] = [], language = ''): string {
  const clean = tidy(description || '');
  // GitHub descriptions are authored by maintainers; condense rather than invent claims.
  if (clean && !/^github (repository|profile) (for|by)\b/i.test(clean)) {
    const first = clean.split(/(?<=[.!?])\s+(?=[A-Z])/)[0];
    if (first.length <= 145) return first + (/[.!?]$/.test(first) ? '' : '.');
    const clipped = first.slice(0, 139).replace(/\s+\S*$/, '').replace(/[.,:;\s]+$/, '');
    return `${clipped || first.slice(0, 130)}…`;
  }
  const name = tidy(repoName) || 'This project';
  if (topics.length) return `Explore ${name}, a GitHub project tagged ${topics.slice(0, 2).join(' and ')}.`;
  if (language) return `Explore ${name}, an open-source project written in ${language}.`;
  return `Explore the ${name} project on GitHub.`;
}

export function cleanHashtag(value: string): string {
  const token = value.replace(/^#+/, '').replace(/&/g, 'and').replace(/[^a-z\d_]/gi, '').slice(0, 32);
  return token ? `#${token}` : '';
}

export function suggestHashtags(details: {
  name?: string; category?: string; topics?: string[]; language?: string;
}): string[] {
  const normalized = (details.topics || []).map(cleanHashtag).filter(Boolean);
  const categoryTags: Record<string, string[]> = {
    'Claude': ['ClaudeAI', 'ClaudeCode'], 'MCP Servers': ['MCP', 'AIIntegration'],
    'AI Agents': ['AIAgents'], 'RAG & Vector Search': ['RAG', 'VectorSearch'],
    'LLMs & Models': ['LLM', 'GenerativeAI'], 'Automation': ['Automation'],
    'Security': ['CyberSecurity'], 'DevOps & Cloud': ['DevOps'],
    'Data & Analytics': ['DataAnalytics'], 'Web Development': ['WebDevelopment'],
    'Developer Tools': ['DeveloperTools'],
  };
  const fromCategory = (categoryTags[details.category || ''] || []).map(cleanHashtag);
  const language = details.language ? [cleanHashtag(details.language)] : [];
  const combined = [...fromCategory, ...normalized, ...language, '#OpenSource'];
  return [...new Map(combined.filter(Boolean).map(tag => [tag.toLowerCase(), tag])).values()].slice(0, 6);
}

export function githubDetailsToResource(details: GitHubDetails, existing: {
  url: string; name: string; description: string; tags: string[]; category: string; language?: string;
}) {
  const name = details.name || existing.name;
  const description = details.description || details.bio || existing.description;
  const topics = Array.isArray(details.topics) ? details.topics.filter(t => typeof t === 'string').slice(0, 12) : existing.tags || [];
  const language = details.language || existing.language || '';
  const category = categorize({ name, description, topics, url: existing.url });
  return {
    name,
    description,
    category,
    tags: topics,
    language,
    oneLiner: makeOneLiner(description, name, topics, language),
    hashtags: suggestHashtags({name, category, topics, language}),
    stars: typeof details.stargazers_count === 'number' ? details.stargazers_count : undefined,
    forks: typeof details.forks_count === 'number' ? details.forks_count : undefined,
    updatedAt: details.pushed_at || details.updated_at || undefined,
    homepage: details.homepage?.startsWith('https://') ? details.homepage : undefined,
    license: details.license?.spdx_id && details.license.spdx_id !== 'NOASSERTION' ? details.license.spdx_id : undefined,
  };
}

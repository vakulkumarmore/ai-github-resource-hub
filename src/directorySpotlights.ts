import type { Resource } from './Importer';

/** Curated directory views derived only from the existing published catalog.
 * These labels describe keyword matches, not a verified installation format.
 */
export type DirectoryCollection = 'all' | 'claude' | 'mcp' | 'chatgpt' | 'agents';

export const DIRECTORY_COLLECTIONS: ReadonlyArray<{id:DirectoryCollection;label:string}> = [
  {id:'all',label:'All resources'},
  {id:'claude',label:'Claude skills'},
  {id:'mcp',label:'MCP servers'},
  {id:'chatgpt',label:'ChatGPT & GPT'},
  {id:'agents',label:'AI agents'},
];

export function matchesDirectoryCollection(resource:Resource, collection:DirectoryCollection):boolean {
  if(collection==='all')return true;
  if(resource.type==='profile')return false;
  const keywords=[
    resource.name,resource.category,resource.description,resource.oneLiner,
    resource.language,resource.url,...(resource.tags||[]),
  ].filter(Boolean).join(' ').toLowerCase();
  if(collection==='claude')return /\bclaude\b|\banthropic\b/.test(keywords) && /\bskills?\b|\bplugins?\b/.test(keywords);
  if(collection==='mcp')return /\bmcp\b|model context protocol/.test(keywords);
  if(collection==='chatgpt')return /\bchatgpt\b|\bchat-gpt\b|\bopenai\b|\bgpt(?:s|[-_ ]?\d)?\b/.test(keywords);
  return /\bagents?\b|\bagentic\b|\bmulti[-_ ]agent\b/.test(keywords);
}

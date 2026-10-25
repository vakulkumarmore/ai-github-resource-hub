import type { Resource } from './Importer';

/** Public, catalog-grounded topics. A repository can match more than one need. */
export type Need = {
  id: string;
  title: string;
  description: string;
  icon: string;
  tone: string;
  queryTerms: string[];
  patterns: RegExp[];
};

export const DISCOVERY_NEEDS: Need[] = [
  {id:'video', title:'Video generation', description:'Text-to-video, animation, editing and AI filmmaking.', icon:'film', tone:'violet', queryTerms:['video', 'videos', 'animation', 'animated', 'film', 'filmmaking', 'text to video', 'image to video'], patterns:[/video|animation|animate|filmmak|text.to.video|image.to.video|video.diffusion|videogen|wan2|hunyuan.video|cogvideo|mochi.video|ltx.video|remotion/i]},
  {id:'agents', title:'Agent development', description:'Build autonomous assistants and multi-agent workflows.', icon:'bot', tone:'blue', queryTerms:['agent','agents','agentic','multi agent','autonomous assistant','agent development','browser agent'], patterns:[/\bagents?\b|agentic|multi.agent|crewai|autogen|openai.swarm|langgraph|browser.use|agent.framework/i]},
  {id:'claude-skills', title:'Claude skills', description:'Claude Code skills, hooks, extensions and workflows.', icon:'puzzle', tone:'orange', queryTerms:['claude','claude skills','claude code','anthropic','claude plugin','skills for claude'], patterns:[/claude|anthropic|claude.code|claude.skills|agent.skills|superpowers|skill.creator/i]},
  {id:'chatgpt-skills', title:'ChatGPT skills', description:'ChatGPT, OpenAI, Codex, GPT tools and integrations.', icon:'sparkles', tone:'emerald', queryTerms:['chatgpt','chat gpt','gpt','openai','codex','custom gpt','chatgpt skills'], patterns:[/chatgpt|chat.gpt|openai|codex|gpt.skills|gpt.actions|gpt.store|custom.gpt|gpt4|gpt.4/i]},
  {id:'design', title:'Design & UI/UX', description:'Interface design, wireframes, creative workflows and UI tools.', icon:'palette', tone:'pink', queryTerms:['design','ui','ux','figma','wireframe','graphic design','website design','prototype','creative design'], patterns:[/\bdesign\b|\bui\b|\bux\b|figma|wireframe|prototyp|graphic|design.system|illustrat|tailwind.ui/i]},
  {id:'development', title:'App development', description:'Web apps, coding frameworks, APIs and developer productivity.', icon:'code', tone:'cyan', queryTerms:['development','developer','coding','web','website','app','frontend','backend','react','nextjs','api'], patterns:[/develop|software|\bcoding\b|codegen|code.generator|frontend|backend|fullstack|full.stack|nextjs|next.js|\breact\b|typescript|javascript|\bapi\b|web.framework/i]},
  {id:'mcp', title:'MCP servers', description:'Model Context Protocol servers and integrations.', icon:'plug', tone:'indigo', queryTerms:['mcp','model context protocol','mcp server','connect ai','tools integration'], patterns:[/\bmcp\b|model.context.protocol|mcp.server|mcp.tool/i]},
  {id:'images', title:'Image generation', description:'Create images, illustrations, edits and generative artwork.', icon:'image', tone:'rose', queryTerms:['image','images','photo','picture','image generation','text to image','stable diffusion','comfyui'], patterns:[/image.gen|text.to.image|image.diffusion|comfyui|stable.diffusion|flux\.1|diffusers|image.edit|generative.art|photo.editor/i]},
  {id:'audio', title:'Audio & voice', description:'Speech, voice agents, transcription and AI music.', icon:'mic', tone:'amber', queryTerms:['audio','voice','speech','music','sound','text to speech','transcribe','tts'], patterns:[/audio|voice|speech|transcri|\btts\b|music.generat|music.ai|whisper|sound.generat/i]},
  {id:'automation', title:'Automation', description:'Automate business tasks, scripts and connected workflows.', icon:'workflow', tone:'teal', queryTerms:['automate','automation','workflow','n8n','power automate','zapier','business process'], patterns:[/automat|workflow|\bn8n\b|zapier|power.automate|orchestrat|rpa|task.runner/i]},
  {id:'data', title:'Data & analytics', description:'Data pipelines, dashboards, databases and RAG workflows.', icon:'database', tone:'blue', queryTerms:['data','analytics','sql','dashboard','database','rag','vector','etl','business intelligence'], patterns:[/\bdata\b|analytic|\bsql\b|dashboard|database|\brag\b|vector.database|etl|business.intelligence|knowledge.base/i]},
  {id:'local-ai', title:'Local AI & models', description:'Run models on your own hardware and explore inference stacks.', icon:'cpu', tone:'slate', queryTerms:['local ai','local llm','local model','ollama','llama.cpp','offline llm','inference','on device'], patterns:[/ollama|llama\.cpp|local.llm|offline.llm|local.ai|on.device|inference.engine|vllm|gguf/i]},
  {id:'security', title:'Security & DevOps', description:'Code safety, vulnerability scanners, infrastructure and CI/CD.', icon:'shield', tone:'red', queryTerms:['security','devops','cybersecurity','vulnerability','code scanning','docker','ci cd'], patterns:[/security|devops|cyber|vulnerab|pentest|sast|dependabot|docker|kubernetes|terraform|ci.cd/i]},
  {id:'learning', title:'Learning resources', description:'Tutorials, curated lists, quickstarts, examples and templates.', icon:'book', tone:'purple', queryTerms:['learn','learning','tutorial','courses','examples','awesome','cookbooks','templates'], patterns:[/awesome|tutorial|cookbook|quickstart|course|\blearn\b|\bexamples?\b|template|education|guide/i]},
];

const needle = (r: Resource) => {
  let path = '';
  try { path = new URL(r.url).pathname; } catch { path = r.url; }
  return {
    name: `${r.name || ''} ${path}`,
    tags: `${(r.tags || []).join(' ')} ${(r.hashtags || []).join(' ')}`,
    category: r.category || '',
    description: `${r.description || ''} ${r.oneLiner || ''}`,
  };
};

export function relevanceForNeed(resource: Resource, need: Need): number {
  if (resource.type === 'profile') return 0;
  const fields = needle(resource);
  if (need.id === 'claude-skills') {
    const full = Object.values(fields).join(' ').toLowerCase();
    const isClaude = /claude|anthropic|superpowers|agent.skills/.test(full);
    const isSkill = /skills?|hooks?|plugins?|commands?|superpowers/.test(full);
    if (!isClaude || !isSkill) return 0;
  }
  let score = 0;
  for (const pattern of need.patterns) {
    if (pattern.test(fields.name)) score += 10;
    if (pattern.test(fields.tags)) score += 7;
    if (pattern.test(fields.category)) score += 5;
    if (pattern.test(fields.description)) score += 3;
  }
  return score;
}

/** Metadata provides a tie-breaker, never a fake user review or safety endorsement. */
export function rankForNeed(resources: Resource[], need: Need): Array<{resource: Resource; relevance: number}> {
  return resources.map(resource => ({resource, relevance: relevanceForNeed(resource, need)}))
    .filter(x => x.relevance > 0)
    .sort((a, b) => {
      if (a.relevance !== b.relevance) return b.relevance - a.relevance;
      const starsA = Math.log10((a.resource.stars ?? 0) + 1);
      const starsB = Math.log10((b.resource.stars ?? 0) + 1);
      if (starsA !== starsB) return starsB - starsA;
      const updateA = Date.parse(a.resource.updatedAt || '') || 0;
      const updateB = Date.parse(b.resource.updatedAt || '') || 0;
      if (updateA !== updateB) return updateB - updateA;
      return a.resource.name.localeCompare(b.resource.name);
    });
}

const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#. -]/g, ' ').replace(/\s+/g, ' ').trim();
const COMMON_WORDS = new Set(['i','a','an','the','to','for','is','are','with','need','want','find','show','me','please','help','best','top','tools','tool','repo','repos','repository','repositories','github','that','can','make','create','build','some','and','my','from','in','on','using','use','of','about','what','how','do','get','like']);
export function bestMatchingNeed(query: string): Need | null {
  const q = normalized(query);
  if (!q) return null;
  const matches = DISCOVERY_NEEDS.map(need => {
    let score = 0;
    for (const phrase of need.queryTerms) {
      const term = normalized(phrase);
      const re = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}($|[^a-z0-9])`, 'i');
      if (re.test(q)) {
        const generic = new Set(['app','web','tools','tool','code','coding','data','design','learn','image','video','agents','agent']);
        score = Math.max(score, term.includes(' ') ? 6 + term.length / 20 : ['mcp','gpt','tts','ui','ux','rag'].includes(term) ? 5 : generic.has(term) ? 2 : 3);
      }
    }
    return {need, score};
  }).sort((a, b) => b.score - a.score);
  return matches[0].score > 0 ? matches[0].need : null;
}

export function recommendationForQuestion(resources: Resource[], question: string, limit = 5): { need: Need | null; results: Resource[]; total: number } {
  const need = bestMatchingNeed(question);
  const words = normalized(question).split(' ').filter(w => w.length >= 3 && !COMMON_WORDS.has(w));
  if (need) {
    const ordered = rankForNeed(resources, need);
    // Preserve the topical category for natural-language requests, with textual keywords as ties.
    const enriched = ordered.map(entry => {
      const text = Object.values(needle(entry.resource)).join(' ').toLowerCase();
      return {...entry, queryScore: words.filter(word => text.includes(word)).length};
    }).sort((a,b) => b.relevance - a.relevance || b.queryScore - a.queryScore);
    return {need, results: enriched.slice(0, limit).map(x => x.resource), total: enriched.length};
  }
  if (!words.length) return {need:null, results:[], total:0};
  const matches = resources.map(resource => {
    const text = needle(resource);
    const score = words.reduce((count,word)=> count + (text.name.toLowerCase().includes(word) ? 6 : 0) + (text.tags.toLowerCase().includes(word) ? 4 : 0) + (text.category.toLowerCase().includes(word) ? 3 : 0) + (text.description.toLowerCase().includes(word) ? 1 : 0), 0);
    return {resource, score};
  }).filter(x => x.score > 0).sort((a,b)=>b.score-a.score || (b.resource.stars ?? 0)-(a.resource.stars ?? 0));
  return {need:null, results:matches.slice(0,limit).map(x=>x.resource), total:matches.length};
}

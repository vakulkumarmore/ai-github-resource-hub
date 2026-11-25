import test from 'node:test';
import assert from 'node:assert/strict';
import {DIRECTORY_COLLECTIONS,matchesDirectoryCollection} from '../src/directorySpotlights.ts';

const repo=(name,fields={})=>({
  id:name,name,type:'repository',category:'Development',description:'Open-source example',
  url:'https://github.com/example/'+name,tags:[],...fields,
});

test('directory tabs have stable distinct identifiers',()=>{
  assert.deepEqual(DIRECTORY_COLLECTIONS.map(({id})=>id),['all','claude','mcp','chatgpt','agents']);
});

test('filter collections by truthful catalog metadata, not made-up flags',()=>{
  const skills=repo('awesome-claude-skills',{category:'Claude Skills'});
  const mcp=repo('playwright-mcp',{description:'Model Context Protocol server'});
  const chat=repo('openai-cookbook',{description:'ChatGPT examples'});
  const agents=repo('multi-agent-tools',{tags:['agentic','automation']});
  assert.ok(matchesDirectoryCollection(skills,'claude'));
  assert.ok(matchesDirectoryCollection(mcp,'mcp'));
  assert.ok(matchesDirectoryCollection(chat,'chatgpt'));
  assert.ok(matchesDirectoryCollection(agents,'agents'));
  assert.ok(!matchesDirectoryCollection(repo('ordinary'), 'claude'));
});

test('profiles stay searchable in All but do not inflate specialty tabs',()=>{
  const profile=repo('claude-skills-person',{type:'profile'});
  assert.ok(matchesDirectoryCollection(profile,'all'));
  assert.ok(!matchesDirectoryCollection(profile,'claude'));
});

test('category labels cannot accidentally mark ordinary projects as MCP servers',()=>{
  const ordinary=repo('memory-library',{description:'A catalog for developer documentation'});
  assert.ok(!matchesDirectoryCollection(ordinary,'mcp'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const origin = 'https://preview.example.test';
const previewEnv = {
  PREVIEW_MODE:'true',
  OWNER_LOGIN:'vakulkumarmore',
  REPO_NAME:'ai-github-resource-hub',
  CLIENT_ID:'preview-disabled',
  ASSETS:{fetch:async()=>new Response('<html><body>Preview</body></html>',{status:200,headers:{'content-type':'text/html'}})},
};

test('preview serves static design assets with no OAuth secrets',async()=>{
  const res=await worker.fetch(new Request(origin+'/'),previewEnv);
  assert.equal(res.status,200);
  assert.match(await res.text(),/Preview/);
});

test('preview can read public catalog without owner credentials',async()=>{
  const previous=globalThis.fetch;
  let target='';
  globalThis.fetch=async(url,init={})=>{
    target=String(url);
    assert.equal(init.headers.Authorization,undefined);
    return new Response(JSON.stringify([{name:'Example',url:'https://github.com/example/repo'}]),{status:200});
  };
  try{
    const res=await worker.fetch(new Request(origin+'/api/catalog'),previewEnv);
    assert.equal(res.status,200);
    assert.match(res.headers.get('content-type'),/application\/json/);
    assert.deepEqual((await res.json())[0].name,'Example');
    assert.equal(target,'https://api.github.com/repos/vakulkumarmore/ai-github-resource-hub/contents/src/resources.json');
  }finally{globalThis.fetch=previous;}
});

test('preview cannot authenticate, analyze, or publish even if production secrets are accidentally supplied',async()=>{
  const env={...previewEnv,CLIENT_ID:'real-client',CLIENT_SECRET:'prod-oauth-secret',SESSION_SECRET:'prod-session-secret'};
  for(const path of ['/api/login','/api/callback','/api/analyze','/api/tts-model','/api/catalog']){
    const method=path==='/api/catalog'?'PUT':path==='/api/analyze'?'POST':'GET';
    const res=await worker.fetch(new Request(origin+path,{method}),env);
    assert.equal(res.status,403,`${method} ${path} must be denied on preview`);
    assert.match((await res.json()).error,/preview is read-only/i);
  }
  const me=await worker.fetch(new Request(origin+'/api/me'),env);
  assert.deepEqual(await me.json(),{owner:false,login:null});
});

test('diagnostics identifies a read-only preview',async()=>{
  const res=await worker.fetch(new Request(origin+'/api/diagnostics'),previewEnv);
  assert.equal(res.status,200);
  const info=await res.json();
  assert.equal(info.environment,'preview');
  assert.equal(info.readOnly,true);
});


test('latest discovery suggestions are read-only and live in preview and production',async()=>{
  const originalFetch=globalThis.fetch;
  const expected='https://api.github.com/repos/vakulkumarmore/ai-github-resource-hub/contents/src/daily-discoveries.json';
  const queries=[];
  globalThis.fetch=async(input,init={})=>{
    const url=String(input);
    queries.push(url);
    assert.equal(url,expected);
    assert.equal(init.headers?.Authorization,undefined,'Discovery needs no OAuth credentials');
    return new Response(JSON.stringify({generatedAt:'2026-11-25T00:00:00Z',queriesSucceeded:10,candidates:[{
      url:'https://github.com/test/ai-skill',name:'ai-skill'
    }]}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const production={...previewEnv,PREVIEW_MODE:undefined,CLIENT_ID:'production-client',
      CLIENT_SECRET:'test-secret',SESSION_SECRET:'test-session'};
    for(const env of [previewEnv,production]){
      const response=await worker.fetch(new Request(origin+'/api/discoveries'),env);
      assert.equal(response.status,200,'Report should load from GitHub on either site');
      assert.match(response.headers.get('content-type'),/application\/json/);
      assert.equal((await response.json()).candidates.length,1);
    }
    assert.deepEqual(queries,[expected,expected]);
    const denied=await worker.fetch(new Request(origin+'/api/discoveries',{method:'POST'}),previewEnv);
    assert.equal(denied.status,403,'Preview cannot post to discovery endpoint');
  }finally{globalThis.fetch=originalFetch;}
});

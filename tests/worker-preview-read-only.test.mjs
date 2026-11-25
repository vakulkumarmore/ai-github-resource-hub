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

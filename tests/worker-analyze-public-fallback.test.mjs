import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const origin = 'https://hub.example';
const env = {
  CLIENT_ID: 'test-client', CLIENT_SECRET: 'test-secret',
  SESSION_SECRET: 'test-session-secret', OWNER_LOGIN: 'vakulkumarmore',
  REPO_NAME: 'ai-github-resource-hub',
  ASSETS: { fetch: async () => new Response('ok') },
};
const sendJson = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: {'content-type': 'application/json', 'x-ratelimit-remaining': '50'},
});

test('404 from owner OAuth on public repo is distinguishable from missing repo', async () => {
  const previousFetch = globalThis.fetch;
  const visited = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    visited.push({path:url.pathname, auth:!!(init.headers?.Authorization || init.headers?.authorization)});
    if (url.hostname === 'github.com' && url.pathname === '/login/oauth/access_token')
      return sendJson({access_token:'secret-for-test-only'});
    if (url.hostname !== 'api.github.com') throw new Error('Unexpected upstream: ' + url);
    if (url.pathname === '/user') return sendJson({login:'vakulkumarmore'});
    const publicRepo = ['/repos/microsoft/PowerToys','/repos/langchain-ai/langchain'].includes(url.pathname);
    const isAuthorized = !!(init.headers?.Authorization || init.headers?.authorization);
    if (publicRepo && !isAuthorized) return sendJson({
      name:url.pathname.split('/').at(-1), description:'A GitHub test repository',
      stargazers_count:420, forks_count:12, language:'TypeScript',
      pushed_at:'2026-11-24T00:00:00Z', topics:['open-source'],
      license:{spdx_id:'MIT'}, archived:false, disabled:false,
    });
    return sendJson({message:'Not Found'},404);
  };

  try {
    const login = await worker.fetch(new Request(origin + '/api/login'), env);
    assert.equal(login.status, 302);
    const oauthCookie = login.headers.get('set-cookie').split(';')[0];
    const state = oauthCookie.split('=')[1];

    const callback = await worker.fetch(new Request(origin + '/api/callback?state=' + state + '&code=test', {
      headers:{cookie:oauthCookie}
    }),env);
    assert.equal(callback.status,302);
    const session = callback.headers.get('set-cookie').match(/hub_session=([^;]+)/)?.[1];
    assert.ok(session, 'OAuth callback returned a session cookie');

    const noAuthProbe = await worker.fetch(new Request(origin + '/api/github-access'), env);
    assert.equal(noAuthProbe.status,401);

    const headers = {cookie:'hub_session=' + session};
    const access = await worker.fetch(new Request(origin + '/api/github-access', {headers}), env);
    assert.equal(access.status,200);
    const probe = await access.json();
    assert.equal(probe.oauthPublicMismatch,true);
    assert.equal(probe.authenticated.status,404);
    assert.equal(probe.publicLookup.status,200);
    assert.ok(!JSON.stringify(probe).includes('secret-for-test-only'));

    const results = await worker.fetch(new Request(origin + '/api/analyze', {
      method:'POST', headers:{...headers, 'content-type':'application/json'},
      body:JSON.stringify({urls:['https://github.com/microsoft/PowerToys','https://github.com/langchain-ai/langchain']})
    }),env);
    assert.equal(results.status,200);
    const found = await results.json();
    assert.equal(found.results.length,2);
    assert.equal(found.publicFallbackUsed,true);
    assert.equal(found.results[0].stargazers_count,420);
    assert.ok(found.results.every(x=>x.publicFallbackUsed===true&&!x.error));
    assert.ok(visited.some(v=>v.path==='/repos/microsoft/PowerToys'&&v.auth));
    assert.ok(visited.some(v=>v.path==='/repos/microsoft/PowerToys'&&!v.auth));

    const missing = await worker.fetch(new Request(origin + '/api/analyze',{
      method:'POST',headers:{...headers,'content-type':'application/json'},
      body:JSON.stringify({urls:['https://github.com/missing/missing-repo']})
    }),env);
    assert.equal(missing.status,424);
    const failed = await missing.json();
    assert.match(failed.error,/also checked public access/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

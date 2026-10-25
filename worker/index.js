// Same-origin Cloudflare Worker: GitHub OAuth + owner-authorized catalog writes.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const cookies=req=>Object.fromEntries((req.headers.get('cookie')||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(p=>p.length===2));
const enc=new TextEncoder();
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function key(secret){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode(secret)),'AES-GCM',false,['encrypt','decrypt']);}
async function seal(obj,secret){const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(secret),enc.encode(JSON.stringify(obj)));return b64(iv)+'.'+b64(cipher);}
async function unseal(token,secret){try{const [a,b]=token.split('.');const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(a)},await key(secret),unb64(b));return JSON.parse(new TextDecoder().decode(clear));}catch{return null;}}
const gh=(token)=>({'Accept':'application/vnd.github+json','Authorization':`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'ai-github-resource-hub'});
const redirect=(url,headers={})=>new Response(null,{status:302,headers:{location:url,...headers}});
const redirectWithCookies=(url,values)=>{const headers=new Headers({location:url});for(const value of values)headers.append('Set-Cookie',value);return new Response(null,{status:302,headers});};
export default {async fetch(req,env){const url=new URL(req.url),path=url.pathname,cs=cookies(req);if(!path.startsWith('/api/'))return env.ASSETS.fetch(req);
 if(!env.CLIENT_ID||!env.CLIENT_SECRET||!env.SESSION_SECRET||!env.OWNER_LOGIN||!env.REPO_NAME)return json({error:'Server configuration incomplete'},503);
 if(path==='/api/login'){const state=crypto.randomUUID();const target=new URL('https://github.com/login/oauth/authorize');target.searchParams.set('client_id',env.CLIENT_ID);target.searchParams.set('redirect_uri',url.origin+'/api/callback');target.searchParams.set('state',state);target.searchParams.set('scope','public_repo');return redirect(target.toString(),{'set-cookie':cookie('oauth_state',state,600)});}
 if(path==='/api/callback'){if(!url.searchParams.get('state')||url.searchParams.get('state')!==cs.oauth_state)return json({error:'Invalid OAuth state'},403);const code=url.searchParams.get('code');if(!code)return json({error:'Missing OAuth code'},400);const exchange=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','content-type':'application/json'},body:JSON.stringify({client_id:env.CLIENT_ID,client_secret:env.CLIENT_SECRET,code,redirect_uri:url.origin+'/api/callback'})});const auth=await exchange.json();if(!auth.access_token)return json({error:'GitHub authorization failed'},401);const userRes=await fetch('https://api.github.com/user',{headers:gh(auth.access_token)});if(!userRes.ok)return json({error:'Cannot verify GitHub account'},401);const user=await userRes.json();if(user.login.toLowerCase()!==env.OWNER_LOGIN.toLowerCase())return json({error:'Only the configured owner can administer this catalog'},403);const session=await seal({token:auth.access_token,login:user.login,exp:Date.now()+7*86400000},env.SESSION_SECRET);return redirectWithCookies('/#admin',[cookie('hub_session',session,7*86400),cookie('oauth_state','',0)]);}
 if(path==='/api/logout')return redirect('/',{'set-cookie':cookie('hub_session','',0)});
 const session=await unseal(cs.hub_session||'',env.SESSION_SECRET);const owner=!!session&&session.exp>Date.now()&&session.login.toLowerCase()===env.OWNER_LOGIN.toLowerCase();
 if(path==='/api/me')return json({owner,login:owner?session.login:null});
 // Authenticated metadata analysis for bulk GitHub imports. No access token is sent to the browser.
 if(path==='/api/analyze'&&req.method==='POST'){
   if(!owner)return json({error:'Sign in as the configured owner before analyzing repositories.'},401);
   const origin=req.headers.get('origin');
   if(origin&&origin!==url.origin)return json({error:'Invalid request origin'},403);
   if(Number(req.headers.get('content-length')||0)>12000)return json({error:'Too many links for one batch (maximum 10).'},413);
   let body;try{body=await req.json();}catch{return json({error:'Invalid JSON'},400);}
   const links=body?.urls;
   if(!Array.isArray(links)||links.length<1||links.length>10||links.some(u=>typeof u!=='string'||u.length>300))return json({error:'Provide 1–10 GitHub URLs per batch.'},400);
   const parsed=[];
   for(const link of links){
     try{
       const target=new URL(link);
       if(target.protocol!=='https:'||target.hostname!=='github.com'||target.search||target.hash)throw new Error();
       const pathParts=target.pathname.split('/').filter(Boolean);
       if(pathParts.length<1||pathParts.length>2||pathParts.some(x=>!(/^[a-z0-9][a-z0-9_.-]*$/i.test(x))))throw new Error();
       parsed.push({url:`https://github.com/${pathParts.join('/')}`,parts:pathParts});
     }catch{return json({error:'Every URL must be a GitHub repository or profile URL.'},400);}
   }
   const results=await Promise.all(parsed.map(async ({url:githubUrl,parts})=>{
     const endpoint=parts.length>1 ? `/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}` : `/users/${encodeURIComponent(parts[0])}`;
     try{
       const response=await fetch(`https://api.github.com${endpoint}`,{headers:gh(session.token)});
       if(!response.ok){
         const note=response.status===403?'GitHub rate limit or access restriction':response.status===404?'Repository or profile not found':`GitHub HTTP ${response.status}`;
         return {url:githubUrl,error:note};
       }
       const data=await response.json();
       return {
         url:githubUrl,
         name:data.name||parts.at(-1),
         description:data.description||null,
         bio:data.bio||null,
         topics:Array.isArray(data.topics)?data.topics.slice(0,12):[],
         language:data.language||null,
         stargazers_count:typeof data.stargazers_count==='number'?data.stargazers_count:null,
         forks_count:typeof data.forks_count==='number'?data.forks_count:null,
         pushed_at:data.pushed_at||null,
         updated_at:data.updated_at||null,
         homepage:typeof data.homepage==='string'?data.homepage.slice(0,300):null,
         license:data.license?{spdx_id:data.license.spdx_id||null}:null,
         type:parts.length===1?'profile':'repository'
       };
     }catch{return {url:githubUrl,error:'Unable to reach GitHub API'};}
   }));
   return json({results});
 }
 if(path==='/api/catalog'&&req.method==='GET'){const r=await fetch(`https://api.github.com/repos/${encodeURIComponent(env.OWNER_LOGIN)}/${encodeURIComponent(env.REPO_NAME)}/contents/src/resources.json`,{headers:{Accept:'application/vnd.github.raw+json','User-Agent':'ai-github-resource-hub'},cf:{cacheTtl:60}});if(!r.ok)return json({error:'Unable to load published catalog'},r.status);return new Response(await r.text(),{headers:{'content-type':'application/json','cache-control':'public,max-age=60'}});}
 if(path==='/api/catalog'&&req.method==='PUT'){if(!owner)return json({error:'Owner sign-in required'},401);if(Number(req.headers.get('content-length')||0)>500000)return json({error:'Catalog too large'},413);let resources;try{resources=await req.json();}catch{return json({error:'Invalid JSON'},400);}if(!Array.isArray(resources)||resources.length>3000||resources.some(r=>!r||typeof r.id!=='string'||typeof r.name!=='string'||typeof r.description!=='string'||typeof r.category!=='string'||typeof r.url!=='string'||!Array.isArray(r.tags)||!r.url.startsWith('https://github.com/')||r.url.length>500))return json({error:'Invalid resource catalog'},400);const target=`https://api.github.com/repos/${encodeURIComponent(env.OWNER_LOGIN)}/${encodeURIComponent(env.REPO_NAME)}/contents/src/resources.json`;const headers=gh(session.token);const existing=await fetch(target,{headers});if(!existing.ok){
   const responseInfo = await existing.json().catch(()=>({}));
   const githubMessage = typeof responseInfo.message === 'string' ? responseInfo.message.slice(0,180) : 'GitHub could not read the file';
   const instructions = existing.status === 401
     ? 'Your GitHub authorization is invalid or expired. Download a backup, sign out, and sign back in.'
     : existing.status === 403
       ? 'GitHub denied the request. Check the public_repo OAuth permission, GitHub rate limit, and access to this repository.'
       : existing.status === 404
         ? 'Verify the configured repository owner/name, that src/resources.json exists on the default branch, and token access.'
         : existing.status === 429
           ? 'GitHub is rate limiting requests. Wait and try again.'
           : 'Check the repository path and GitHub API availability.';
   return json({
     error: `GitHub read failed (HTTP ${existing.status}): ${githubMessage}. ${instructions}`,
     githubStatus: existing.status,
     githubMessage,
     rateLimitRemaining: existing.headers.get('x-ratelimit-remaining'),
     grantedScopes: existing.headers.get('x-oauth-scopes'),
   }, existing.status);
 }const current=await existing.json();const payload=JSON.stringify(resources,null,2)+'\n';const put=await fetch(target,{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({message:'Update resource catalog from admin dashboard',content:btoa(String.fromCharCode(...enc.encode(payload))),sha:current.sha})});if(!put.ok){const detail=await put.json().catch(()=>({}));return json({error:detail.message||'GitHub update failed'},put.status);}return json({ok:true,message:'Committed to GitHub. Deployment will follow.'});}
 return json({error:'Not found'},404);
}};

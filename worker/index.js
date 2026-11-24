// Same-origin Cloudflare Worker: GitHub OAuth + owner-authorized catalog writes.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const cookies=req=>Object.fromEntries((req.headers.get('cookie')||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(p=>p.length===2));
const enc=new TextEncoder();
// Bound catalog publishing by actual UTF-8 payload size, not just Content-Length.
// 8 MiB accommodates thousands of repository metadata entries without removing safety checks.
const MAX_CATALOG_BYTES=8*1024*1024;
const oversizedCatalog=bytes=>json({error:`Catalog exceeds the 8 MiB publishing limit (${(bytes/1048576).toFixed(2)} MiB). Export a backup and remove embedded image data or split the catalog.`,limitBytes:MAX_CATALOG_BYTES,actualBytes:bytes},413);
const githubBase64=text=>{const bytes=enc.encode(text);let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary);};
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function key(secret){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode(secret)),'AES-GCM',false,['encrypt','decrypt']);}
async function seal(obj,secret){const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(secret),enc.encode(JSON.stringify(obj)));return b64(iv)+'.'+b64(cipher);}
async function unseal(token,secret){try{const [a,b]=token.split('.');const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(a)},await key(secret),unb64(b));return JSON.parse(new TextDecoder().decode(clear));}catch{return null;}}
const gh=(token)=>({'Accept':'application/vnd.github+json','Authorization':`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'ai-github-resource-hub'});
const publicGh=()=>({'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'ai-github-resource-hub'});
const metadataEndpoint=parts=>parts.length>1 ? `/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}` : `/users/${encodeURIComponent(parts[0])}`;
const redirect=(url,headers={})=>new Response(null,{status:302,headers:{location:url,...headers}});
const redirectWithCookies=(url,values)=>{const headers=new Headers({location:url});for(const value of values)headers.append('Set-Cookie',value);return new Response(null,{status:302,headers});};
export default {async fetch(req,env){try{const url=new URL(req.url),path=url.pathname,cs=cookies(req);if(!path.startsWith('/api/'))return env.ASSETS.fetch(req);
 if(!env.CLIENT_ID||!env.CLIENT_SECRET||!env.SESSION_SECRET||!env.OWNER_LOGIN||!env.REPO_NAME)return json({error:'Server configuration incomplete'},503);
 // Public, non-sensitive build marker to detect a stale or wrong Cloudflare deployment.
 if(path==='/api/diagnostics'&&req.method==='GET')return json({service:'ai-github-resource-hub',version:'v29-analyzer-diagnostics',workerOrigin:url.origin,apiRoutesActive:true});
 if(path==='/api/login'){const state=crypto.randomUUID();const target=new URL('https://github.com/login/oauth/authorize');target.searchParams.set('client_id',env.CLIENT_ID);target.searchParams.set('redirect_uri',url.origin+'/api/callback');target.searchParams.set('state',state);target.searchParams.set('scope','public_repo');return redirect(target.toString(),{'set-cookie':cookie('oauth_state',state,600)});}
 if(path==='/api/callback'){if(!url.searchParams.get('state')||url.searchParams.get('state')!==cs.oauth_state)return json({error:'Invalid OAuth state'},403);const code=url.searchParams.get('code');if(!code)return json({error:'Missing OAuth code'},400);const exchange=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','content-type':'application/json'},body:JSON.stringify({client_id:env.CLIENT_ID,client_secret:env.CLIENT_SECRET,code,redirect_uri:url.origin+'/api/callback'})});const auth=await exchange.json();if(!auth.access_token)return json({error:'GitHub authorization failed'},401);const userRes=await fetch('https://api.github.com/user',{headers:gh(auth.access_token)});if(!userRes.ok)return json({error:'Cannot verify GitHub account'},401);const user=await userRes.json();if(user.login.toLowerCase()!==env.OWNER_LOGIN.toLowerCase())return json({error:'Only the configured owner can administer this catalog'},403);const session=await seal({token:auth.access_token,login:user.login,exp:Date.now()+7*86400000},env.SESSION_SECRET);return redirectWithCookies('/#admin',[cookie('hub_session',session,7*86400),cookie('oauth_state','',0)]);}
 if(path==='/api/logout')return redirect('/',{'set-cookie':cookie('hub_session','',0)});
 const session=await unseal(cs.hub_session||'',env.SESSION_SECRET);const owner=!!session&&session.exp>Date.now()&&session.login.toLowerCase()===env.OWNER_LOGIN.toLowerCase();
 if(path==='/api/me')return json({owner,login:owner?session.login:null});
 // Owner-only access probe: compares one fixed, known-public repository.
 // No secrets, OAuth headers, or token contents are sent back to the browser.
 if(path==='/api/github-access'&&req.method==='GET'){
   if(!owner)return json({error:'Owner sign-in required'},401);
   const endpoint='https://api.github.com/repos/microsoft/PowerToys';
   const check=async headers=>{
     try{
       const res=await fetch(endpoint,{headers});
       return {status:res.status,rateLimitRemaining:res.headers.get('x-ratelimit-remaining')};
     }catch{return {status:null,rateLimitRemaining:null,error:'GitHub connection failed'};}
   };
   const [authenticated,publicLookup]=await Promise.all([check(gh(session.token)),check(publicGh())]);
   const oauthPublicMismatch=authenticated.status===404&&publicLookup.status===200;
   return json({
     probe:'microsoft/PowerToys',authenticated,publicLookup,oauthPublicMismatch,
     meaning:oauthPublicMismatch
       ? 'GitHub returned 404 for an OAuth-authenticated request to a known public repository, but returned 200 without the token. This indicates a problem with the token visibility or permissions, not the repository.'
       : authenticated.status===200
         ? 'Your OAuth token can read this known public repository. Check the specific links that failed.'
         : 'The two statuses help distinguish GitHub API access, authorization and rate-limit failures.',
     note:'No credentials or private data are included in this result.'
   });
 }
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
     const endpoint=metadataEndpoint(parts);
     try{
       const upstream=`https://api.github.com${endpoint}`;
       const authenticatedResponse=await fetch(upstream,{headers:gh(session.token)});
       let response=authenticatedResponse;
       let publicFallbackUsed=false;
       // A GitHub OAuth token can have narrower visibility than anonymous
       // public access. A 404 from the token is not proof the repo is missing.
       if(authenticatedResponse.status===404){
         response=await fetch(upstream,{headers:publicGh()});
         publicFallbackUsed=response.ok;
       }
       if(!response.ok){
         const note=response.status===403?'GitHub rate limit or access restriction':
           response.status===404?'Repository or profile not found (also checked public access)':
           response.status===429?'GitHub API rate limit':
           `GitHub HTTP ${response.status}`;
         return {url:githubUrl,error:note};
       }
       const data=await response.json();
       return {
         publicFallbackUsed,
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
         archived:!!data.archived,
         disabled:!!data.disabled,
         type:parts.length===1?'profile':'repository'
       };
     }catch{return {url:githubUrl,error:'Unable to reach GitHub API'};}
   }));
   // Shared authentication/permission failures are NOT failed repositories.
   // Do not reply with a successful 200 and ten per-repository errors:
   // Analyze All would otherwise continue through the entire catalog.
   if(results.length && results.every(item => item.error === 'GitHub HTTP 401')){
     return json({error:'GitHub rejected the saved OAuth token (HTTP 401). Reconnect the GitHub owner account from Admin before retrying the analysis.',reconnect:true},401);
   }
   if(results.length && results.every(item => item.error === 'GitHub rate limit or access restriction')){
     return json({error:'GitHub denied all metadata lookups in this batch (HTTP 403). Check API limits and access permissions, or reconnect the owner account before retrying.',reconnect:true},403);
   }
   if(results.length && results.every(item => item.error === 'Unable to reach GitHub API')){
     return json({error:'GitHub metadata API could not be reached for this batch. No repository was marked invalid. Check connectivity and retry later.'},503);
   }
   // A batch with zero successes is an actionable failure, not a reason to
   // proceed through 1,200+ entries. Include the first cause, never credentials.
   if(results.length && results.every(item => typeof item.error === 'string' && item.error)){
     const reasons=[...new Set(results.map(item => item.error))].slice(0,3);
     return json({
       error:`All ${results.length} GitHub metadata lookups in this batch failed. Reasons: ${reasons.join('; ')}. Stop analysis and check your GitHub sign-in, Worker deployment and API permissions. No catalog data was changed.`,
       batchFailed:true, reasons
     },424);
   }
   return json({results,publicFallbackUsed:results.some(item=>item.publicFallbackUsed===true)});
 }
 if(path==='/api/catalog'&&req.method==='GET'){const r=await fetch(`https://api.github.com/repos/${encodeURIComponent(env.OWNER_LOGIN)}/${encodeURIComponent(env.REPO_NAME)}/contents/src/resources.json`,{headers:{Accept:'application/vnd.github.raw+json','User-Agent':'ai-github-resource-hub'},cf:{cacheTtl:60}});if(!r.ok)return json({error:'Unable to load published catalog'},r.status);return new Response(await r.text(),{headers:{'content-type':'application/json','cache-control':'public,max-age=60'}});}
 if(path==='/api/catalog'&&req.method==='PUT'){
   if(!owner)return json({error:'Owner sign-in required'},401);
   const advertisedBytes=Number(req.headers.get('content-length')||0);
   if(Number.isFinite(advertisedBytes)&&advertisedBytes>MAX_CATALOG_BYTES)return oversizedCatalog(advertisedBytes);
   // Content-Length is sometimes omitted or inaccurate. Check the actual UTF-8 bytes too.
   let rawCatalog;
   try{rawCatalog=await req.text();}catch{return json({error:'Unable to read catalog request'},400);}
   const actualBytes=enc.encode(rawCatalog).byteLength;
   if(actualBytes>MAX_CATALOG_BYTES)return oversizedCatalog(actualBytes);
   let resources;
   try{resources=JSON.parse(rawCatalog);}catch{return json({error:'Invalid JSON'},400);}if(!Array.isArray(resources)||resources.length>3000||resources.some(r=>!r||typeof r.id!=='string'||typeof r.name!=='string'||typeof r.description!=='string'||typeof r.category!=='string'||typeof r.url!=='string'||!Array.isArray(r.tags)||!r.url.startsWith('https://github.com/')||r.url.length>500))return json({error:'Invalid resource catalog'},400);const target=`https://api.github.com/repos/${encodeURIComponent(env.OWNER_LOGIN)}/${encodeURIComponent(env.REPO_NAME)}/contents/src/resources.json`;const headers=gh(session.token);const existing=await fetch(target,{headers});if(!existing.ok){
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
 }const current=await existing.json();const payload=JSON.stringify(resources,null,2)+'\n';const put=await fetch(target,{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({message:'Update resource catalog from admin dashboard',content:githubBase64(payload),sha:current.sha})});if(!put.ok){const detail=await put.json().catch(()=>({}));return json({error:detail.message||'GitHub update failed'},put.status);}return json({ok:true,message:'Committed to GitHub. Deployment will follow.'});}
 return json({error:'Not found'},404);
}catch(error){console.error('Worker request failed',error);return json({error:'The server could not complete this request. Check Cloudflare Worker logs for details.'},500);}
}};

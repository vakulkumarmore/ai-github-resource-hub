import type { Resource } from './Importer';

export const VIDEO_SECONDS = 15;
export const VIDEO_WIDTH = 540;
export const VIDEO_HEIGHT = 960;
export const VIDEO_FPS = 24;
export type VideoMode = 'individual' | 'roundup';
export type VideoScene = { id:string; start:number; end:number; eyebrow:string; heading:string; subtitle:string; detail:string; extra?:string; url?:string };
export type VideoProject = { id:string; mode:VideoMode; title:string; selectedUrls:string[]; scenes:VideoScene[] };
const clip=(s:string,max=160)=>s.replace(/\s+/g,' ').trim().slice(0,max);
const shortName=(r:Resource)=>clip(r.name||r.url.split('/').pop()||'GitHub repository',70);
const summary=(r:Resource)=>clip(r.description||r.oneLiner||'Explore this repository on GitHub.',310);
const spoken=(text:string,maxWords:number)=>clip(text,280).split(/\s+/).slice(0,maxWords).join(' ').replace(/[,:;\s]+$/,'').replace(/[.!?]+$/,'')+'.';
const safeFact=(r:Resource)=>[r.category,r.language].filter(Boolean).join(' • ');
const slug=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,65);
const path=(r:Resource)=>r.url.replace(/^https:\/\/github\.com\//,'').replace(/\/$/,'');
export const videoSignature=(p:VideoProject)=>JSON.stringify(p);

export function makeIndividualVideo(r:Resource):VideoProject {
  const name=shortName(r),repo=path(r),full=r.url;
  const facts=[r.category,r.language,typeof r.stars==='number'?r.stars.toLocaleString()+' stars':''].filter(Boolean).join(' • ');
  return {id:'repo-'+slug(repo),mode:'individual',title:name,selectedUrls:[full],scenes:[
    {id:'intro',start:0,end:3,eyebrow:'REPOSITORY SPOTLIGHT',heading:name,subtitle:spoken('Introducing '+name,6),detail:safeFact(r)||'OPEN SOURCE DISCOVERY',extra:summary(r),url:full},
    {id:'overview',start:3,end:8,eyebrow:'WHAT IT DOES',heading:'What it does',subtitle:spoken(r.oneLiner||r.description||'Explore this repository on GitHub',11),detail:name,extra:summary(r),url:full},
    {id:'facts',start:8,end:12,eyebrow:'PROJECT DETAILS',heading:name,subtitle:spoken([r.category,r.language].filter(Boolean).join('. ')||'Project details',5),detail:facts||'GitHub open-source project',extra:summary(r),url:full},
    {id:'outro',start:12,end:15,eyebrow:'FULL GITHUB LINK',heading:'Explore the code',subtitle:'Open the full repository on GitHub.',detail:'SOURCE CODE • DOCUMENTATION',extra:summary(r),url:full},
  ]};
}
/** A repeatable daily selection from the most recently active published repos.
 *  This does not claim those repos were approved or created today. */
export function autoPickRoundup(repos:Resource[],day:string):[Resource,Resource,Resource]|null{
  const eligible=repos.filter(r=>r.type!=='profile' && /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(r.url));
  if(eligible.length<3)return null;
  const top=[...eligible].sort((a,b)=>{
    const at=Date.parse(a.updatedAt||'')||0,bt=Date.parse(b.updatedAt||'')||0;
    return bt-at||(b.stars||0)-(a.stars||0)||a.name.localeCompare(b.name);
  }).slice(0,40);
  const date=Date.parse(day+'T00:00:00Z');
  const index=Number.isFinite(date)?Math.floor(date/86400000)%top.length:0;
  const rotated=[...top.slice(index),...top.slice(0,index)];
  return [rotated[0],rotated[1],rotated[2]];
}
export function makeRoundupVideo(repos:[Resource,Resource,Resource]):VideoProject {
  const date=new Date().toISOString().slice(0,10);
  return {id:'roundup-'+date+'-'+repos.map(r=>slug(path(r))).join('-'),mode:'roundup',
    title:'GitHub roundup · '+date,selectedUrls:repos.map(r=>r.url),scenes:[
      {id:'intro',start:0,end:2,eyebrow:'DAILY GITHUB ROUNDUP',heading:'3 GitHub picks',subtitle:'Three GitHub picks.',detail:'APPROVED RESOURCE LIBRARY',extra:'Discover three open-source projects.',url:repos[0].url},
      ...repos.map((r,i)=>({id:'pick-'+(i+1),start:2+i*4,end:6+i*4,eyebrow:'PICK 0'+(i+1),
        heading:shortName(r),subtitle:spoken(shortName(r)+'. '+(r.oneLiner||r.description),9),
        detail:safeFact(r)||'GitHub repository',extra:summary(r),url:r.url})),
      {id:'outro',start:14,end:15,eyebrow:'EXPLORE MORE',heading:'Find your next tool',subtitle:'Explore more.',detail:'AI GITHUB RESOURCE HUB',extra:'Links for all three picks are shown with their projects.',url:repos[2].url},
    ]};
}
function wrap(ctx:CanvasRenderingContext2D,text:string,maxWidth:number,maxLines:number):string[]{
  const words=text.trim().split(/\s+/).filter(Boolean),lines:string[]=[];
  let row='';
  while(words.length && lines.length<maxLines){
    const word=words.shift()!;
    const proposed=row?row+' '+word:word;
    if(ctx.measureText(proposed).width<=maxWidth){row=proposed;continue;}
    if(row){lines.push(row);row='';words.unshift(word);continue;}
    let shortened=word;
    while(shortened.length>1&&ctx.measureText(shortened+'…').width>maxWidth)shortened=shortened.slice(0,-1);
    lines.push(shortened+(shortened.length!==word.length?'…':''));
  }
  if(row&&lines.length<maxLines)lines.push(row);
  if(words.length&&lines.length){
    const last=lines.length-1;
    while(lines[last].length>1&&ctx.measureText(lines[last]+'…').width>maxWidth)lines[last]=lines[last].slice(0,-1);
    lines[last]=lines[last].replace(/[.,;:\s]+$/,'')+'…';
  }
  return lines;
}
export function drawVideoFrame(canvas:HTMLCanvasElement,project:VideoProject,position:number):void{
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas unavailable');
  const w=canvas.width,h=canvas.height,t=Math.max(0,Math.min(VIDEO_SECONDS-.001,position));
  const s=project.scenes.find(s=>t>=s.start&&t<s.end)||project.scenes[project.scenes.length-1];
  const progress=Math.max(0,Math.min(1,(t-s.start)/(s.end-s.start)));
  const enter=Math.min(1,progress*6);
  ctx.save();
  const bg=ctx.createLinearGradient(0,0,w,h);
  bg.addColorStop(0,'#12162e');bg.addColorStop(.5,'#292449');bg.addColorStop(1,'#10364a');
  ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  for(let i=0;i<5;i++){
    ctx.beginPath();ctx.arc(w*(.12+i*.21)+Math.sin(t*.42+i)*35,h*(.18+i*.16)+Math.cos(t*.37+i)*43,85+i*23,0,Math.PI*2);
    ctx.fillStyle=['#6854ff1b','#35b8d923','#ed4e9a18'][i%3];ctx.fill();
  }
  ctx.strokeStyle='#9ba8fd55';ctx.lineWidth=2;ctx.strokeRect(53,160,w-106,520);
  ctx.fillStyle='#b7b7ff';ctx.font='700 19px system-ui, sans-serif';ctx.fillText('AI GITHUB RESOURCE HUB',44,67);
  ctx.fillStyle='#90a7c5';ctx.font='500 16px system-ui, sans-serif';
  ctx.fillText(project.mode==='individual'?'REPOSITORY SPOTLIGHT':'DAILY ROUNDUP',44,98);
  ctx.globalAlpha=enter;
  ctx.fillStyle='#a5b4fc';ctx.font='700 21px system-ui, sans-serif';
  ctx.fillText(s.eyebrow.toUpperCase().slice(0,35),56,225+18*(1-enter));
  ctx.fillStyle='#fff';ctx.font='800 45px system-ui, sans-serif';
  wrap(ctx,s.heading,425,3).forEach((line,i)=>ctx.fillText(line,56,302+i*58+25*(1-enter)));
  ctx.font='600 20px system-ui, sans-serif';ctx.fillStyle='#cad5f7';
  wrap(ctx,s.detail,425,2).forEach((line,i)=>ctx.fillText(line,56,494+i*31+12*(1-enter)));
  ctx.font='400 21px system-ui, sans-serif';ctx.fillStyle='#edf1ff';
  wrap(ctx,s.extra||'',425,4).forEach((line,i)=>ctx.fillText(line,56,558+i*27+12*(1-enter)));
  ctx.globalAlpha=1;
  // The complete actual GitHub URL is always visible, never shortened to owner/repo.
  // Use a legible compact font and break long path segments when necessary.
  if(s.url){
    ctx.fillStyle='#091226e8';ctx.beginPath();ctx.roundRect(24,h-307,w-48,81,12);ctx.fill();
    ctx.font='700 15px system-ui, sans-serif';ctx.fillStyle='#a8b9ff';ctx.fillText('COMPLETE GITHUB LINK',37,h-283);
    let size=17;
    ctx.font='600 '+size+'px system-ui, sans-serif';
    while(size>10&&ctx.measureText(s.url).width>w-80){size--;ctx.font='600 '+size+'px system-ui, sans-serif';}
    const address=ctx.measureText(s.url).width<=w-80?[s.url]:(()=>{
      const lines:string[]=[];let current='';
      for(const char of s.url){
        if(current&&ctx.measureText(current+char).width>w-80){lines.push(current);current='';}
        current+=char;
      }
      if(current)lines.push(current);
      return lines;
    })();
    // Render all URL characters, even if the address requires more than two lines.
    const fontSize=address.length>3?Math.max(8,Math.floor(14*3/address.length)):Math.max(11,size);
    ctx.font='600 '+fontSize+'px system-ui, sans-serif';ctx.fillStyle='#fff';
    const top=h-254-Math.max(0,address.length-2)*fontSize;
    address.forEach((line,i)=>ctx.fillText(line,37,top+i*(fontSize+1)));
  }
  // Permanent burned-in captions are synced to each scene's spoken narration.
  ctx.fillStyle='#050917e6';ctx.beginPath();ctx.roundRect(25,h-215,w-50,146,17);ctx.fill();
  ctx.font='650 25px system-ui, sans-serif';ctx.textAlign='center';ctx.fillStyle='#fff';
  const captions=wrap(ctx,s.subtitle,w-95,3),lineHeight=34;
  const top=h-142-(captions.length-1)*lineHeight/2;
  captions.forEach((line,i)=>ctx.fillText(line,w/2,top+i*lineHeight));
  ctx.textAlign='left';ctx.font='600 16px system-ui, sans-serif';ctx.fillStyle='#91a6c8';
  ctx.fillText('AI GITHUB RESOURCE HUB',33,h-39);
  ctx.textAlign='right';ctx.fillText('15 SEC',w-33,h-39);
  ctx.fillStyle='#91a6c844';ctx.fillRect(0,h-9,w,9);
  ctx.fillStyle='#a6a0ff';ctx.fillRect(0,h-9,w*t/VIDEO_SECONDS,9);
  ctx.restore();
}
const srtStamp=(time:number)=>{
  const ms=Math.round(time*1000);
  return '00:00:'+String(Math.floor(ms/1000)).padStart(2,'0')+','+String(ms%1000).padStart(3,'0');
};
export function videoSrt(project:VideoProject):string{
  // An instrumental bumper has no speech, so it should not produce an
  // empty subtitle cue in the downloadable SRT.
  return project.scenes.filter(s=>s.subtitle.trim()).map((s,i)=>String(i+1)+'\n'+srtStamp(s.start)+' --> '+srtStamp(s.end)+'\n'+s.subtitle.replace(/[\r\n]+/g,' ')+'\n').join('\n');
}
export async function renderVideoMp4(project:VideoProject,audio:AudioBuffer,onProgress:(percent:number)=>void):Promise<Blob>{
  if(typeof window==='undefined'||!('VideoEncoder' in window)){
    throw new Error('MP4 export requires WebCodecs. Try the latest Edge or Chrome on desktop.');
  }
  const {Output,Mp4OutputFormat,BufferTarget,CanvasSource,AudioBufferSource,Quality}=await import('mediabunny');
  const canvas=document.createElement('canvas');
  canvas.width=VIDEO_WIDTH;canvas.height=VIDEO_HEIGHT;
  const target=new BufferTarget();
  const output=new Output({format:new Mp4OutputFormat(),target});
  const source=new CanvasSource(canvas,{codec:'avc',quality:new Quality('medium')});
  output.addVideoTrack(source);
  const audioSource=new AudioBufferSource({codec:'aac',quality:new Quality({bitrate:128000})});
  output.addAudioTrack(audioSource);
  if(audio.duration<VIDEO_SECONDS-0.1)throw new Error('The soundtrack is shorter than the 15-second video. Generate the narration again.');
  await output.start();
  // Feed both tracks concurrently: awaiting a full 15-second audio buffer before
  // the first video frame can deadlock a bounded muxer waiting for video samples.
  let audioError:unknown=null;
  const audioJob=audioSource.add(audio).catch(error=>{audioError=error;});
  for(let frame=0;frame<VIDEO_SECONDS*VIDEO_FPS;frame++){
    drawVideoFrame(canvas,project,frame/VIDEO_FPS);
    await source.add(frame/VIDEO_FPS,1/VIDEO_FPS);
    if(frame%12===0)onProgress(Math.round(frame/(VIDEO_SECONDS*VIDEO_FPS)*100));
  }
  await audioJob;
  if(audioError)throw audioError;
  await output.finalize();
  onProgress(100);
  if(!target.buffer)throw new Error('MP4 encoder did not return a completed video');
  return new Blob([new Uint8Array(target.buffer)],{type:'video/mp4'});
}

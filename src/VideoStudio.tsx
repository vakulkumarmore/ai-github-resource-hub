import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, Download, Film, LoaderCircle, Pause, Play, Search, ShieldCheck, Sparkles, Video, X } from 'lucide-react';
import { resourceKey, type Resource } from './Importer';
import { drawVideoFrame, makeIndividualVideo, makeRoundupVideo, renderVideoMp4, videoSignature, videoSrt, VIDEO_HEIGHT, VIDEO_SECONDS, VIDEO_WIDTH, type VideoProject, type VideoMode } from './videoStudioEngine';
import './videoStudio.css';

type Props={publishedCatalog:Resource[]};
const APPROVALS_KEY='ai-hub-video-approvals-v35';
const loadApprovals=():Record<string,string>=>{
  try{const o=JSON.parse(localStorage.getItem(APPROVALS_KEY)||'{}');return o&&typeof o==='object'&&!Array.isArray(o)?o:{};}
  catch{return {};}
};
const download=(blob:Blob,filename:string)=>{
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
};
const safeName=(name:string)=>name.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'github-video';

export default function VideoStudio({publishedCatalog}:Props){
  const eligible=useMemo(()=>publishedCatalog.filter(r=>r.type!=='profile'&&/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(r.url)),[publishedCatalog]);
  const [mode,setMode]=useState<VideoMode>('individual');
  const [query,setQuery]=useState('');
  const [selected,setSelected]=useState<string[]>([]);
  const [project,setProject]=useState<VideoProject|null>(null);
  const [approved,setApproved]=useState<Record<string,string>>(loadApprovals);
  const [position,setPosition]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState(0);
  const [status,setStatus]=useState('');
  const canvasRef=useRef<HTMLCanvasElement|null>(null);
  const playbackStart=useRef(0);
  const current=useRef(0);
  const matches=useMemo(()=>eligible.filter(r=>{
    const q=query.trim().toLowerCase();
    return !q||[r.name,r.url,r.category,r.oneLiner||'',r.description].join(' ').toLowerCase().includes(q);
  }).slice(0,70),[eligible,query]);
  const required=mode==='individual'?1:3;
  const currentResources=useMemo(()=>selected.map(url=>eligible.find(r=>resourceKey(r.url)===url)).filter((r):r is Resource=>!!r),[selected,eligible]);
  const signature=project?videoSignature(project):'';
  const isApproved=!!project&&approved[project.id]===signature;

  useEffect(()=>{
    const c=canvasRef.current;
    if(c&&project)drawVideoFrame(c,project,position);
  },[project,position]);

  useEffect(()=>{
    if(!playing||!project)return;
    let handle=0;
    playbackStart.current=performance.now()-current.current*1000;
    const frame=(now:number)=>{
      const t=Math.min(VIDEO_SECONDS,(now-playbackStart.current)/1000);
      current.current=t;
      setPosition(t);
      if(t>=VIDEO_SECONDS){setPlaying(false);current.current=0;setPosition(0);return;}
      handle=requestAnimationFrame(frame);
    };
    handle=requestAnimationFrame(frame);
    return ()=>cancelAnimationFrame(handle);
  },[playing,project]);

  const toggle=(url:string)=>{
    const key=resourceKey(url);
    setSelected(prev=>prev.includes(key)?prev.filter(k=>k!==key):prev.length>=required?[...prev.slice(1),key]:[...prev,key]);
    setProject(null);setStatus('');setPlaying(false);current.current=0;setPosition(0);
  };
  const changeMode=(next:VideoMode)=>{
    setMode(next);setSelected([]);setProject(null);setQuery('');setStatus('');setPlaying(false);current.current=0;setPosition(0);
  };
  const create=()=>{
    if(currentResources.length!==required)return;
    const next=mode==='individual'?makeIndividualVideo(currentResources[0]):makeRoundupVideo(currentResources as [Resource,Resource,Resource]);
    setProject(next);setPosition(0);current.current=0;setPlaying(false);
    setStatus('Preview the full 15 seconds, edit captions if needed, and approve the final script before MP4 export.');
  };
  const editScene=(index:number,field:'heading'|'subtitle'|'detail',value:string)=>{
    setProject(old=>!old?null:{...old,scenes:old.scenes.map((s,i)=>i===index?{...s,[field]:value}:s)});
    setPlaying(false);setStatus('Script edited. Review and approve this version again before exporting.');
  };
  const approve=()=>{
    if(!project||busy)return;
    if(!window.confirm('Approve this exact 15-second video script and its on-screen subtitles for export? No video will be posted automatically.'))return;
    const next={...approved,[project.id]:videoSignature(project)};
    setApproved(next);
    try{localStorage.setItem(APPROVALS_KEY,JSON.stringify(next));}catch{/* approval remains in this tab */}
    setStatus('Approved for export on this browser. Nothing has been shared or published.');
  };
  const exportMp4=async()=>{
    if(!project||!isApproved||busy)return;
    setBusy(true);setProgress(0);setPlaying(false);setStatus('Encoding video locally in your browser. This can take a minute...');
    try{
      const blob=await renderVideoMp4(project,setProgress);
      download(blob,'ai-github-resource-hub-'+safeName(project.title)+'.mp4');
      setStatus('MP4 exported successfully with burned-in subtitles. Review the downloaded video before sharing.');
    }catch(error){
      setStatus('MP4 export failed: '+(error instanceof Error?error.message:String(error))+'. No partial export was downloaded.');
    }finally{setBusy(false);}
  };
  const exportSrt=()=>{
    if(!project||!isApproved)return;
    download(new Blob([videoSrt(project)],{type:'text/plain;charset=utf-8'}),'ai-github-resource-hub-'+safeName(project.title)+'.srt');
  };
  const play=()=>{
    if(!project)return;
    if(position>=VIDEO_SECONDS){current.current=0;setPosition(0);}
    setPlaying(x=>!x);
  };

  return <section className="workspace-panel video-studio">
    <div className="video-studio-header"><div><p className="video-studio-kicker"><Film size={16}/> ADMIN VIDEO STUDIO</p>
      <h2>Create 15-second repository videos</h2>
      <p>Original motion graphics from your approved, published GitHub catalog. Videos are rendered locally, with readable subtitles burned into the MP4.</p></div>
      <span className="video-studio-label"><ShieldCheck size={15}/> Review required</span>
    </div>
    <div className="video-studio-note">
      <Sparkles size={18}/><span>Only <strong>published repository entries</strong> can be featured. No paid AI, cloud rendering, external images or automatic social posting. Videos are <strong>silent and captioned</strong>, with optional downloadable SRT.</span>
    </div>
    <div className="video-studio-modes" role="group" aria-label="Video format">
      <button type="button" className={mode==='individual'?'active':''} onClick={()=>changeMode('individual')} aria-pressed={mode==='individual'}><Video size={17}/> Individual spotlight <span>1 repository · 15s</span></button>
      <button type="button" className={mode==='roundup'?'active':''} onClick={()=>changeMode('roundup')} aria-pressed={mode==='roundup'}><Film size={17}/> Daily roundup <span>3 repositories · 15s</span></button>
    </div>
    <div className="video-studio-layout">
      <div className="video-studio-editor">
        <div className="video-studio-section-head"><h3>1. Select {mode==='individual'?'one approved repository':'three approved repositories'}</h3><span>{selected.length}/{required} selected</span></div>
        <label className="search-box compact"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search published repositories" aria-label="Find approved repository"/></label>
        <div className="video-studio-picker" role="group" aria-label="Choose repositories for video">
          {matches.map(r=>{
            const key=resourceKey(r.url),chosen=selected.includes(key);
            return <button type="button" key={key} className={chosen?'is-selected':''} aria-pressed={chosen} onClick={()=>toggle(r.url)}>
              <span className="video-picker-mark">{chosen?<Check size={15}/>:<span/>}</span>
              <span className="video-picker-name"><strong>{r.name}</strong><small>{r.url.replace('https://github.com/','')}</small></span>
              <span className="video-picker-category">{r.category||'Developer Tools'}</span>
            </button>;
          })}
          {!matches.length&&<p>No matching published repositories.</p>}
        </div>
        <div className="video-studio-selection">
          {currentResources.map((r,i)=><span key={resourceKey(r.url)}>{mode==='roundup'?String(i+1)+'. ':''}{r.name}<button type="button" onClick={()=>toggle(r.url)} aria-label={'Remove '+r.name}><X size={12}/></button></span>)}
        </div>
        <button type="button" className="btn primary" disabled={currentResources.length!==required||busy} onClick={create}>
          <Film size={17}/> {project?'Rebuild script from repository details':'Create video script'}
        </button>

        {project&&<div className="video-studio-script">
          <div className="video-studio-section-head"><h3>2. Edit the timed scenes and subtitles</h3><span>15 seconds total</span></div>
          {project.scenes.map((scene,i)=><div className="video-scene-editor" key={scene.id}>
            <div className="video-scene-head"><strong>{scene.eyebrow}</strong><span>{scene.start}–{scene.end}s</span></div>
            <label>On-screen headline<input maxLength={110} value={scene.heading} onChange={e=>editScene(i,'heading',e.target.value)}/></label>
            <label>Subtitle / caption<textarea rows={2} maxLength={220} value={scene.subtitle} onChange={e=>editScene(i,'subtitle',e.target.value)}/></label>
            <label>Supporting label<input maxLength={110} value={scene.detail} onChange={e=>editScene(i,'detail',e.target.value)}/></label>
          </div>)}
          <div className="video-studio-approval">
            <strong>{isApproved?<><CheckCircle2 size={18}/> Approved for export</>:<>3. Review and approve before export</>}</strong>
            <p>Review the preview and verify each claim. Editing any scene automatically invalidates its previous approval. Approval is stored on this browser only.</p>
            <button type="button" className="btn primary" disabled={isApproved||busy} onClick={approve}>
              <ShieldCheck size={17}/>{isApproved?'Approved':'Approve this video'}
            </button>
          </div>
        </div>}
      </div>

      <div className="video-studio-preview">
        <div className="video-studio-section-head"><h3>Live preview</h3><span>9:16 vertical · 15s</span></div>
        {project?<><canvas ref={canvasRef} width={VIDEO_WIDTH} height={VIDEO_HEIGHT} className="video-studio-canvas" role="img" aria-label={'Video preview for '+project.title+'. Captions and timed headlines may be edited on the left.'}/>
          <div className="video-studio-playback">
            <button className="btn subtle small" onClick={play} aria-label={playing?'Pause preview':'Play preview'}>{playing?<Pause size={17}/>:<Play size={17}/>} {playing?'Pause':'Play'}</button>
            <input type="range" min={0} max={VIDEO_SECONDS} step={0.05} value={position} aria-label="Scrub 15-second video" onChange={e=>{setPlaying(false);const n=Number(e.target.value);current.current=n;setPosition(n);}}/>
            <span>{position.toFixed(1)} / {VIDEO_SECONDS}s</span>
          </div>
          <div className="video-studio-export">
            <button className="btn primary" disabled={!isApproved||busy} onClick={()=>void exportMp4()}>
              {busy?<LoaderCircle size={16} className="spin"/>:<Download size={16}/>}
              {busy?'Rendering '+progress+'%':'Export 15s MP4'}
            </button>
            <button className="btn subtle" disabled={!isApproved||busy} onClick={exportSrt}><Download size={15}/> Export .srt</button>
          </div>
          {busy&&<progress max={100} value={progress} aria-label="MP4 rendering progress"/>}
          </>:<div className="video-studio-empty"><Film size={40}/><strong>No video created yet</strong><p>Choose {required} published {required===1?'repository':'repositories'} and click Create video script to preview and edit your video.</p></div>}
        {status&&<p className="video-studio-status" role="status">{status}</p>}
        <p className="video-studio-disclaimer">MP4 export uses your browser's WebCodecs H.264 support and may take time on slower computers. There is no voice track or background music in this initial version.</p>
      </div>
    </div>
  </section>;
}

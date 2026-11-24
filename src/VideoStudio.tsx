import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, Download, Film, LoaderCircle, Pause, Play, Search, ShieldCheck, Sparkles, Video, X } from 'lucide-react';
import { resourceKey, type Resource } from './Importer';
import { autoPickRoundup, drawVideoFrame, makeIndividualVideo, makeRoundupVideo, renderVideoMp4, videoSignature, videoSrt, VIDEO_HEIGHT, VIDEO_SECONDS, VIDEO_WIDTH, type VideoProject, type VideoMode } from './videoStudioEngine';
import { generateVideoSoundtrack, type NarrationAdjustment, type VoiceOption } from './videoStudioAudio';
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
  const [audioBusy,setAudioBusy]=useState(false);
  const [voice,setVoice]=useState<VoiceOption>('freya');
  const [modelFile,setModelFile]=useState<File|null>(null);
  const [musicLevel,setMusicLevel]=useState(.12);
  const [sound,setSound]=useState<AudioBuffer|null>(null);
  const [soundSignature,setSoundSignature]=useState('');
  const [audioProgress,setAudioProgress]=useState(0);
  const [audioStatus,setAudioStatus]=useState('');
  const [narrationAdjustments,setNarrationAdjustments]=useState<NarrationAdjustment[]>([]);
  const audioContextRef=useRef<AudioContext|null>(null);
  const playbackRef=useRef<AudioBufferSourceNode|null>(null);
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
  const signature=project?videoSignature(project)+'|voice='+voice+'|music='+musicLevel:'';
  const audioReady=!!project&&!!sound&&soundSignature===signature;
  const isApproved=audioReady&&approved[project!.id]===signature;

  useEffect(()=>{
    const c=canvasRef.current;
    if(c&&project)drawVideoFrame(c,project,position);
  },[project,position]);

  useEffect(()=>{
    if(!playing||!project)return;
    let handle=0;
    if(audioReady&&sound){
      const ctx=audioContextRef.current||new AudioContext();
      audioContextRef.current=ctx;
      const source=ctx.createBufferSource();
      source.buffer=sound;source.connect(ctx.destination);
      source.start(0,Math.min(current.current,VIDEO_SECONDS-.01));
      playbackRef.current=source;
      void ctx.resume();
    }
    playbackStart.current=performance.now()-current.current*1000;
    const frame=(now:number)=>{
      const t=Math.min(VIDEO_SECONDS,(now-playbackStart.current)/1000);
      current.current=t;
      setPosition(t);
      if(t>=VIDEO_SECONDS){setPlaying(false);current.current=0;setPosition(0);return;}
      handle=requestAnimationFrame(frame);
    };
    handle=requestAnimationFrame(frame);
    return ()=>{
      cancelAnimationFrame(handle);
      try{playbackRef.current?.stop();}catch{/* already stopped */}
      playbackRef.current?.disconnect();
      playbackRef.current=null;
    };
  },[playing,project,audioReady,sound]);

  const toggle=(url:string)=>{
    if(audioBusy||busy)return;
    const key=resourceKey(url);
    setSelected(prev=>prev.includes(key)?prev.filter(k=>k!==key):prev.length>=required?[...prev.slice(1),key]:[...prev,key]);
    setProject(null);setSound(null);setSoundSignature('');setStatus('');setPlaying(false);current.current=0;setPosition(0);
  };
  const changeMode=(next:VideoMode)=>{
    if(audioBusy||busy)return;
    setMode(next);setSelected([]);setProject(null);setSound(null);setSoundSignature('');setQuery('');setStatus('');setPlaying(false);current.current=0;setPosition(0);
  };
  const pickToday=()=>{
    if(audioBusy||busy)return;
    const picked=autoPickRoundup(eligible,new Date().toISOString().slice(0,10));
    if(!picked){setStatus('At least three published repositories are required for a roundup.');return;}
    setSelected(picked.map(r=>resourceKey(r.url)));
    setProject(null);setSound(null);setSoundSignature('');setPlaying(false);current.current=0;setPosition(0);
    setStatus('Selected three recently active published repositories for today. Review the selection before generating and approving the video.');
  };
  const create=()=>{
    if(audioBusy||busy||currentResources.length!==required)return;
    const next=mode==='individual'?makeIndividualVideo(currentResources[0]):makeRoundupVideo(currentResources as [Resource,Resource,Resource]);
    setProject(next);setSound(null);setSoundSignature('');setPosition(0);current.current=0;setPlaying(false);
    setStatus('Review the full details and complete GitHub links, edit spoken subtitles, then generate narrated audio and music before approval.');
  };
  const editScene=(index:number,field:'heading'|'subtitle'|'detail'|'extra',value:string)=>{
    if(audioBusy||busy)return;
    setNarrationAdjustments([]);
    setProject(old=>!old?null:{...old,scenes:old.scenes.map((s,i)=>i===index?{...s,[field]:value}:s)});
    setPlaying(false);setSound(null);setSoundSignature('');
    setStatus('Script edited. Regenerate narration and music, then approve again before exporting.');
  };
  const changeVoice=(next:VoiceOption)=>{
    if(audioBusy||busy)return;
    setNarrationAdjustments([]);
    setPlaying(false);setVoice(next);setSound(null);setSoundSignature('');
    setStatus('Voice changed. Regenerate audio and approve this version again.');
  };
  const changeMusic=(next:number)=>{
    if(audioBusy||busy)return;
    setNarrationAdjustments([]);
    setPlaying(false);setMusicLevel(next);setSound(null);setSoundSignature('');
    setStatus('Music level changed. Regenerate audio and approve this version again.');
  };
  const makeAudio=async()=>{
    if(!project||audioBusy||busy)return;
    setAudioBusy(true);setPlaying(false);setSound(null);setSoundSignature('');
    setNarrationAdjustments([]);
    setAudioStatus('Preparing speech model…');setAudioProgress(0);
    try{
      const output=await generateVideoSoundtrack(project,voice,musicLevel,(stage,percent)=>{
        setAudioStatus(stage);setAudioProgress(percent);
      },modelFile);
      // Audio is synthesized for these *actual* captions. Always update the
      // storyboard before setting the matching approval/export signature.
      setProject(output.project);
      setSound(output.audio);
      setSoundSignature(videoSignature(output.project)+'|voice='+voice+'|music='+musicLevel);
      setNarrationAdjustments(output.adjustments);
      const count=output.adjustments.length;
      setStatus(count
        ? 'Narration ready. Automatically shortened '+count+' scene'+(count===1?'':'s')+' to fit. Review the updated subtitles and preview with audio, then approve this exact version before exporting.'
        : 'Narration and original background music are ready. Preview with audio, then approve the video.');
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      setAudioStatus('Audio generation failed: '+message);
      setStatus(/download|model|runtime|HTTP|connect/i.test(message)
        ? 'Speech model or runtime could not load. Check the specific error and optional local model below.'
        : 'Speech could not fit the 15-second scene timeline. Review the detailed error and retry. No unmatched subtitles or partial audio are exported.');
    }finally{setAudioBusy(false);}
  };
  const approve=()=>{
    if(!project||busy||!audioReady)return;
    if(!window.confirm('Approve these exact 15-second scenes, spoken narration, original music level, and full GitHub links for export? No video will be posted automatically.'))return;
    const next={...approved,[project.id]:signature};
    setApproved(next);
    try{localStorage.setItem(APPROVALS_KEY,JSON.stringify(next));}catch{/* approval remains in this tab */}
    setStatus('Approved for export on this browser. Nothing has been shared or published.');
  };
  const exportMp4=async()=>{
    if(!project||!isApproved||busy)return;
    setBusy(true);setProgress(0);setPlaying(false);setStatus('Encoding video locally in your browser. This can take a minute...');
    try{
      if(!sound)throw new Error('Narration and background music must be generated before export.');
      const blob=await renderVideoMp4(project,sound,setProgress);
      download(blob,'ai-github-resource-hub-'+safeName(project.title)+'.mp4');
      setStatus('15-second MP4 exported with spoken narration, original background music, subtitles, and complete GitHub links. Review the downloaded video before sharing.');
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
      <p>15-second repository videos with expanded descriptions, full GitHub URLs, AI narration and original background music, mixed directly into the MP4.</p></div>
      <span className="video-studio-label"><ShieldCheck size={15}/> Review required</span>
    </div>
    <div className="video-studio-note">
      <Sparkles size={18}/><span>Only <strong>published GitHub repositories</strong> can be featured. Free local AI narration downloads a speech model on first use. Music is generated from original synthesizer sounds. MP4s include audio, full URLs and timed captions. No automatic social posting.</span>
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
        {mode==='roundup'&&<button type="button" className="btn subtle small" onClick={pickToday}><Sparkles size={15}/> Pick today's 3 automatically</button>}
        <div className="video-studio-selection">
          {currentResources.map((r,i)=><span key={resourceKey(r.url)}>{mode==='roundup'?String(i+1)+'. ':''}{r.name}<button type="button" onClick={()=>toggle(r.url)} aria-label={'Remove '+r.name}><X size={12}/></button></span>)}
        </div>
        <button type="button" className="btn primary" disabled={currentResources.length!==required||busy||audioBusy} onClick={create}>
          <Film size={17}/> {project?'Rebuild script from repository details':'Create video script'}
        </button>

        {project&&<div className="video-studio-script">
          <div className="video-studio-section-head"><h3>2. Review details and spoken subtitles</h3><span>15 seconds total</span></div>
          <div className="video-studio-links"><strong>Complete GitHub links shown in video</strong>
            {project.selectedUrls.map(url=><a href={url} target="_blank" rel="noopener noreferrer" key={url}>{url}</a>)}
          </div>
          {project.scenes.map((scene,i)=><div className="video-scene-editor" key={scene.id}>
            <div className="video-scene-head"><strong>{scene.eyebrow}</strong><span>{scene.start}–{scene.end}s</span></div>
            <label>On-screen headline<input disabled={audioBusy||busy} maxLength={110} value={scene.heading} onChange={e=>editScene(i,'heading',e.target.value)}/></label>
            <label>Spoken narration / synchronized subtitle<textarea disabled={audioBusy||busy} rows={2} maxLength={160} value={scene.subtitle} onChange={e=>editScene(i,'subtitle',e.target.value)}/></label>
            <small>Speech is measured against the {scene.end-scene.start}-second scene. Long narration is automatically shortened and re-recorded; you'll review any changes before approval.</small>
            <label>Supporting label<input disabled={audioBusy||busy} maxLength={110} value={scene.detail} onChange={e=>editScene(i,'detail',e.target.value)}/></label>
            <label>Extended repository details shown in the video<textarea disabled={audioBusy||busy} rows={3} maxLength={420} value={scene.extra||''} onChange={e=>editScene(i,'extra',e.target.value)}/></label>
          </div>)}
          <div className="video-studio-audio">
            <div className="video-studio-section-head"><h3>3. Generate narration + background music</h3><span>Runs locally in your browser</span></div>
            <div className="video-studio-audio-controls">
              <label>English narration voice
                <select value={voice} disabled={audioBusy} onChange={e=>changeVoice(e.target.value as VoiceOption)}>
                  <option value="freya">Freya · default</option>
                  <option value="claire">Claire</option>
                  <option value="sofia">Sofia</option>
                  <option value="lukas">Lukas</option>
                  <option value="lucas">Lucas</option>
                </select>
              </label>
              <label>Original background music level: {Math.round(musicLevel*100)}%
                <input type="range" min={0} max={.3} step={.02} value={musicLevel} disabled={audioBusy} onChange={e=>changeMusic(Number(e.target.value))}/>
              </label>
            </div>
            <div className="video-studio-model-file">
              <label>Use a local speech model if the online download fails (optional)
                <input type="file" accept=".litertlm" disabled={audioBusy||busy}
                  onChange={event=>{
                    const file=event.target.files?.[0]||null;
                    setModelFile(file);setPlaying(false);setSound(null);setSoundSignature('');
                    setAudioStatus(file?'Local model selected: '+file.name+' ('+(file.size/1048576).toFixed(1)+' MiB). Click Generate again.':'');
                  }}/>
              </label>
              <small>Prefer the automatic download above. If your network blocks the model, get the official <a href="https://huggingface.co/litert-community/phonon-31m-en/blob/main/phonon_int8.litertlm" rel="noopener noreferrer" target="_blank">Phonon 31M model from Hugging Face</a>, then select the .litertlm file here. The model is used in your browser and is not uploaded to this website.</small>
              {modelFile&&<button type="button" className="btn subtle small" disabled={audioBusy} onClick={()=>{
                setModelFile(null);setSound(null);setSoundSignature('');setAudioStatus('Using automatic model download on the next attempt.');
              }}>Use automatic download instead</button>}
            </div>
            <button className="btn primary" disabled={audioBusy||busy} onClick={()=>void makeAudio()}>
              {audioBusy?<LoaderCircle size={16} className="spin"/>:<Film size={16}/>}
              {audioBusy?'Generating '+Math.round(audioProgress)+'%':audioReady?'Regenerate narration + music':'Generate narration + music'}
            </button>
            {audioBusy&&<progress max={100} value={audioProgress} aria-label="Generating narration"/>}
            {audioStatus&&<p role="status">{audioStatus}</p>}
            {narrationAdjustments.length>0&&<div className="video-studio-narration-adjustments">
              <strong>Auto-adjusted spoken captions ({narrationAdjustments.length})</strong>
              <p>To stay within the 15-second video, these lines were shortened or made instrumental. The full repository descriptions and URLs remain visible. Review the new script above before approving.</p>
              <ul>{narrationAdjustments.map(change=><li key={change.sceneId}>
                <b>{change.sceneId}:</b> <del>{change.from}</del> <span>→</span> <ins>{change.to||'Instrumental scene, no spoken subtitle'}</ins>
              </li>)}</ul>
            </div>
            <small>First use needs an approximately 87 MB open-source Phonon model. This version serves the MediaPipe runtime from your own site and tries a secure Cloudflare model download before attempting Hugging Face directly. Errors identify the failed download. Once loaded, speech synthesis and audio mixing run locally; there are no paid voice credits.</small>
          </div>
          <div className="video-studio-approval">
            <strong>{isApproved?<><CheckCircle2 size={18}/> Approved for export</>:<>4. Preview and approve with audio</>}</strong>
            <p>Verify that narration, subtitles, detailed descriptions and each full GitHub URL are accurate. Any script, voice or music edit requires generating audio and approving again. Approval stays in this browser.</p>
            <button type="button" className="btn primary" disabled={!audioReady||isApproved||busy||audioBusy} onClick={approve}>
              <ShieldCheck size={17}/>{isApproved?'Approved':'Approve this video'}
            </button>
          </div>
        </div>}
      </div>

      <div className="video-studio-preview">
        <div className="video-studio-section-head"><h3>Live preview</h3><span>9:16 vertical · 15s</span></div>
        {project?<><canvas ref={canvasRef} width={VIDEO_WIDTH} height={VIDEO_HEIGHT} className="video-studio-canvas" role="img" aria-label={'Video preview for '+project.title+'. Captions and timed headlines may be edited on the left.'}/>
          <div className="video-studio-playback">
            <button className="btn subtle small" disabled={!audioReady} onClick={play} aria-label={playing?'Pause preview':'Play preview'}>{playing?<Pause size={17}/>:<Play size={17}/>} {playing?'Pause':'Play'}</button>
            <input type="range" min={0} max={VIDEO_SECONDS} step={0.05} value={position} aria-label="Scrub 15-second video" onChange={e=>{setPlaying(false);const n=Number(e.target.value);current.current=n;setPosition(n);}}/>
            <span>{position.toFixed(1)} / {VIDEO_SECONDS}s</span>
          </div>
          {!audioReady&&<p className="video-studio-audio-hint">Generate narration + background music to hear the preview and enable MP4 export.</p>}
          <div className="video-studio-export">
            <button className="btn primary" disabled={!isApproved||!audioReady||busy||audioBusy} onClick={()=>void exportMp4()}>
              {busy?<LoaderCircle size={16} className="spin"/>:<Download size={16}/>}
              {busy?'Rendering '+progress+'%':'Export 15s MP4'}
            </button>
            <button className="btn subtle" disabled={!isApproved||busy||audioBusy} onClick={exportSrt}><Download size={15}/> Export .srt</button>
          </div>
          {busy&&<progress max={100} value={progress} aria-label="MP4 rendering progress"/>}
          </>:<div className="video-studio-empty"><Film size={40}/><strong>No video created yet</strong><p>Choose {required} published {required===1?'repository':'repositories'} and click Create video script to preview and edit your video.</p></div>}
        {status&&<p className="video-studio-status" role="status">{status}</p>}
        <p className="video-studio-disclaimer">Your final MP4 contains actual AI voice narration, background music, burned-in subtitles, expanded descriptions and complete GitHub URLs. Fifteen seconds cannot fit an entire README, so spoken lines are brief. MP4/AAC encoding needs a current Chromium-based browser.</p>
      </div>
    </div>
  </section>;
}

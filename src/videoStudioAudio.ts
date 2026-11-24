import { VIDEO_SECONDS, type VideoProject } from './videoStudioEngine';
import { fitSpokenScene } from './videoNarrationFit';

/**
 * Zero paid APIs. MediaPipe Phonon speech runs locally using a small model
 * downloaded from Hugging Face on first use. Voice and original music are mixed
 * into exactly 15 seconds by OfflineAudioContext and muxed into the exported MP4.
 */
export type VoiceOption='freya'|'claire'|'sofia'|'lukas'|'lucas';
export type NarrationAdjustment={sceneId:string;from:string;to:string};
export type SoundtrackResult={audio:AudioBuffer;project:VideoProject;adjustments:NarrationAdjustment[]};
type RawSpeech={samples:Float32Array; sampleRateHz:number};
type TtsEngine={synthesize:(text:string,options?:{voiceId?:string})=>Promise<RawSpeech>};
type Progress=(stage:string,percent:number)=>void;
let cachedEngine:Promise<TtsEngine>|null=null;
const MODEL_FILENAME='phonon_int8.litertlm';
const MAX_MODEL_BYTES=125*1024*1024;
const EXPECTED_MIN_BYTES=40*1024*1024;
const PROXY='/api/tts-model';
const HUGGING_FACE='https://huggingface.co/litert-community/phonon-31m-en/resolve/main/'+MODEL_FILENAME;

/** Read the model with byte-level progress, a strict size cap, and useful errors. */
async function readModel(source:string,label:string,onProgress:Progress):Promise<Uint8Array>{
  let response:Response;
  try{
    response=await fetch(source,{credentials:source.startsWith('/')?'same-origin':'omit'});
  }catch(error){
    throw new Error(label+' could not connect ('+(error instanceof Error?error.message:'network error')+').');
  }
  if(!response.ok){
    let message='';
    if(response.headers.get('content-type')?.includes('json')){
      try{message=(await response.json()).error||'';}catch{/* source may not provide JSON */}
    }
    throw new Error(label+' returned HTTP '+response.status+(message?': '+message:''));
  }
  const size=Number(response.headers.get('content-length')||0);
  if(size>MAX_MODEL_BYTES)throw new Error(label+' returned a file larger than the 125 MiB safety cap.');
  if(!response.body)throw new Error(label+' returned no readable body.');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];
  let length=0;
  try{
    while(true){
      const result=await reader.read();
      if(result.done)break;
      const part=result.value;
      length+=part.byteLength;
      if(length>MAX_MODEL_BYTES)throw new Error(label+' exceeded the 125 MiB safety cap.');
      parts.push(part);
      if(size>0)onProgress('Downloading local speech model from '+label+' ('+Math.round(length/size*100)+'%)…',3+Math.min(15,length/size*15));
      else onProgress('Downloading speech model from '+label+' ('+(length/1048576).toFixed(1)+' MiB)…',5);
    }
  }catch(error){
    try{await reader.cancel();}catch{/* request already closed */}
    throw new Error(label+' download interrupted: '+(error instanceof Error?error.message:String(error)));
  }
  if(length<EXPECTED_MIN_BYTES)throw new Error(label+' returned only '+(length/1048576).toFixed(1)+' MiB, not the expected speech model. Check your connection.');
  const data=new Uint8Array(length);
  let index=0;
  for(const part of parts){data.set(part,index);index+=part.byteLength;}
  return data;
}

async function loadModel(onProgress:Progress,localModel?:File|null):Promise<Uint8Array>{
  if(localModel){
    if(!localModel.name.toLowerCase().endsWith('.litertlm'))
      throw new Error('Please select the official .litertlm speech model file.');
    if(localModel.size<EXPECTED_MIN_BYTES||localModel.size>MAX_MODEL_BYTES)
      throw new Error('The local speech model must be 40–125 MiB. Choose the original Phonon .litertlm file.');
    onProgress('Loading the local speech model from your computer…',7);
    return new Uint8Array(await localModel.arrayBuffer());
  }
  onProgress('Downloading Phonon speech model through your Cloudflare Worker…',3);
  const errors:string[]=[];
  for(const [url,label] of [[PROXY,'Cloudflare model relay'],[HUGGING_FACE,'Hugging Face direct']] as const){
    try{return await readModel(url,label,onProgress);}
    catch(error){errors.push(error instanceof Error?error.message:String(error));}
  }
  throw new Error('Unable to download narration model. '+errors.join(' ')+' You can download '+MODEL_FILENAME+' from Hugging Face and select it under "Use a local speech model".');
}

/**
 * Serve WASM from the same Cloudflare Worker origin instead of jsDelivr.
 * Explicit checks identify a missing deploy rather than "Failed to fetch".
 */
async function loadEngine(onProgress:Progress,localModel?:File|null):Promise<TtsEngine>{
  if(cachedEngine)return cachedEngine;
  cachedEngine=(async()=>{
    const [{FilesetResolver,TextToSpeech},model]=await Promise.all([
      import('@mediapipe/tasks-audio'),
      loadModel(onProgress,localModel),
    ]);
    const wasmBase=new URL('/mediapipe-wasm/',window.location.origin).toString().replace(/\/$/,'');
    const fileset=await FilesetResolver.forAudioTasks(wasmBase);
    for(const entry of [fileset.wasmLoaderPath,fileset.wasmBinaryPath]){
      let response:Response;
      try{response=await fetch(entry,{method:'HEAD',credentials:'same-origin'});}
      catch(error){throw new Error('Local MediaPipe WASM resource unreachable: '+entry+' ('+String(error)+').');}
      if(!response.ok)throw new Error('Local MediaPipe runtime missing (HTTP '+response.status+'): '+entry+'. Check the latest Cloudflare deployment.');
    }
    onProgress('Initializing MediaPipe speech model locally…',20);
    try{
      return await TextToSpeech.createFromOptions(fileset,{
        baseOptions:{modelAssetBuffer:model},defaultVoiceId:'freya',
      }) as TtsEngine;
    }catch(error){
      throw new Error('MediaPipe could not initialize the speech model: '+(error instanceof Error?error.message:String(error)));
    }
  })().catch(error=>{cachedEngine=null;throw error;});
  return cachedEngine;
}

const musicNotes=[
  [130.81,155.56,196.0], // C minor, an original 4-bar ambient progression
  [103.83,130.81,155.56],
  [155.56,196.0,233.08],
  [116.54,146.83,174.61],
];

function buildOriginalMusic(ctx:OfflineAudioContext,musicLevel:number):void {
  const master=ctx.createGain();master.gain.value=musicLevel;
  master.connect(ctx.destination);
  const beats=[0,3.75,7.5,11.25];
  for(let bar=0;bar<beats.length;bar++){
    for(let pitch=0;pitch<3;pitch++){
      const start=beats[bar];
      const oscillator=ctx.createOscillator();
      oscillator.type=pitch===0?'sine':'triangle';
      oscillator.frequency.value=musicNotes[bar][pitch];
      const envelope=ctx.createGain();
      envelope.gain.setValueAtTime(.0001,start);
      envelope.gain.exponentialRampToValueAtTime(pitch===0?.45:.20,start+.28);
      envelope.gain.setValueAtTime(pitch===0?.45:.20,start+2.6);
      envelope.gain.exponentialRampToValueAtTime(.0001,Math.min(VIDEO_SECONDS,start+3.74));
      oscillator.connect(envelope).connect(master);
      oscillator.start(start);oscillator.stop(Math.min(VIDEO_SECONDS,start+3.75));
    }
  }
  // Soft percussive tick, entirely generated in Web Audio, not a sampled song.
  for(let beat=0;beat<VIDEO_SECONDS;beat+=.75){
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type='sine';osc.frequency.setValueAtTime(880,beat);
    osc.frequency.exponentialRampToValueAtTime(320,beat+.075);
    gain.gain.setValueAtTime(.0001,beat);
    gain.gain.exponentialRampToValueAtTime(.10,beat+.006);
    gain.gain.exponentialRampToValueAtTime(.0001,Math.min(VIDEO_SECONDS,beat+.12));
    osc.connect(gain).connect(master);osc.start(beat);osc.stop(Math.min(VIDEO_SECONDS,beat+.13));
  }
}

export async function generateVideoSoundtrack(
  project:VideoProject,voice:VoiceOption,musicLevel:number,onProgress:(stage:string,progress:number)=>void,localModel?:File|null,
):Promise<SoundtrackResult>{
  if(typeof OfflineAudioContext==='undefined')throw new Error('Your browser does not support offline audio mixing. Use a current Edge or Chrome browser.');
  onProgress('Preparing local speech synthesis…',3);
  const tts=await loadEngine(onProgress,localModel);
  const context=new OfflineAudioContext(2,48000*VIDEO_SECONDS,48000);
  buildOriginalMusic(context,musicLevel);
  const voices=ctxVoiceGain(context);
  const updatedScenes=project.scenes.map(scene=>({...scene}));
  const adjustments:NarrationAdjustment[]=[];
  for(let index=0;index<updatedScenes.length;index++){
    const scene=updatedScenes[index];
    onProgress('Generating narration for scene '+(index+1)+' of '+updatedScenes.length+'…',8+index*75/updatedScenes.length);
    const fitted=await fitSpokenScene(
      scene,
      text=>tts.synthesize(text,{voiceId:voice}),
      message=>onProgress('Scene '+(index+1)+': '+message,8+(index+.5)*75/updatedScenes.length),
    );
    if(fitted.text!==scene.subtitle.trim()){
      adjustments.push({sceneId:scene.id,from:scene.subtitle,to:fitted.text});
      scene.subtitle=fitted.text;
    }
    if(!fitted.audio)continue;
    const {samples,sampleRateHz}=fitted.audio;
    const clip=context.createBuffer(1,samples.length,sampleRateHz);
    clip.copyToChannel(new Float32Array(samples),0);
    const node=context.createBufferSource();
    node.buffer=clip;
    node.playbackRate.value=fitted.playbackRate;
    const level=context.createGain();level.gain.value=.84;
    node.connect(level).connect(voices);
    node.start(scene.start+.12);
  }
  onProgress('Mixing narration with original background music…',90);
  const rendered=await context.startRendering();
  if(Math.abs(rendered.duration-VIDEO_SECONDS)>.02)throw new Error('The mixed audio duration is not 15 seconds');
  onProgress('Narration and music are ready to preview and export.',100);
  return {audio:rendered,project:{...project,scenes:updatedScenes},adjustments};
}
function ctxVoiceGain(context:OfflineAudioContext):DynamicsCompressorNode {
  const compressor=context.createDynamicsCompressor();
  compressor.threshold.value=-14;compressor.knee.value=12;compressor.ratio.value=2.5;
  compressor.attack.value=.006;compressor.release.value=.24;
  compressor.connect(context.destination);
  return compressor;
}

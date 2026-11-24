import { VIDEO_SECONDS, type VideoProject } from './videoStudioEngine';

/**
 * Zero paid APIs. MediaPipe Phonon speech runs locally using a small model
 * downloaded from Hugging Face on first use. Voice and original music are mixed
 * into exactly 15 seconds by OfflineAudioContext and muxed into the exported MP4.
 */
export type VoiceOption='freya'|'claire'|'sofia'|'lukas'|'lucas';
type RawSpeech={samples:Float32Array; sampleRateHz:number};
type TtsEngine={synthesize:(text:string,options?:{voiceId?:string})=>Promise<RawSpeech>};
let cachedEngine:Promise<TtsEngine>|null=null;
// Stable public Apache-2.0 English Phonon 31M model, ~87 MB, downloaded
// on demand. No onnxruntime-node binaries or server installation required.
const MODEL_URL='https://huggingface.co/litert-community/phonon-31m-en/resolve/main/phonon_int8.litertlm';
const loadEngine=()=>{
  if(!cachedEngine){
    cachedEngine=import('@mediapipe/tasks-audio').then(async ({FilesetResolver,TextToSpeech})=>{
      const fileset=await FilesetResolver.forAudioTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.2.3/wasm');
      return await TextToSpeech.createFromOptions(fileset,{
        baseOptions:{modelAssetPath:MODEL_URL},defaultVoiceId:'freya',
      }) as TtsEngine;
    }).catch(error=>{cachedEngine=null;throw error;});
  }
  return cachedEngine;
};

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
      envelope.gain.exponentialRampToValueAtTime(pitch===0?.15:.055,start+.28);
      envelope.gain.setValueAtTime(pitch===0?.15:.055,start+2.6);
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
    gain.gain.exponentialRampToValueAtTime(.032,beat+.006);
    gain.gain.exponentialRampToValueAtTime(.0001,Math.min(VIDEO_SECONDS,beat+.12));
    osc.connect(gain).connect(master);osc.start(beat);osc.stop(Math.min(VIDEO_SECONDS,beat+.13));
  }
}

export async function generateVideoSoundtrack(
  project:VideoProject,voice:VoiceOption,musicLevel:number,onProgress:(stage:string,progress:number)=>void,
):Promise<AudioBuffer>{
  if(typeof OfflineAudioContext==='undefined')throw new Error('Your browser does not support offline audio mixing. Use a current Edge or Chrome browser.');
  onProgress('Loading local MediaPipe narration model (first use downloads ~87 MB)…',3);
  const tts=await loadEngine();
  const context=new OfflineAudioContext(2,48000*VIDEO_SECONDS,48000);
  buildOriginalMusic(context,musicLevel);
  const voices=ctxVoiceGain(context);
  let index=0;
  for(const scene of project.scenes){
    onProgress('Generating spoken narration for scene '+(index+1)+' of '+project.scenes.length+'…',8+index*75/project.scenes.length);
    const text=scene.subtitle.trim();
    if(!text){index++;continue;}
    const generated=await tts.synthesize(text,{voiceId:voice});
    const samples=generated.samples,rate=generated.sampleRateHz;
    if(!samples||!samples.length||!Number.isFinite(rate)||rate<8000)throw new Error('Narration model returned invalid audio for scene '+(index+1));
    const clip=context.createBuffer(1,samples.length,rate);
    clip.copyToChannel(new Float32Array(samples),0);
    const start=scene.start+.12,available=scene.end-start-.1;
    const speed=Math.max(1,clip.duration/available);
    // A 15-second video requires concise speech. Never silently cut dialogue.
    if(speed>1.55){
      throw new Error('Scene '+(index+1)+' narration is too long ('+clip.duration.toFixed(1)+' seconds for '+available.toFixed(1)+' seconds). Shorten this scene subtitle and generate again.');
    }
    const node=context.createBufferSource();
    node.buffer=clip;node.playbackRate.value=speed;
    const level=context.createGain();level.gain.value=.84;
    node.connect(level).connect(voices);
    node.start(start);
    index++;
  }
  onProgress('Mixing spoken narration with original background music…',90);
  const rendered=await context.startRendering();
  if(Math.abs(rendered.duration-VIDEO_SECONDS)>.02)throw new Error('The mixed audio duration is not 15 seconds');
  onProgress('Narration and music are ready to preview and export.',100);
  return rendered;
}
function ctxVoiceGain(context:OfflineAudioContext):DynamicsCompressorNode {
  const compressor=context.createDynamicsCompressor();
  compressor.threshold.value=-14;compressor.knee.value=12;compressor.ratio.value=2.5;
  compressor.attack.value=.006;compressor.release.value=.24;
  compressor.connect(context.destination);
  return compressor;
}

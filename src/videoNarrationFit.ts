/**
 * Deterministic, tested duration fitting for locally synthesized narration.
 * Never truncate recorded speech or leave subtitles out of sync with MP4 audio.
 * Visual explanations, repository names and full URLs stay unchanged.
 */
export type SpeechClip = {samples: Float32Array; sampleRateHz: number};
export type TimedSubtitle = {id:string; start:number; end:number; subtitle:string};
export type FittedNarration = {
  text:string;
  audio:SpeechClip|null;
  playbackRate:number;
  originalText:string;
  attempts:number;
  omitted:boolean;
};
export const MAX_NARRATION_SPEED=1.42;
const SCENE_PADDING_SECONDS=.22;

/** Strip only quiet leading/trailing padding from model audio, keeping 70ms margins. */
export function trimSilence(audio:SpeechClip):SpeechClip{
  const samples=audio.samples,rate=audio.sampleRateHz;
  if(!(samples instanceof Float32Array)||!samples.length||!Number.isFinite(rate)||rate<8000)
    throw new Error('Narration model returned invalid audio.');
  let peak=0;
  for(let i=0;i<samples.length;i++)peak=Math.max(peak,Math.abs(samples[i]));
  if(peak<0.001)throw new Error('Narration model produced silent audio. Try another voice.');
  const threshold=Math.max(.0015,peak*.018);
  let first=0,last=samples.length-1;
  while(first<samples.length&&Math.abs(samples[first])<threshold)first++;
  while(last>first&&Math.abs(samples[last])<threshold)last--;
  const margin=Math.round(rate*.07);
  const begin=Math.max(0,first-margin),end=Math.min(samples.length,last+margin+1);
  if((end-begin)/rate<.08)throw new Error('Narration model produced no usable speech.');
  return {samples:samples.subarray(begin,end),sampleRateHz:rate};
}

/** Shorten spoken text conservatively; leave visual details unchanged. */
export function shortenSpokenText(text:string,ratio=.8):string{
  const current=text.trim();
  if(!current)return '';
  const tidy=current.replace(/[.!?]+\s*$/,'').trim();
  // Remove filler introductions before losing unique repository details.
  const rules=[
    /^project details[.!?:;,\s-]+/i,
    /^introducing\s+/i,
    /^discover\s+/i,
    /^here (?:is|are)\s+/i,
    /^learn (?:about|more about)\s+/i,
  ];
  for(const rule of rules){
    const stripped=tidy.replace(rule,'').trim();
    if(stripped&&stripped!==tidy)return stripped.replace(/[.!?]+$/,'')+'.';
  }
  const patterns=[
    [/\bthe full repository on GitHub\b/gi,'on GitHub'],
    [/\bopen source (?:GitHub )?repository\b/gi,'project'],
    [/\bGitHub repository\b/gi,'project'],
  ] as const;
  for(const [pattern,replacement] of patterns){
    const changed=tidy.replace(pattern,replacement).trim();
    if(changed.length<tidy.length)return changed.replace(/[.!?]+$/,'')+'.';
  }
  const words=tidy.split(/\s+/).filter(Boolean);
  if(words.length<=1)return current;
  // Drop whole trailing words. Always shorten, even when TTS takes unexpectedly
  // long for a short phrase, without inventing any claims or adding new facts.
  const keep=Math.max(1,Math.min(words.length-1,Math.floor(words.length*Math.max(.30,Math.min(.76,ratio*.82)))));
  const shortened=words.slice(0,keep).join(' ').replace(/[.,;:!\s]+$/,'');
  return shortened+'.';
}

/**
 * Generate each phrase with actual model measurements; retry with shorter text
 * if it cannot fit the scene without unnatural playback speed.
 * A sub-1.3s bumper may remain instrumental rather than speak at high speed.
 */
export async function fitSpokenScene(
  scene:TimedSubtitle,
  synthesize:(text:string)=>Promise<SpeechClip>,
  onRetry?:(message:string)=>void,
):Promise<FittedNarration>{
  const originalText=scene.subtitle.trim();
  if(!originalText)return {text:'',audio:null,playbackRate:1,originalText,attempts:0,omitted:false};
  const available=scene.end-scene.start-SCENE_PADDING_SECONDS;
  if(available<=0)throw new Error('Invalid scene timing for '+scene.id);
  let text=originalText;
  const seen=new Set<string>();
  let attempts=0;
  let lastDuration=0;
  for(;attempts<7;attempts++){
    if(seen.has(text))break;
    seen.add(text);
    const audio=trimSilence(await synthesize(text));
    const duration=audio.samples.length/audio.sampleRateHz;
    lastDuration=duration;
    const speed=Math.max(1,duration/available);
    if(speed<=MAX_NARRATION_SPEED+0.0001)
      return {text,audio,playbackRate:speed,originalText,attempts:attempts+1,omitted:false};
    const shortened=shortenSpokenText(text,available*MAX_NARRATION_SPEED/duration);
    if(shortened===text)break;
    onRetry?.('Spoken line needs '+duration.toFixed(1)+'s but scene allows '+available.toFixed(1)+'s. Trying: '+shortened);
    text=shortened;
  }
  // An instrumental final bumper is preferable to 2x speech or a hidden
  // truncated syllable. On-screen project details and full URL still render.
  if(scene.end-scene.start<=1.25)
    return {text:'',audio:null,playbackRate:1,originalText,attempts,omitted:true};
  throw new Error('Scene '+scene.id+' could not fit spoken narration after automatic shortening (last attempt '+lastDuration.toFixed(1)+'s for '+available.toFixed(1)+'s). Edit that scene to a shorter phrase and try again.');
}

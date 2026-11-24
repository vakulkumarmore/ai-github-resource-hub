import test from 'node:test';
import assert from 'node:assert/strict';
import {fitSpokenScene,trimSilence,shortenSpokenText,MAX_NARRATION_SPEED} from '../src/videoNarrationFit.ts';
import {makeIndividualVideo,makeRoundupVideo,videoSignature,videoSrt} from '../src/videoStudioEngine.ts';

const makeClip=(seconds,rate=8000)=>{
  const samples=new Float32Array(Math.ceil(seconds*rate));samples.fill(.25);
  return {samples,sampleRateHz:rate};
};
const repo=(name,url)=>({
  id:name,name,url,type:'repository',category:'AI Agents',
  description:'A repository with many useful public developer tools and examples.',
  oneLiner:'An automation toolkit.',language:'TypeScript',tags:[],
});

test('trims quiet model padding while preserving a margin around spoken sound',()=>{
  const rate=8000,samples=new Float32Array(rate*4);
  samples.fill(.23,rate,rate*3);
  const trimmed=trimSilence({samples,sampleRateHz:rate});
  assert.ok(trimmed.samples.length/rate>2.0);
  assert.ok(trimmed.samples.length/rate<2.3);
  assert.equal(trimmed.samples[0],0);
  assert.ok(trimmed.samples.some(value=>value>.2));
});
test('rejects no-audio output from the speech model',()=>{
  assert.throws(()=>trimSilence({samples:new Float32Array(8000),sampleRateHz:8000}),/silent audio/);
});
test('scene 3 auto-fits 6.2-second speech into 3.8 seconds without truncating words',async()=>{
  const scene={id:'facts',start:8,end:12,subtitle:'Project details. AI Agents. TypeScript.'};
  const spoken=[];
  const fitted=await fitSpokenScene(scene,async text=>{
    spoken.push(text);
    const duration= text===scene.subtitle ? 6.2 : Math.max(.6,text.split(/\s+/).length*1.05+.25);
    return makeClip(duration);
  });
  assert.equal(spoken[0],scene.subtitle);
  assert.ok(spoken.length>1,'Narration should re-synthesize shortened text');
  assert.notEqual(fitted.text,scene.subtitle);
  assert.ok(fitted.audio);
  assert.ok(fitted.playbackRate<=MAX_NARRATION_SPEED);
  assert.ok(fitted.audio.samples.length/fitted.audio.sampleRateHz/fitted.playbackRate<=3.78+.001);
  assert.equal(fitted.omitted,false);
});
test('roundup 1-second final bumper stays instrumental rather than speak at excessive speed',async()=>{
  const fitted=await fitSpokenScene({id:'outro',start:14,end:15,subtitle:'Explore more.'},async()=>makeClip(2.1));
  assert.equal(fitted.text,'');
  assert.equal(fitted.audio,null);
  assert.equal(fitted.omitted,true);
});
test('fitted subtitles update both canvas and SRT only after re-approval',async()=>{
  const base=makeIndividualVideo(repo('My Project','https://github.com/example/project'));
  const original=videoSignature(base);
  const changes=[];
  const updatedScenes=[];
  for(const scene of base.scenes){
    const fitted=await fitSpokenScene(scene,async text=>makeClip(text.split(/\s+/).length*.73+.7));
    updatedScenes.push({...scene,subtitle:fitted.text});
    if(fitted.text!==scene.subtitle)changes.push(scene.id);
  }
  const updated={...base,scenes:updatedScenes};
  assert.ok(changes.length>0);
  assert.notEqual(videoSignature(updated),original,'old approval must be invalidated');
  for(const s of updatedScenes)assert.ok(videoSrt(updated).includes(s.subtitle)||s.subtitle==='');
  assert.equal(updated.scenes[2].url,base.scenes[2].url);
  assert.equal(updated.scenes[2].extra,base.scenes[2].extra);
});
test('roundup narration can fit short pick intros and preserve all three project URLs',async()=>{
  const p=makeRoundupVideo([
    repo('First','https://github.com/example/one'),
    repo('Second','https://github.com/example/two'),
    repo('Third','https://github.com/example/three')
  ]);
  const fitted=[];
  for(const scene of p.scenes){
    fitted.push(await fitSpokenScene(scene,async text=>makeClip(text.split(/\s+/).length*.72+.55)));
  }
  assert.equal(fitted.length,5);
  assert.ok(fitted.slice(1,4).every(x=>x.audio));
  assert.ok(fitted.every(x=>x.playbackRate<=MAX_NARRATION_SPEED));
  assert.equal(new Set(p.scenes.slice(1,4).map(s=>s.url)).size,3);
});

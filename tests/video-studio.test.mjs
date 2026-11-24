import test from 'node:test';
import assert from 'node:assert/strict';
import {autoPickRoundup,drawVideoFrame,makeIndividualVideo,makeRoundupVideo,videoSignature,videoSrt,VIDEO_SECONDS,VIDEO_FPS,VIDEO_WIDTH,VIDEO_HEIGHT} from '../src/videoStudioEngine.ts';

const r=(name,url)=>({id:name,name,url,category:'AI Agents',description:name+' description from repository',oneLiner:name+' helps automate common development tasks.',tags:[],language:'TypeScript',stars:1200,type:'repository'});
const a=r('Project One','https://github.com/example/one');
const b=r('Project Two','https://github.com/example/two');
const c=r('Project Three','https://github.com/example/three');

const verify=(project,count)=>{
  assert.equal(project.scenes.length,count);
  assert.equal(project.scenes[0].start,0);
  assert.equal(project.scenes.at(-1).end,VIDEO_SECONDS);
  for(let i=0;i<project.scenes.length;i++){
    const scene=project.scenes[i];
    assert.ok(scene.heading.length>0);
    assert.ok(scene.subtitle.length>0);
    assert.ok(scene.end>scene.start);
    if(i>0)assert.equal(scene.start,project.scenes[i-1].end);
  }
  const cues=videoSrt(project);
  assert.equal(cues.split(' --> ').length-1,count);
  assert.ok(cues.includes('00:00:15,000'));
};
test('individual spotlight uses factual published resource metadata in exactly 15 seconds',()=>{
  const p=makeIndividualVideo(a);
  assert.equal(p.mode,'individual');
  assert.deepEqual(p.selectedUrls,[a.url]);
  assert.ok(p.scenes[1].subtitle.startsWith('Project One helps automate'));
  assert.equal(p.scenes[1].extra,a.description);
  assert.ok(p.scenes.every(s=>s.url===a.url),'complete GitHub URL appears in every scene');
  assert.ok(p.scenes.every(s=>s.subtitle.split(/\s+/).length<=12),'voice lines remain brief');
  assert.ok(p.scenes[2].detail.includes('1,200 stars'));
  verify(p,4);
});
test('roundup uses three repositories and bounded 15-second scenes',()=>{
  const p=makeRoundupVideo([a,b,c]);
  assert.equal(p.mode,'roundup');
  assert.deepEqual(p.selectedUrls,[a.url,b.url,c.url]);
  assert.equal(p.scenes[1].heading,'Project One');
  assert.equal(p.scenes[2].heading,'Project Two');
  assert.equal(p.scenes[3].heading,'Project Three');
  assert.deepEqual(p.scenes.slice(1,4).map(s=>s.url),[a.url,b.url,c.url]);
  assert.ok(p.scenes.slice(1,4).every(s=>s.extra.includes('description')));
  verify(p,5);
});
test('editing subtitles invalidates exact-content approval signature',()=>{
  const p=makeIndividualVideo(a);
  const approved=videoSignature(p);
  const changed={...p,scenes:p.scenes.map((s,i)=>i===1?{...s,subtitle:'New subtitle needs approval'}:s)};
  assert.notEqual(videoSignature(changed),approved);
  assert.ok(videoSrt(changed).includes('New subtitle needs approval'));
});
test('encoding defaults are predictable',()=>{
  assert.equal(VIDEO_SECONDS,15);
  assert.equal(VIDEO_FPS,24);
  assert.equal(VIDEO_WIDTH,540);
  assert.equal(VIDEO_HEIGHT,960);
});

test('daily roundup picks three distinct published repos and stays deterministic for a date',()=>{
  const entries=[{...a,updatedAt:'2026-11-23T12:00:00Z'},{...b,updatedAt:'2026-11-22T12:00:00Z'},{...c,updatedAt:'2026-11-21T12:00:00Z'}];
  const picked=autoPickRoundup(entries,'2026-11-24');
  assert.ok(picked);
  assert.equal(new Set(picked.map(r=>r.url)).size,3);
  assert.deepEqual(autoPickRoundup(entries,'2026-11-24')?.map(r=>r.url),picked.map(r=>r.url));
  assert.equal(autoPickRoundup(entries.slice(0,2),'2026-11-24'),null);
});

test('video frame renders the entire GitHub URL and expanded project details',()=>{
  const sample={...a,url:'https://github.com/example/a-very-long-repository-path-for-open-source-developers-and-teams',description:'A reference catalog with detailed code examples and documentation.'};
  const project=makeIndividualVideo(sample);
  const textCalls=[];
  const ctx={
    createLinearGradient:()=>({addColorStop(){}}),
    save(){},restore(){},fillRect(){},beginPath(){},arc(){},fill(){},strokeRect(){},roundRect(){},
    measureText:(text)=>({width:text.length*9}),
    fillText:(text)=>{textCalls.push(text)},
  };
  drawVideoFrame({width:540,height:960,getContext:()=>ctx},project,5);
  const output=textCalls.join(' ');
  assert.ok(output.includes(sample.description),'extended description must be visible');
  assert.ok(textCalls.join('').includes(sample.url),'full URL must not be omitted or converted to just owner/repo');
});
test('scene subtitles and visible extended description are separate and editable',()=>{
  const p=makeIndividualVideo(a);
  assert.ok(p.scenes.every(s=>s.extra&&s.url));
  const changed={...p,scenes:p.scenes.map((s,i)=>i===1?{...s,extra:'A more complete factual description to display'}:s)};
  assert.notEqual(videoSignature(changed),videoSignature(p));
  assert.equal(videoSrt(p).includes(p.scenes[1].subtitle),true);
});

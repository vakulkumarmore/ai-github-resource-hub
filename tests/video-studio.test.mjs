import test from 'node:test';
import assert from 'node:assert/strict';
import {makeIndividualVideo,makeRoundupVideo,videoSignature,videoSrt,VIDEO_SECONDS,VIDEO_FPS,VIDEO_WIDTH,VIDEO_HEIGHT} from '../src/videoStudioEngine.ts';

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
  assert.equal(p.scenes[1].subtitle,a.oneLiner);
  assert.ok(p.scenes[2].subtitle.includes('1,200 GitHub stars'));
  verify(p,4);
});
test('roundup uses three repositories and bounded 15-second scenes',()=>{
  const p=makeRoundupVideo([a,b,c]);
  assert.equal(p.mode,'roundup');
  assert.deepEqual(p.selectedUrls,[a.url,b.url,c.url]);
  assert.equal(p.scenes[1].heading,'Project One');
  assert.equal(p.scenes[2].heading,'Project Two');
  assert.equal(p.scenes[3].heading,'Project Three');
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

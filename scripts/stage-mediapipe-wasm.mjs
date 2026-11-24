#!/usr/bin/env node
// Copy MediaPipe's browser WASM runtime into this Worker's own static assets.
// This removes the need for a third-party CDN at video creation time.
import {readdir,copyFile,mkdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const source=resolve('node_modules/@mediapipe/tasks-audio/wasm');
const target=resolve('dist/mediapipe-wasm');
const MAX_ASSET=25*1024*1024; // Cloudflare Workers individual static-asset limit
await mkdir(target,{recursive:true});
const all=await readdir(source,{withFileTypes:true});
const files=all.filter(f=>f.isFile()&&/^audio_wasm.*\.(?:wasm|js|mjs)$/.test(f.name));
if(!files.some(f=>f.name==='audio_wasm_internal.js')||!files.some(f=>f.name==='audio_wasm_internal.wasm')){
  throw new Error('MediaPipe audio WASM package changed. Expected audio_wasm_internal.js/.wasm.');
}
for(const f of files){
  const path=join(source,f.name);
  const size=(await stat(path)).size;
  if(size>MAX_ASSET)throw new Error(f.name+' exceeds Cloudflare 25 MiB static file limit ('+size+' bytes).');
  await copyFile(path,join(target,f.name));
  process.stdout.write('Local MediaPipe asset: '+f.name+' ('+size+' bytes)\n');
}
if(files.length<2)throw new Error('Missing MediaPipe runtime files');

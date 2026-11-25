import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const admin=readFileSync(new URL('../src/Admin.tsx',import.meta.url),'utf8');
const discoveries=readFileSync(new URL('../src/DailyDiscoveries.tsx',import.meta.url),'utf8');
const worker=readFileSync(new URL('../worker/index.js',import.meta.url),'utf8');
const report=JSON.parse(readFileSync(new URL('../src/daily-discoveries.json',import.meta.url),'utf8'));

test('Admin opens directly to the review queue and distinguishes staging from suggestions',()=>{
  assert.match(admin,/useState<AdminTab>\('discover'\)/);
  assert.match(admin,/New for review/);
  assert.match(admin,/onCountChange=\{setReviewCount\}/);
  assert.match(admin,/New repository approval/);
  assert.match(admin,/Check selected on GitHub/);
  assert.match(admin,/Approve checked/);
});

test('Review queue refreshes the daily report without a Vite rebuild and shows 10 at a time',()=>{
  assert.match(worker,/path==='\/api\/discoveries'&&req\.method==='GET'/);
  assert.match(discoveries,/fetch\('\/api\/discoveries'/);
  assert.match(discoveries,/apiJson<Report>/);
  assert.match(discoveries,/const visible = filtered\.slice\(0,showAll\?80:10\)/);
  assert.match(discoveries,/Restore \{hiddenDismissed\} dismissed/);
  assert.match(discoveries,/onStage\(selectedItems\.map\(toResource\)\)/);
});

test('Seeded discovery report contains genuine review-only candidates',()=>{
  assert.ok(report.candidates.length>0);
  assert.ok(report.generatedAt);
  assert.equal(report.queriesSucceeded,10);
  assert.equal(report.partial,false);
});

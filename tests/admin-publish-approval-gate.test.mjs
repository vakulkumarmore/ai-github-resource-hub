import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const admin=readFileSync(new URL('../src/Admin.tsx',import.meta.url),'utf8');

test('pending approval never makes Save a dead disabled control',()=>{
  assert.match(admin,/const canOpenSave = dirty && !busy && !checkingNew;/);
  assert.equal((admin.match(/disabled=\{!canOpenSave\}/g)||[]).length,2,'Both Save buttons should remain clickable while review is pending');
  assert.doesNotMatch(admin,/disabled=\{[^}]*pendingCount > 0[^}]*\}/);
  assert.match(admin,/saveLabel = pendingCount > 0/);
  assert.match(admin,/Review \$\{pendingCount\} pending before saving/);
});

test('clicking Save with unapproved additions navigates to the approval queue, not GitHub publishing',()=>{
  assert.match(admin,/const publish = async \(\) => \{/);
  assert.match(admin,/if \(pendingCount\) \{\s*openPendingApprovals\(\);\s*return;\s*\}/);
  assert.match(admin,/const openPendingApprovals = \(\) => \{/);
  assert.match(admin,/setTab\('resources'\); setView\('new'\); setPage\(1\); setQuery\(''\)/);
  assert.match(admin,/className="publish-blocker"/);
  assert.match(admin,/Save requires approval/);
});

test('approval remains mandatory and verification still precedes publishing',()=>{
  assert.match(admin,/1\. Select pending \(\{pendingCount\}\)/);
  assert.match(admin,/Check selected on GitHub/);
  assert.match(admin,/Approve checked/);
  assert.match(admin,/setApprovedKeys\(old => \[\.\.\.new Set\(\[\.\.\.old, \.\.\.toApprove\]\)\]\)/);
  assert.match(admin,/if \(!window\.confirm\(`Publish \$\{draft\.length\}/);
  assert.match(admin,/method: 'PUT'.*JSON\.stringify\(draft\)/);
});

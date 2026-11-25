import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

test('the public page flows from browsing to use cases and guide before all repositories', () => {
  const sections = [
    'id="browse-directory"',
    '<NeedDiscovery resources={catalog}',
    'Find a useful project in three steps',
    'id="browse" aria-labelledby="repository-list-title"',
    'id="repository-list-title">All repositories',
    'className="advanced-filters"',
    'className={`resource-results',
  ];
  const positions = sections.map(section => app.indexOf(section));
  assert.ok(positions.every(pos => pos >= 0), 'Each requested section must remain in the public page');
  assert.ok(positions.every((pos, i) => i === 0 || pos > positions[i - 1]), 'Sections must be presented in the requested order');
});

test('directory tabs, repository filters and pagination remain connected', () => {
  assert.match(app, /DIRECTORY_COLLECTIONS\.map\(item =>/);
  assert.match(app, /chooseCollection\(item\.id\)/);
  assert.match(app, /document\.getElementById\('browse'\)/);
  for (const label of ['Filter by category', 'Last GitHub activity', 'Archive status', 'All languages', 'Sort by', 'Clear filters', 'List view', 'Grid view', 'Per page']) {
    assert.ok(app.includes(label), `Expected filter or browsing option: ${label}`);
  }
  assert.match(app, /visible\.map\(r => <ResourceItem/);
});

test('the guide is visible initially in the revised layout and can still be dismissed', () => {
  assert.match(app, /ai-hub-guide-dismissed-directory-v2/);
  assert.match(app, /showGuide && <section className="visitor-guide"/);
  assert.match(app, /onClick=\{dismissGuide\}/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

test('directory tabs, search and filters appear together before use cases, guide and repository listings', () => {
  const sections = [
    'id="browse-directory"',
    'className="directory-collection-tabs"',
    'className="directory-filter-panel"',
    'className="search-toolbar"',
    'className="advanced-filters"',
    '<NeedDiscovery resources={catalog}',
    'Find a useful project in three steps',
    'id="browse" aria-labelledby="repository-list-title"',
    'id="repository-list-title">All repositories',
    'className={`resource-results',
  ];
  const positions = sections.map(section => app.indexOf(section));
  assert.ok(positions.every(pos => pos >= 0), 'Every page section is present');
  assert.ok(positions.every((pos, i) => i === 0 || pos > positions[i - 1]), 'Filters must be in the browsing section, before the guide and repository results');
});

test('directory collection tabs and filters still target the displayed repository list', () => {
  assert.match(app, /DIRECTORY_COLLECTIONS\.map\(item =>/);
  assert.match(app, /chooseCollection\(item\.id\)/);
  assert.match(app, /document\.getElementById\('browse'\)/);
  for (const label of ['Filter by category', 'Last GitHub activity', 'Archive status', 'All languages', 'Sort by', 'Clear filters', 'List view', 'Grid view']) {
    assert.ok(app.includes(label), `Expected filter or view option: ${label}`);
  }
  assert.match(app, /visible\.map\(r => <ResourceItem/);
  assert.match(app, /directory-filter-footer/);
  assert.match(app, /View matching repositories/);
});

test('repository list always displays at most 10 entries per page', () => {
  assert.match(app, /const PAGE_SIZE = 10;/);
  assert.match(app, /Math\.ceil\(filtered\.length \/ PAGE_SIZE\)/);
  assert.match(app, /filtered\.slice\(\(currentPage - 1\) \* PAGE_SIZE, currentPage \* PAGE_SIZE\)/);
  assert.match(app, /10 per page/);
  assert.doesNotMatch(app, /setPageSize|DEFAULT_PAGE_SIZE|ai-hub-page-size/);
});

test('the three-step guide is visible initially and can still be dismissed', () => {
  assert.match(app, /ai-hub-guide-dismissed-directory-v2/);
  assert.match(app, /showGuide && <section className="visitor-guide"/);
  assert.match(app, /onClick=\{dismissGuide\}/);
});

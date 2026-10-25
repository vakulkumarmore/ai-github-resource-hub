import importlib.util
from datetime import datetime, timezone, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock
import json
import os
import sys
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'refresh_repo_health.py'
spec = importlib.util.spec_from_file_location('health_refresh', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RefreshTests(unittest.TestCase):
    def test_url_validation(self):
        self.assertEqual(module.parse_github('https://github.com/owner/repo'), ('owner', 'repo'))
        self.assertEqual(module.parse_github('https://github.com/owner'), ('owner', None))
        self.assertIsNone(module.parse_github('https://github.com/owner/repo/issues'))
        self.assertIsNone(module.parse_github('https://evil.example/owner/repo'))

    def test_maintenance_signals(self):
        now = datetime(2026, 10, 25, tzinfo=timezone.utc)
        repo = {'isArchived': True, 'isDisabled': False,
                'pushedAt': (now-timedelta(days=390)).isoformat(),
                'issues': {'totalCount': 150}}
        flags, days = module.maintenance_signals(repo, now, 1)
        self.assertEqual(days, 390)
        self.assertEqual(set(flags), {'archived', 'stale_365d', 'many_open_issues', 'published_advisories'})
        flags, _ = module.maintenance_signals({**repo, 'pushedAt': None}, now)
        self.assertNotIn('stale_365d', flags)

    def test_graphql_query_uses_aliases(self):
        query = module.query_for_batch([('x','y',{}),('a','b',{})])
        self.assertIn('r0: repository(owner: "x", name: "y")', query)
        self.assertIn('r1: repository(owner: "a", name: "b")', query)
        self.assertIn('issues(states:OPEN, first:1)', query)

    def test_does_not_remove_items_or_overwrite_editorial_text(self):
        with TemporaryDirectory() as directory:
            cat = Path(directory) / 'resources.json'
            health = Path(directory) / 'repo-health.json'
            old_date = '2024-01-01T00:00:00Z'
            original = [
                {'id':'a-b', 'name':'Custom name', 'url':'https://github.com/a/b',
                 'category':'My favorite', 'description':'Written by me', 'oneLiner':'Curated summary',
                 'tags':['my tag'], 'hashtags':['#Manual'], 'imageUrl':'https://example.org/my-logo.svg'},
                {'id':'missing-x', 'name':'Missing', 'url':'https://github.com/missing/x',
                 'category':'Uncategorized','description':'My notes', 'tags':[]},
                {'id':'profile', 'name':'Profile', 'url':'https://github.com/a',
                 'category':'People','description':'Important developer', 'tags':[]},
            ]
            cat.write_text(json.dumps(original), encoding='utf8')
            def fake_api(path, token, payload=None):
                self.assertEqual(path, '/graphql')
                return 200, {'data': {
                    'r0': {'stargazerCount':1000,'forkCount':75,'pushedAt':old_date,
                           'updatedAt':'2026-09-03T00:00:00Z', 'isArchived':False,
                           'isDisabled':False,'primaryLanguage':{'name':'Python'},
                           'licenseInfo':{'spdxId':'MIT'},'issues':{'totalCount':6},
                           'pullRequests':{'totalCount':1}},
                    'r1': None,
                }}
            with mock.patch.object(module, 'CATALOG', cat), mock.patch.object(module, 'REPORT', health), \
                 mock.patch.object(module, 'api_call', side_effect=fake_api), \
                 mock.patch.dict(os.environ, {'GH_TOKEN': 'fake'}), \
                 mock.patch.object(sys, 'argv', ['refresh_repo_health.py', '--no-advisories']):
                self.assertEqual(module.main(), 0)
            after = json.loads(cat.read_text(encoding='utf8'))
            self.assertEqual(len(after), 3)
            for field in ['name','category','description','oneLiner','tags','hashtags','imageUrl']:
                self.assertEqual(after[0].get(field), original[0].get(field))
            self.assertEqual(after[0]['stars'], 1000)
            self.assertEqual(after[0]['updatedAt'], old_date)
            self.assertEqual(after[1], original[1])
            report = json.loads(health.read_text())
            self.assertIn('stale_365d', report['entries'][0]['flags'])
            self.assertEqual(report['entries'][1]['status'], 'unavailable')
            self.assertEqual(report['entries'][2]['status'], 'profile_or_unsupported')
            self.assertEqual(report['summary']['total'], 3)

    def test_dry_run_leaves_files_untouched(self):
        with TemporaryDirectory() as directory:
            catalog = Path(directory) / 'resources.json'
            report = Path(directory) / 'repo-health.json'
            catalog.write_text('[]', encoding='utf8')
            with mock.patch.object(module, 'CATALOG', catalog), mock.patch.object(module, 'REPORT', report), \
                 mock.patch.dict(os.environ, {'GH_TOKEN': 'fake'}), \
                 mock.patch.object(sys, 'argv', ['refresh_repo_health.py','--dry-run']):
                self.assertEqual(module.main(), 0)
            self.assertFalse(report.exists())
            self.assertEqual(catalog.read_text(encoding='utf8'), '[]')

if __name__ == '__main__':
    unittest.main()

class ScaleTests(unittest.TestCase):
    def test_one_thousand_repositories_all_kept(self):
        with TemporaryDirectory() as directory:
            cat = Path(directory) / 'resources.json'
            report = Path(directory) / 'repo-health.json'
            original = [{'id':f'r{i}', 'name':f'r{i}', 'url':f'https://github.com/example/repo{i}',
                         'category':'Custom', 'description':f'Manual {i}', 'tags':[]} for i in range(1000)]
            cat.write_text(json.dumps(original))
            calls = [0]
            def api(path, token, payload=None):
                calls[0] += 1
                query = payload['query']
                # 20 alias results, matching only keys queried.
                count = query.count(': repository(')
                return 200, {'data':{f'r{i}':{'stargazerCount':5,'forkCount':2,
                    'pushedAt':'2026-10-01T00:00:00Z','updatedAt':'2026-10-01T00:00:00Z',
                    'isArchived':False,'isDisabled':False,
                    'issues':{'totalCount':0},'pullRequests':{'totalCount':0},
                    'primaryLanguage':{'name':'Python'},'licenseInfo':{'spdxId':'MIT'}}
                    for i in range(count)}}
            with mock.patch.object(module, 'CATALOG', cat), mock.patch.object(module, 'REPORT', report), \
                 mock.patch.object(module, 'api_call', side_effect=api), \
                 mock.patch.dict(os.environ, {'GH_TOKEN': 'fake'}), \
                 mock.patch.object(sys, 'argv', ['refresh_repo_health.py', '--no-advisories']):
                self.assertEqual(module.main(), 0)
            result = json.loads(cat.read_text())
            self.assertEqual(len(result),1000)
            self.assertEqual([x['description'] for x in result], [x['description'] for x in original])
            self.assertEqual(calls[0], 50)
            report_obj = json.loads(report.read_text())
            self.assertEqual(report_obj['scanned'], 1000)
            self.assertEqual(report_obj['summary']['total'], 1000)

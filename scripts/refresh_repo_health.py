#!/usr/bin/env python3
"""Refresh public GitHub repository metadata and produce a human-review queue.

This job NEVER removes repository entries or rewrites curator-created text.
Only factual GitHub fields (stars, forks, language, license and pushed date)
are updated. A separate report contains maintenance and community signals.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib import error, request

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'src/resources.json'
REPORT = ROOT / 'src/repo-health.json'
GITHUB_API = 'https://api.github.com'
USER_AGENT = 'ai-github-resource-hub-health-check'
# These are candidate-review heuristics, not statements about code safety.
STALE_DAYS = 365
ISSUE_COUNT_REVIEW = 150
GRAPHQL_BATCH = 20
ADVISORIES_PER_DAY = 100  # rotating public-advisory checks; 1000 repos ~10 days


def utcnow():
    return datetime.now(timezone.utc)


def iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def parse_date(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)
    except ValueError:
        return None


def parse_github(url):
    match = re.fullmatch(r'https://github\.com/([\w.-]+)(?:/([\w.-]+))?/?', str(url or ''), flags=re.I)
    if not match:
        return None
    return match.group(1), match.group(2)


def api_call(path, token, payload=None, max_attempts=3):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': USER_AGENT,
               'X-GitHub-Api-Version': '2022-11-28', 'Authorization': f'Bearer {token}'}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    body = None if payload is None else json.dumps(payload).encode('utf-8')
    for attempt in range(max_attempts):
        req = request.Request(GITHUB_API + path, data=body, headers=headers, method='POST' if body else 'GET')
        try:
            with request.urlopen(req, timeout=40) as result:
                return result.status, json.load(result)
        except error.HTTPError as exc:
            # A private, missing, or restricted project may return 404 or 403.
            if exc.code in (403, 404) and path != '/graphql':
                return exc.code, None
            if exc.code in (429, 500, 502, 503, 504) and attempt < max_attempts - 1:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f'GitHub {path}: HTTP {exc.code}') from exc
        except error.URLError as exc:
            if attempt < max_attempts - 1:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f'GitHub request failed: {exc.reason}') from exc
    raise RuntimeError('Request retries exhausted')


def query_for_batch(repos):
    """Twenty named aliases per GraphQL request, far fewer calls than REST per repo."""
    fields = '''nameWithOwner isArchived isDisabled stargazerCount forkCount
    pushedAt updatedAt homepageUrl primaryLanguage { name } licenseInfo { spdxId }
    issues(states:OPEN, first:1) { totalCount }
    pullRequests(states:OPEN, first:1) { totalCount }'''
    parts = []
    for index, (owner, repo, _) in enumerate(repos):
        parts.append(f'r{index}: repository(owner: {json.dumps(owner)}, name: {json.dumps(repo)}) {{ {fields} }}')
    return 'query HubHealth { ' + ' '.join(parts) + ' }'


def maintenance_signals(repo_data, now, security_count=None):
    flags = []
    is_archived = bool(repo_data.get('isArchived'))
    is_disabled = bool(repo_data.get('isDisabled'))
    pushed = repo_data.get('pushedAt')
    pushed_time = parse_date(pushed)
    days_since_push = max(0, (now - pushed_time).days) if pushed_time else None
    if is_archived:
        flags.append('archived')
    if is_disabled:
        flags.append('disabled')
    if days_since_push is not None and days_since_push >= STALE_DAYS:
        flags.append('stale_365d')
    issue_count = (repo_data.get('issues') or {}).get('totalCount')
    if isinstance(issue_count, int) and issue_count >= ISSUE_COUNT_REVIEW:
        flags.append('many_open_issues')
    if security_count is not None and security_count > 0:
        flags.append('published_advisories')
    return flags, days_since_push


def summarize(entries):
    return {
        'total': len(entries),
        'reviewCandidates': sum(bool(e.get('flags')) for e in entries),
        'stale': sum('stale_365d' in e.get('flags', []) for e in entries),
        'archived': sum('archived' in e.get('flags', []) for e in entries),
        'unavailable': sum(e.get('status') == 'unavailable' for e in entries),
        'manyOpenIssues': sum('many_open_issues' in e.get('flags', []) for e in entries),
        'publishedAdvisories': sum('published_advisories' in e.get('flags', []) for e in entries),
    }


def main():
    ap = argparse.ArgumentParser(description='Update factual metadata and generate a non-destructive health review report')
    ap.add_argument('--dry-run', action='store_true', help='print summary without writing files')
    ap.add_argument('--no-advisories', action='store_true', help='skip rotating public advisory lookups')
    ap.add_argument('--advisory-budget', type=int, default=ADVISORIES_PER_DAY)
    args = ap.parse_args()
    token = os.getenv('GH_TOKEN') or os.getenv('GITHUB_TOKEN')
    if not token:
        sys.exit('Error: GH_TOKEN or GITHUB_TOKEN is required.')
    now = utcnow()
    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    if not isinstance(catalog, list):
        sys.exit('Catalog must be a JSON array.')
    previous = {}
    if REPORT.exists():
        try:
            previous = {e['url'].lower().rstrip('/'): e for e in json.loads(REPORT.read_text(encoding='utf-8')).get('entries', [])}
        except (ValueError, KeyError, TypeError):
            pass
    repo_items = []
    entries_by_url = {}
    for r in catalog:
        url = r.get('url', '')
        parsed = parse_github(url)
        key = str(url).lower().rstrip('/')
        # Preserve prior data if any API batch fails. No URL is ever deleted.
        entries_by_url[key] = dict(previous.get(key, {'url': url, 'status': 'not_checked', 'flags': []}))
        entries_by_url[key]['url'] = url
        if not parsed or not parsed[1]:
            entries_by_url[key].update({'status': 'profile_or_unsupported', 'flags': [], 'checkedAt': iso(now)})
        else:
            repo_items.append((parsed[0], parsed[1], r))

    scanned = 0
    failed_batches = 0
    for offset in range(0, len(repo_items), GRAPHQL_BATCH):
        batch = repo_items[offset: offset + GRAPHQL_BATCH]
        try:
            status, response = api_call('/graphql', token, {'query': query_for_batch(batch)})
            if status != 200 or not isinstance(response.get('data'), dict):
                raise RuntimeError('GitHub GraphQL response lacked data')
        except (RuntimeError, ValueError, TypeError) as exc:
            print(f'WARNING: GitHub batch {offset // GRAPHQL_BATCH + 1} was not checked: {exc}', file=sys.stderr)
            failed_batches += 1
            continue
        payload = response['data']
        for i, (_owner, _name, resource) in enumerate(batch):
            url = resource['url']
            entry = entries_by_url[url.lower().rstrip('/')]
            data = payload.get(f'r{i}')
            scanned += 1
            entry['checkedAt'] = iso(now)
            if not data:
                # 404, private, or inaccessible: review; not confirmation of deletion.
                entry.update({'status': 'unavailable', 'flags': ['unavailable'], 'lastPushAt': None})
                continue
            # The GitHub source of truth for code activity is pushedAt, not updatedAt
            # (updatedAt also changes when issues or repo settings change).
            pushed_at = data.get('pushedAt')
            primary = data.get('primaryLanguage') or {}
            license_info = data.get('licenseInfo') or {}
            update_fields = {
                'stars': data.get('stargazerCount'), 'forks': data.get('forkCount'),
                'language': primary.get('name'), 'license': license_info.get('spdxId'),
                'updatedAt': pushed_at or data.get('updatedAt'),
            }
            for field, value in update_fields.items():
                if value is not None and resource.get(field) != value:
                    resource[field] = value
            flags, inactive_days = maintenance_signals(data, now, 1 if entry.get('publishedAdvisoryFound') is True else None)
            entry.update({
                'status': 'checked', 'flags': flags,
                'lastPushAt': pushed_at, 'daysSincePush': inactive_days,
                'stars': data.get('stargazerCount'), 'forks': data.get('forkCount'),
                'openIssues': ((data.get('issues') or {}).get('totalCount')),
                'openPullRequests': ((data.get('pullRequests') or {}).get('totalCount')),
                'archived': bool(data.get('isArchived')), 'disabled': bool(data.get('isDisabled')),
            })
        print(f'Checked {min(offset + GRAPHQL_BATCH, len(repo_items))}/{len(repo_items)} repositories')

    # Rotating advisory checks; public published advisories are historic disclosures,
    # not necessarily current vulnerabilities. A non-200 response is UNKNOWN, not zero.
    if not args.no_advisories and repo_items:
        budget = max(0, min(300, args.advisory_budget))
        repo_count = len(repo_items)
        start = ((now.date().toordinal() * budget) % repo_count) if budget else 0
        for n in range(min(budget, repo_count)):
            owner, repo, res = repo_items[(start + n) % repo_count]
            entry = entries_by_url[res['url'].lower().rstrip('/')]
            if entry.get('status') != 'checked':
                continue
            try:
                code, advisory_list = api_call(f'/repos/{owner}/{repo}/security-advisories?state=published&per_page=1', token)
                if code == 200 and isinstance(advisory_list, list):
                    # Count is intentionally a lower bound: we request only one item.
                    entry['publishedAdvisoryFound'] = bool(advisory_list)
                    entry['advisoryCheckedAt'] = iso(now)
                    flags = [f for f in entry.get('flags', []) if f != 'published_advisories']
                    if advisory_list:
                        flags.append('published_advisories')
                    entry['flags'] = flags
                else:
                    # Restricted API access means UNKNOWN, not 'zero advisories'.
                    # Preserve previously observed published advisories for review.
                    entry['advisoryStatus'] = 'unavailable'
                    entry['advisoryCheckedAt'] = iso(now)
            except RuntimeError:
                # Keep previous signal if request errored, but mark as unchecked.
                pass

    entries = [entries_by_url[str(r.get('url', '')).lower().rstrip('/')] for r in catalog]
    report = {
        'version': 1, 'generatedAt': iso(now), 'staleThresholdDays': STALE_DAYS,
        'reviewPolicy': 'human_approval_required',
        'methodology': 'Maintenance flags are heuristics, not safety or reputation guarantees. Open issues are not proven security issues. Published security advisories can already be resolved.',
        'scanned': scanned, 'failedBatches': failed_batches,
        'summary': summarize(entries), 'entries': entries,
    }
    print('Summary:', json.dumps(report['summary'], sort_keys=True))
    if failed_batches:
        print(f'WARNING: {failed_batches} GitHub GraphQL batches could not be checked; previous data preserved.', file=sys.stderr)
    if not args.dry_run:
        CATALOG.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

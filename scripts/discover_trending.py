#!/usr/bin/env python3
"""Daily review-only GitHub discovery for recently created popular AI repositories.

Does not edit src/resources.json or publish any suggestion. Uses documented
GitHub REST search, and measures average stars/day since creation (not a
claimed 24-hour star-growth rate). GITHUB_TOKEN is used only in GitHub Actions.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib import error, parse, request
import json
import math
import os
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "src/resources.json"
REPORT = ROOT / "src/daily-discoveries.json"
SEARCH_DAYS = 60
MIN_STARS = 25
MAX_CANDIDATES = 80
SEARCH_TOPICS = (
    "llm", "mcp", "generative-ai", "ai-agents", "claude",
    "rag", "ai-tools", "chatgpt", "artificial-intelligence", "agents",
)
API = "https://api.github.com/search/repositories"


def utcnow():
    return datetime.now(timezone.utc)


def iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_date(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def key(url):
    """Only normalize canonical GitHub repo URLs. Preserve owner/repo casing in report."""
    try:
        parsed = parse.urlparse(str(url))
        parts = parsed.path.strip("/").split("/")
        if parsed.scheme != "https" or parsed.netloc.lower() != "github.com" or len(parts) != 2:
            return None
        if not parts[0] or not parts[1]:
            return None
        return "/".join(parts).removesuffix(".git").casefold()
    except (ValueError, TypeError):
        return None


def api_search(query, token):
    url = API + "?" + parse.urlencode({"q": query, "sort": "stars", "order": "desc", "per_page": 100})
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ai-github-resource-hub-trending-discovery",
    }
    for attempt in range(3):
        try:
            with request.urlopen(request.Request(url, headers=headers), timeout=45) as result:
                data = json.load(result)
            if not isinstance(data, dict) or not isinstance(data.get("items"), list):
                raise RuntimeError("Malformed GitHub search response")
            return data["items"]
        except error.HTTPError as exc:
            if exc.code in (403, 429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError(f"GitHub search HTTP {exc.code}") from exc
        except error.URLError as exc:
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError(f"GitHub search network error: {exc.reason}") from exc
    raise RuntimeError("GitHub search retries exhausted")


def candidate(item, now, previous):
    if not isinstance(item, dict) or item.get("fork") or item.get("archived") or item.get("disabled") or item.get("private"):
        return None
    url = item.get("html_url")
    normalized = key(url)
    created = parse_date(item.get("created_at"))
    stars = item.get("stargazers_count")
    if normalized is None or created is None or not isinstance(stars, int) or stars < MIN_STARS:
        return None
    age_days = max(1.0, (now - created).total_seconds() / 86400)
    if age_days > SEARCH_DAYS + 1:
        return None
    daily_average = stars / age_days
    # A popularity heuristic, not a claim of measured star growth in the past day.
    if stars < 100 and daily_average < 1.5:
        return None
    description = (item.get("description") or "").strip()
    if not description:
        return None
    topics = [t for t in (item.get("topics") or []) if isinstance(t, str)][:12]
    prior = previous.get(normalized, {})
    prior_stars = prior.get("stars")
    last_seen = parse_date(prior.get("lastSeenAt"))
    gain = None
    observation_hours = None
    if isinstance(prior_stars, int) and last_seen and 0 < (now-last_seen).total_seconds() <= 72*3600:
        gain = max(0, stars - prior_stars)
        observation_hours = round((now-last_seen).total_seconds() / 3600, 1)
    owner_data = item.get("owner") or {}
    return {
        "url": url,
        "fullName": item.get("full_name") or normalized,
        "name": item.get("name") or normalized.split("/")[-1],
        "description": description[:500],
        "topics": topics,
        "stars": stars,
        "forks": item.get("forks_count") if isinstance(item.get("forks_count"), int) else 0,
        "createdAt": item.get("created_at"),
        "pushedAt": item.get("pushed_at"),
        "language": item.get("language"),
        "homepage": item.get("homepage") if isinstance(item.get("homepage"), str) and item["homepage"].startswith("https://") else None,
        "owner": owner_data.get("login") if isinstance(owner_data, dict) else None,
        "starsPerDay": round(daily_average, 1),
        "starGainSinceLastScan": gain,
        "observationHours": observation_hours,
        "firstSeenAt": prior.get("firstSeenAt") or iso(now),
        "lastSeenAt": iso(now),
    }


def discover(catalog, previous_report, search_fn, now):
    known = {normalized for r in catalog if (normalized := key(r.get("url"))) is not None}
    old = {
        normalized: entry for entry in previous_report.get("candidates", [])
        if isinstance(entry, dict) and (normalized := key(entry.get("url"))) is not None
    }
    earliest = (now - timedelta(days=SEARCH_DAYS)).date().isoformat()
    hits = {}
    successful_topics = []
    failed_topics = []
    for topic in SEARCH_TOPICS:
        query = f"topic:{topic} created:>={earliest} stars:>={MIN_STARS} fork:false archived:false"
        try:
            items = search_fn(query)
        except (RuntimeError, ValueError, TypeError) as exc:
            failed_topics.append({"topic": topic, "error": str(exc)[:140]})
            continue
        successful_topics.append(topic)
        for item in items:
            urlkey = key(item.get("html_url")) if isinstance(item, dict) else None
            if not urlkey or urlkey in known:
                continue
            row = candidate(item, now, old)
            if not row:
                continue
            if urlkey not in hits or row["stars"] > hits[urlkey]["stars"]:
                hits[urlkey] = row
    if not successful_topics:
        raise RuntimeError("All discovery searches failed. Keep the last good report.")
    # Ranking favors newly created repositories gaining a strong average
    # star count, with actual since-last-scan observations as a secondary cue.
    ranked = sorted(hits.values(), key=lambda item: (
        item["starsPerDay"], item["stars"],
        item["createdAt"] or "",
    ), reverse=True)
    report = {
        "version": 1,
        "generatedAt": iso(now),
        "searchWindowDays": SEARCH_DAYS,
        "methodology": "Recently created repositories discovered through GitHub topic search and ranked by average stars per day since creation, not actual 24-hour star growth. Suggestions are review-only and are never automatically published.",
        "queriesSucceeded": len(successful_topics),
        "queriesAttempted": len(SEARCH_TOPICS),
        "partial": bool(failed_topics),
        "failedTopics": failed_topics,
        "candidates": ranked[:MAX_CANDIDATES],
    }
    return report


def main():
    token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")
    if not token:
        sys.exit("Missing GITHUB_TOKEN or GH_TOKEN")
    catalog = json.loads(CATALOG.read_text(encoding="utf8"))
    if not isinstance(catalog, list):
        sys.exit("Catalog must be a list")
    previous = {}
    if REPORT.exists():
        try:
            previous = json.loads(REPORT.read_text(encoding="utf8"))
        except (ValueError, TypeError):
            previous = {}
    report = discover(catalog, previous, lambda q: api_search(q, token), utcnow())
    REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"Daily discovery: {len(report['candidates'])} new candidates; "
          f"{report['queriesSucceeded']}/{report['queriesAttempted']} topic searches succeeded")
    if report["partial"]:
        print("Partial discovery: " + json.dumps(report["failedTopics"]), file=sys.stderr)


if __name__ == "__main__":
    main()

import importlib.util
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "discover_trending.py"
spec = importlib.util.spec_from_file_location("discovery", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

NOW = datetime(2026, 11, 24, 13, 0, tzinfo=timezone.utc)


def repo(owner, name, stars, days_old=12, archived=False, description="Interesting AI tool"):
    return {
        "html_url": f"https://github.com/{owner}/{name}",
        "full_name": f"{owner}/{name}",
        "name": name,
        "description": description,
        "created_at": module.iso(NOW - timedelta(days=days_old)),
        "pushed_at": module.iso(NOW - timedelta(days=1)),
        "stargazers_count": stars,
        "forks_count": 7,
        "topics": ["llm", "agents"],
        "owner": {"login": owner},
        "language": "Python",
        "homepage": "https://example.com",
        "archived": archived,
        "fork": False,
        "disabled": False,
        "private": False,
    }


class DailyDiscoveryTests(unittest.TestCase):
    def test_excludes_existing_archived_and_low_popularity(self):
        existing = [{"url": "https://github.com/Already/Listed"}]
        items = [
            repo("already", "LISTED", 900),
            repo("neworg", "fast", 240),
            repo("neworg", "fast", 240),
            repo("neworg", "archived", 900, archived=True),
            repo("neworg", "weak", 25, days_old=50),
            repo("neworg", "old", 400, days_old=75),
            repo("neworg", "empty", 500, description=""),
        ]
        calls = []

        def search(query):
            calls.append(query)
            return items

        found = module.discover(existing, {}, search, NOW)
        self.assertEqual([x["url"] for x in found["candidates"]], ["https://github.com/neworg/fast"])
        self.assertEqual(found["candidates"][0]["starsPerDay"], 20.0)
        self.assertEqual(found["queriesSucceeded"], len(module.SEARCH_TOPICS))
        self.assertEqual(found["queriesAttempted"], len(module.SEARCH_TOPICS))
        self.assertTrue(all("created:>=" in q and "archived:false" in q for q in calls))
        self.assertFalse(found["partial"])

    def test_remembers_first_seen_and_measured_star_increase(self):
        url = "https://github.com/neworg/popular"
        previous = {"candidates": [{
            "url": url, "stars": 120,
            "firstSeenAt": "2026-11-20T13:00:00Z",
            "lastSeenAt": "2026-11-23T13:00:00Z",
        }]}
        found = module.discover([], previous, lambda _: [repo("neworg", "popular", 160)], NOW)
        row = found["candidates"][0]
        self.assertEqual(row["firstSeenAt"], "2026-11-20T13:00:00Z")
        self.assertEqual(row["starGainSinceLastScan"], 40)
        self.assertEqual(row["observationHours"], 24.0)
        self.assertEqual(row["lastSeenAt"], module.iso(NOW))

    def test_partial_results_preserve_explanatory_status(self):
        def search(query):
            if "topic:llm " in query:
                return [repo("neworg", "fast", 300)]
            raise RuntimeError("GitHub search HTTP 403")
        found = module.discover([], {}, search, NOW)
        self.assertEqual(found["queriesSucceeded"], 1)
        self.assertTrue(found["partial"])
        self.assertEqual(len(found["failedTopics"]), len(module.SEARCH_TOPICS)-1)
        self.assertEqual(len(found["candidates"]), 1)

    def test_all_searches_failed_does_not_overwrite_report(self):
        with self.assertRaisesRegex(RuntimeError, "All discovery searches failed"):
            module.discover([], {}, lambda _: (_ for _ in ()).throw(RuntimeError("API unavailable")), NOW)

    def test_url_normalization(self):
        self.assertEqual(module.key("https://github.com/Example/MyRepo.git"), "example/myrepo")
        self.assertIsNone(module.key("https://github.com/Example/MyRepo/issues"))
        self.assertIsNone(module.key("https://evil.example/Example/MyRepo"))


if __name__ == "__main__":
    unittest.main()

"""Best-effort Wikipedia narrative text per Toronto neighbourhood.

Context only, never an attribute source: this is injected into the
verbalizer prompt (population/persona_text.py) as background color for how
a persona might describe their neighbourhood, never as a new ground-truth
demographic bin -- the causal chain (attributes -> opinion -> score) stays
grounded in the real census/PUMF/CES data collected elsewhere.

Wikipedia is genuinely crowdsourced (community-edited over years, not a
single author) and CC-BY-SA licensed, unlike the single-author neighbourhood
"guide" blogs the user explicitly ruled out.

Coverage will not be uniform across all 158 neighbourhoods -- dense,
long-established neighbourhoods tend to have substantive articles; quieter
suburban ones may only have a stub, a redirect, or no article at all. This
script does not fabricate narrative for neighbourhoods that don't have one;
it just omits them.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
OUT_PATH = PROCESSED_DIR / "neighbourhood_narratives.json"

SEARCH_API = "https://en.wikipedia.org/w/api.php"
SUMMARY_API = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
USER_AGENT = "TechTOResearch/1.0 (https://github.com/; research project, non-commercial)"
REQUEST_DELAY_S = 0.3  # polite rate limit

MIN_EXTRACT_LENGTH = 150
TORONTO_RELEVANCE_TERMS = ("toronto", "etobicoke", "scarborough", "york", "east york", "north york")

# Generic city/borough-level or list pages that pass the relevance check by
# term overlap but aren't narrative about a specific neighbourhood -- reject
# these even if they otherwise look substantive.
_TOO_GENERIC_TITLES = {
    "toronto", "etobicoke", "scarborough", "north york", "east york",
    "old toronto", "york, toronto",
}

# Manual QA (2026-07-18) caught the search matching non-neighbourhood
# entities that happen to share a name (e.g. "Black Creek" resolving to the
# river, not the community) -- reject if the article's own opening sentence
# classifies it as one of these entity types.
_WRONG_ENTITY_TYPE_PATTERNS = (
    "is a river", "is a stream", "is a creek", "is a street", "is a road",
    "is a park", "is a school", "is a shopping", "is a mall",
    "is a subway station", "is a station", "is a bridge", "is a highway",
    "is a lake", "is a plaza",
)

_STOPWORDS = {"the", "of", "and", "at", "in", "on"}


def _name_tokens(name: str) -> set[str]:
    cleaned = re.sub(r"[.,]", "", name).replace("-", " ")
    return {tok.lower() for tok in cleaned.split() if tok.lower() not in _STOPWORDS}


def _get_json(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.load(resp)
    except (urllib.error.HTTPError, urllib.error.URLError):
        return None


def _search_best_title(neighbourhood_name: str) -> str | None:
    """MediaWiki search biased toward Toronto to disambiguate common names
    (e.g. many neighbourhood names collide with places elsewhere)."""
    query = f"{neighbourhood_name} Toronto neighbourhood"
    params = urllib.parse.urlencode(
        {
            "action": "query",
            "list": "search",
            "srsearch": query,
            "format": "json",
            "srlimit": 3,
        }
    )
    data = _get_json(f"{SEARCH_API}?{params}")
    if not data:
        return None
    hits = data.get("query", {}).get("search", [])
    return hits[0]["title"] if hits else None


def _fetch_summary(title: str) -> dict | None:
    url = SUMMARY_API.format(title=urllib.parse.quote(title.replace(" ", "_")))
    return _get_json(url)


def _is_relevant_and_substantive(summary: dict, neighbourhood_name: str) -> bool:
    if summary.get("type") == "disambiguation":
        return False
    title = summary.get("title", "")
    if title.lower().startswith("list of") or title.lower() in _TOO_GENERIC_TITLES:
        return False
    extract = summary.get("extract", "")
    if len(extract) < MIN_EXTRACT_LENGTH:
        return False
    extract_lower = extract.lower()
    opening = extract_lower[:120]
    if any(pattern in opening for pattern in _WRONG_ENTITY_TYPE_PATTERNS):
        return False
    haystack = (extract_lower + " " + summary.get("description", "").lower())
    if not any(term in haystack for term in TORONTO_RELEVANCE_TERMS):
        return False
    # Require the resolved title/extract to actually share a token with the
    # neighbourhood name being looked up -- catches drift onto an unrelated
    # nearby-sounding article (e.g. "Yonge-Bay Corridor" resolving to
    # "Willowdale" purely because both are generically "a Toronto
    # neighbourhood", with no real overlap).
    name_tokens = _name_tokens(neighbourhood_name)
    title_tokens = _name_tokens(title)
    if name_tokens & title_tokens:
        return True
    return any(tok in extract_lower[:200] for tok in name_tokens if len(tok) > 3)


def fetch_all_narratives() -> dict[str, dict]:
    census = pd.read_csv(PROCESSED_DIR / "census_profile.csv")
    results: dict[str, dict] = {}
    skipped: list[str] = []

    for _, row in census.iterrows():
        code = str(row["AREA_SHORT_CODE"]).zfill(3)
        name = row["neighbourhood_name"]
        # Composite names ("West Humber-Clairville") rarely match a single
        # Wikipedia title directly; try each hyphen-joined component too.
        candidates = [name] + re.split(r"-", name)

        found = None
        for candidate in candidates:
            title = _search_best_title(candidate)
            time.sleep(REQUEST_DELAY_S)
            if not title:
                continue
            summary = _fetch_summary(title)
            time.sleep(REQUEST_DELAY_S)
            if summary and _is_relevant_and_substantive(summary, candidate):
                found = summary
                break

        if found:
            results[code] = {
                "neighbourhood_name": name,
                "wikipedia_title": found.get("title"),
                "extract": found.get("extract"),
                "url": found.get("content_urls", {}).get("desktop", {}).get("page"),
            }
            print(f"[{code}] {name} -> {found.get('title')} ({len(found.get('extract',''))} chars)")
        else:
            skipped.append(name)
            print(f"[{code}] {name} -> no substantive match, skipped")

    OUT_PATH.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\n{len(results)}/{len(census)} neighbourhoods matched, written to {OUT_PATH}")
    print(f"{len(skipped)} skipped (no substantive/relevant Wikipedia article found)")
    return results


if __name__ == "__main__":
    fetch_all_narratives()

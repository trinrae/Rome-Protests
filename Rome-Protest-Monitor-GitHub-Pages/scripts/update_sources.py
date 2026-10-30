#!/usr/bin/env python3
"""Discover possible protest mentions in Roma Mobilita's public RSS feed.

A candidate is never promoted into a confirmed event automatically. The feed is
only a review queue, not a real-time incident, geolocation, or crowd detector.
"""
import argparse
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
FEED_URL = "https://romamobilita.it/feed/"
SOURCE = "Roma Mobilita official RSS"
MAX_BYTES = 4 * 1024 * 1024
MAX_AGE_DAYS = 21
# These are discovery terms, not automatic event verification.
KEYWORDS = re.compile(r"\b(?:manifestazion\w*|corte\w*|sit[ -]?in|presidi\w*|protest\w*|scioper\w*|mobilitazion\w*|radun\w*|student\w*\s+in\s+piazza)\b", re.IGNORECASE)


class StripHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.words = []
    def handle_data(self, s):
        self.words.append(s)


def plain_html(source):
    stripper = StripHTML()
    stripper.feed(source or "")
    return re.sub(r"\s+", " ", " ".join(stripper.words)).strip()


def normalize_url(value):
    try:
        bits = urlsplit((value or "").strip())
        if bits.scheme != "https" or not bits.hostname or not (bits.hostname == "romamobilita.it" or bits.hostname.endswith(".romamobilita.it")):
            return ""
        return urlunsplit(("https", bits.netloc.lower(), bits.path.rstrip("/") + "/", "", ""))
    except ValueError:
        return ""


def parse_published(raw):
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError):
        try:
            dt = datetime.fromisoformat(raw.strip().replace('Z', '+00:00'))
        except (ValueError, TypeError):
            return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def parse_rss(xml_data):
    """Return safe article metadata. RSS 2.0 and Atom are supported."""
    root = ET.fromstring(xml_data)
    atom = '{http://www.w3.org/2005/Atom}'
    items = []
    if root.tag in ('rss', 'RDF', '{http://www.w3.org/1999/02/22-rdf-syntax-ns#}RDF'):
        nodes = root.findall('.//item')
        for node in nodes:
            items.append({
                'title': (node.findtext('title') or '').strip(),
                'url': (node.findtext('link') or '').strip(),
                'summary': plain_html(node.findtext('description') or ''),
                'published': parse_published(node.findtext('pubDate') or node.findtext('{http://purl.org/dc/elements/1.1/}date')),
            })
    elif root.tag == atom + 'feed':
        for node in root.findall(atom + 'entry'):
            links = node.findall(atom + 'link')
            link = next((a.get('href') for a in links if a.get('rel', 'alternate') == 'alternate'), '')
            items.append({
                'title': (node.findtext(atom + 'title') or '').strip(),
                'url': link,
                'summary': plain_html(node.findtext(atom + 'summary') or node.findtext(atom + 'content') or ''),
                'published': parse_published(node.findtext(atom + 'published') or node.findtext(atom + 'updated')),
            })
    else:
        raise ValueError('Source returned a feed format that this script does not understand.')
    return items


def discover_candidates(items, reviewed_events, now=None):
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=MAX_AGE_DAYS)
    reviewed = {normalize_url(e.get('source_url', '')) for e in reviewed_events}
    seen = set()
    discoveries = []
    for item in items:
        url = normalize_url(item.get('url'))
        published = item.get('published')
        if not url or url in seen or url in reviewed:
            continue
        seen.add(url)
        if not published or published < cutoff or published > now + timedelta(days=2):
            continue
        title = plain_html(item.get('title', ''))[:240]
        summary = plain_html(item.get('summary', ''))[:550]
        if not KEYWORDS.search(title + ' ' + summary):
            continue
        discoveries.append({
            'id': sha256(url.encode('utf-8')).hexdigest()[:16],
            'title': title,
            'url': url,
            'summary': summary,
            'source': SOURCE,
            'published_at': published.strftime('%Y-%m-%d %H:%M UTC'),
        })
    return sorted(discoveries, key=lambda v: v['published_at'], reverse=True)[:60]


def fetch_feed(url=FEED_URL):
    req = Request(url, headers={
        'User-Agent': 'RomeGSOCPublicNoticeMonitor/1.0 (read-only; GitHub Pages source check)',
        'Accept': 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5'
    })
    with urlopen(req, timeout=16) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('RSS feed exceeded safety size limit.')
    return data


def update(output_dir, fixture=None, now=None):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    now = now or datetime.now(timezone.utc)
    events = json.loads((ROOT / 'data/events.json').read_text(encoding='utf-8'))
    report = {
        'status': 'error', 'checked_at': now.isoformat(timespec='seconds').replace('+00:00','Z'),
        'source': SOURCE, 'url': FEED_URL, 'candidates': 0, 'articles_examined': 0,
        'error': None, 'note': 'Public-source keyword discovery only. Each candidate requires analyst validation.'
    }
    results = []
    try:
        data = Path(fixture).read_bytes() if fixture else fetch_feed()
        articles = parse_rss(data)
        report['articles_examined'] = len(articles)
        results = discover_candidates(articles, events, now)
        report['candidates'] = len(results)
        report['status'] = 'fixture' if fixture else 'ok'
        if fixture:
            report['note'] = 'TEST FIXTURE ONLY. No official website was contacted.'
    except (HTTPError, URLError, TimeoutError, OSError, ET.ParseError, ValueError) as exc:
        report['error'] = f'{type(exc).__name__}: {str(exc)[:300]}'
        # Never present empty results from an unsuccessful fetch as "no findings".
        results = []
    (output_dir / 'discovery.json').write_text(json.dumps(results, indent=2, ensure_ascii=False) + '\n',encoding='utf-8')
    (output_dir / 'scan_status.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n',encoding='utf-8')
    print(f"Feed scan: {report['status']} | examined {report['articles_examined']} | candidates {len(results)}")
    if report['error']:
        print('WARNING: ' + report['error'], file=sys.stderr)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=Path, help='Use a local RSS file for testing only; marked as fixture, not a real scan')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'data')
    args=parser.parse_args()
    # Non-zero exit is deliberately avoided on a network failure so GitHub Pages can
    # still deploy a prominently labeled failed-check dashboard.
    update(args.output_dir, args.fixture)


if __name__ == '__main__':
    main()

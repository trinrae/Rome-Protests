import sys
from datetime import datetime, timezone
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from update_sources import parse_rss, discover_candidates, normalize_url, plain_html
import json


class SourceParserTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 30, 3, 0, tzinfo=timezone.utc)
        self.reviewed = json.loads((ROOT / 'data/events.json').read_text('utf-8'))

    def test_fixture_feed(self):
        items = parse_rss((ROOT / 'tests/fixture_rss.xml').read_bytes())
        self.assertEqual(len(items), 4)
        candidates = discover_candidates(items, self.reviewed, self.now)
        self.assertEqual(len(candidates), 1)
        self.assertIn('Possible sit-in', candidates[0]['title'])
        self.assertTrue(candidates[0]['url'].startswith('https://romamobilita.it/'))

    def test_refuse_nonofficial_domain(self):
        self.assertEqual(normalize_url('https://fake-romamobilita.it/post/'), '')
        self.assertEqual(normalize_url('javascript:alert(1)'), '')
        self.assertEqual(normalize_url('http://romamobilita.it/'), '')
        self.assertEqual(normalize_url('https://romamobilita.it/post/?utm_source=a'), 'https://romamobilita.it/post/')

    def test_does_not_promote_old_notices(self):
        item = {'title':'Corteo tomorrow','summary':'', 'url':'https://romamobilita.it/old/',
                'published':datetime(2025,1,1,tzinfo=timezone.utc)}
        self.assertEqual(discover_candidates([item],[],self.now), [])

    def test_strip_html(self):
        self.assertEqual(plain_html('<p>Roma <b>protesta</b> &amp; transport</p>'),'Roma protesta & transport')

    def test_event_schema(self):
        ids=set()
        for e in self.reviewed:
            self.assertNotIn(e['id'],ids)
            ids.add(e['id'])
            self.assertEqual(e['status'],'announced')
            self.assertTrue(normalize_url(e['source_url']))
            self.assertEqual(len(e['point']),2)
            self.assertTrue(41.7 < e['point'][0] < 42.1)
            self.assertTrue(12.3 < e['point'][1] < 12.7)
            self.assertIn(e['impact'], ('high','moderate','low'))
            if e['start'] and e['end']:
                self.assertLess(e['start'], e['end'])


if __name__ == '__main__':
    unittest.main()

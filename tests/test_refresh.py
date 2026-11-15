import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.refresh import build

HEADER = "latitude,longitude,acq_date,acq_time,confidence,frp,satellite\n"
NOW = datetime(2026, 11, 14, 21, tzinfo=timezone.utc)


class RefreshTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.counties = json.loads(Path("site/data/counties.json").read_text())

    def test_counties_have_population(self):
        self.assertEqual(len(self.counties["features"]), 58)
        self.assertTrue(all(c["properties"]["population"] > 0 for c in self.counties["features"]))

    def test_geography_deduplication_and_confidence(self):
        san_diego = "32.75,-117.15,2026-11-14,1705,h,2.5,N20\n"
        reno = "39.55,-119.80,2026-11-14,1705,n,3,N20\n"
        result = build(HEADER + san_diego * 2 + reno, self.counties, NOW)
        self.assertEqual(len(result["points"]), 1)
        self.assertEqual(result["points"][0][3:], ["06073", "high", 2.5])

    def test_refuses_empty_and_stale_feeds(self):
        for payload in (HEADER, HEADER + "32.75,-117.15,2026-11-11,1705,h,2.5,N20\n", "<html>"):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                build(payload, self.counties, NOW)

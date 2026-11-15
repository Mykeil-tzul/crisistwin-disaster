"""Fetch NOAA-20 VIIRS from NASA FIRMS and publish verified California detections."""
import argparse
import csv
import io
import json
import math
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.request import Request, urlopen

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site/data"
NASA = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_7d.csv"
REQUIRED = {"latitude", "longitude", "acq_date", "acq_time", "confidence", "frp", "satellite"}


def download():
    for attempt in range(3):
        try:
            req = Request(NASA, headers={"User-Agent": "CrisisTwin research dashboard/1.0"})
            with urlopen(req, timeout=25) as response:
                payload = response.read(16_000_001)
                if len(payload) > 16_000_000:
                    raise ValueError("NASA download exceeded size limit")
                return payload.decode("utf-8-sig")
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def build(csv_text, counties, now):
    reader = csv.DictReader(io.StringIO(csv_text))
    if not REQUIRED.issubset(reader.fieldnames or []):
        raise ValueError("NASA feed format changed")
    features = counties["features"]
    spatial_index = STRtree([shape(f["geometry"]) for f in features])
    points, source_latest, seen = [], None, set()
    source_rows = valid = 0
    for row in reader:
        source_rows += 1
        try:
            lat, lon, frp = (float(row[name]) for name in ("latitude", "longitude", "frp"))
            when = datetime.strptime(row["acq_date"] + row["acq_time"].zfill(4), "%Y-%m-%d%H%M").replace(tzinfo=timezone.utc)
            confidence = {"l": "low", "n": "nominal", "h": "high"}.get(row["confidence"], row["confidence"])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180 and math.isfinite(frp) and frp >= 0
                    and confidence in {"low", "nominal", "high"} and when <= now + timedelta(minutes=5)):
                continue
        except (ValueError, TypeError, AttributeError):
            continue
        valid += 1
        source_latest = max(source_latest, when) if source_latest else when
        if not (32 <= lat <= 42.02 and -125 <= lon <= -114) or when < now - timedelta(days=7):
            continue
        key = (lat, lon, when, row["satellite"])
        if key in seen:
            continue
        seen.add(key)
        matches = spatial_index.query(Point(lon, lat), predicate="covered_by")
        if len(matches):
            county = min(features[i]["properties"]["id"] for i in matches)
            points.append([round(lat, 5), round(lon, 5), int(when.timestamp()), county, confidence, round(frp, 2)])
    if not source_rows or valid / source_rows < 0.95 or now - source_latest > timedelta(hours=48):
        raise ValueError("NASA feed is empty, malformed or too old. Keeping last successful snapshot.")
    return {"fetched_at": now.isoformat(), "latest_source_observation": source_latest.isoformat(),
            "source_rows": source_rows, "valid_source_rows": valid, "points": sorted(points, key=lambda row: -row[2])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Local copy of the NASA CSV for replay/testing")
    args = parser.parse_args()
    started = time.monotonic()
    text = args.input.read_text() if args.input else download()
    result = build(text, json.loads((DATA / "counties.json").read_text()), datetime.now(timezone.utc))
    result["pipeline_seconds"] = round(time.monotonic() - started, 2)
    with NamedTemporaryFile(mode="w", dir=DATA, delete=False) as temporary:
        json.dump(result, temporary, separators=(",", ":"))
        temporary.write("\n")
    os.replace(temporary.name, DATA / "snapshot.json")
    print(f"Published {len(result['points'])} California detections in {result['pipeline_seconds']}s")


if __name__ == "__main__":
    main()

"""Create compact California county boundaries with Census population estimates."""
import argparse
import csv
import json
from pathlib import Path

import shapefile
from shapely.geometry import mapping, shape

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("census_zip", type=Path)
parser.add_argument("population_csv", type=Path)
args = parser.parse_args()
with args.population_csv.open(encoding="latin1", newline="") as source:
    population = {
        row["STATE"] + row["COUNTY"]: int(row["POPESTIMATE2025"])
        for row in csv.DictReader(source) if row["STATE"] == "06" and row["SUMLEV"] == "050"
    }
features = []
with shapefile.Reader(str(args.census_zip), encoding="latin1") as counties:
    for record in counties.iterShapeRecords():
        fields = record.record.as_dict()
        if fields["STATEFP"] != "06":
            continue
        geoid = fields["GEOID"]
        polygon = shape(record.shape.__geo_interface__).simplify(0.002, preserve_topology=True)
        features.append({
            "type": "Feature", "geometry": mapping(polygon),
            "properties": {"id": geoid, "name": fields["NAME"], "population": population[geoid]},
        })
if len(features) != 58 or not all(shape(item["geometry"]).is_valid for item in features):
    raise ValueError("Expected 58 valid California county boundaries")
out = Path("site/data/counties.json")
out.write_text(json.dumps({"type": "FeatureCollection", "features": sorted(features, key=lambda f:f["properties"]["id"])},
                          separators=(",", ":")) + "\n")
print(f"Exported {len(features)} counties")

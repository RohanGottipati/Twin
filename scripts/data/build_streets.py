"""Build public/data/streets.geojson.

Input (download next to this script):
- centreline_raw.geojson : open.toronto.ca package `toronto-centreline-tcl`,
  resource "Centreline - version 2 - 4326.geojson" (64k links, WGS84,
  citywide).

Drops non-walkable link types (expressways/ramps, railways, rivers, hydro
lines), simplifies each LineString with Douglas-Peucker at ~4m tolerance,
rounds to 6 decimals, and writes a flat collection the pedestrian-wander
code snaps dots to.
"""
import json

SRC = "centreline_raw.geojson"
DST = "streets.geojson"
TOL = 0.00007  # ~7m at Toronto's latitude

# Only real pedestrian rights-of-way: ordinary streets, lanes, trails and
# walkways. Excludes expressways/ramps, rail, hydro/water lines, ferries,
# and TCL bookkeeping types (Other/Pending/Geostatistical line) that aren't
# walkable paths.
KEEP_TYPES = {
    "Local",
    "Collector",
    "Minor Arterial",
    "Major Arterial",
    "Laneway",
    "Trail",
    "Walkway",
    "Busway",
}


def simplify(coords, tol):
    if len(coords) < 3:
        return coords
    keep = [False] * len(coords)
    keep[0] = keep[-1] = True
    stack = [(0, len(coords) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = coords[a]
        bx, by = coords[b]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        dmax, imax = 0.0, -1
        for i in range(a + 1, b):
            px, py = coords[i]
            if seg2 == 0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
                d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d2 > dmax:
                dmax, imax = d2, i
        if dmax > tol * tol:
            keep[imax] = True
            stack.append((a, imax))
            stack.append((imax, b))
    out = [c for c, k in zip(coords, keep) if k]
    return out if len(out) >= 2 else [coords[0], coords[-1]]


def main():
    fc = json.load(open(SRC))

    feats = []
    for f in fc["features"]:
        p = f["properties"]
        if p.get("FEATURE_CODE_DESC") not in KEEP_TYPES:
            continue
        geom = f["geometry"]
        if geom["type"] == "LineString":
            lines = [geom["coordinates"]]
        elif geom["type"] == "MultiLineString":
            lines = geom["coordinates"]
        else:
            continue
        for line in lines:
            coords = simplify(
                [[round(x, 5), round(y, 5)] for x, y in line], TOL
            )
            if len(coords) < 2 or coords[0] == coords[-1]:
                continue
            feats.append(
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {"type": "LineString", "coordinates": coords},
                }
            )

    json.dump(
        {"type": "FeatureCollection", "features": feats},
        open(DST, "w"),
        separators=(",", ":"),
    )
    print(len(feats), "street segments written")


if __name__ == "__main__":
    main()

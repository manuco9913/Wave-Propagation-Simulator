"""Build the placeholder offline basemap (public/map/sample.pmtiles).

Single z0 vector tile with a coarse lat/lon graticule and a "land" box, so the map
renders with zero network. Swap for a real regional extract (see research/map-tiles).

    uv run --no-project --with pmtiles --with mapbox-vector-tile --with shapely scripts/make_sample_pmtiles.py
"""

import gzip
import json
import math
from pathlib import Path

import mapbox_vector_tile
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from shapely.geometry import LineString, box

EXTENT = 4096
OUT = Path(__file__).resolve().parent.parent / "public" / "map" / "sample.pmtiles"


def to_tile(lon: float, lat: float) -> tuple[float, float]:
    x = (lon + 180) / 360
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2
    return x * EXTENT, (1 - y) * EXTENT  # mapbox-vector-tile expects y-up


def main() -> None:
    lines = [
        LineString([to_tile(lon, lat) for lat in range(-80, 81, 5)]) for lon in range(-180, 181, 15)
    ]
    lines += [
        LineString([to_tile(lon, lat) for lon in range(-180, 181, 5)]) for lat in range(-75, 76, 15)
    ]
    sw, ne = to_tile(5, 35), to_tile(20, 48)
    land = box(sw[0], sw[1], ne[0], ne[1])
    tile = mapbox_vector_tile.encode(
        [
            {"name": "graticule", "features": [{"geometry": g, "properties": {}} for g in lines]},
            {"name": "land", "features": [{"geometry": land, "properties": {}}]},
        ],
        default_options={"extents": EXTENT},
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("wb") as f:
        w = Writer(f)
        w.write_tile(zxy_to_tileid(0, 0, 0), gzip.compress(tile))
        w.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_zoom": 0,
                "max_zoom": 0,
                "min_lon_e7": -1800000000,
                "min_lat_e7": -850000000,
                "max_lon_e7": 1800000000,
                "max_lat_e7": 850000000,
                "center_zoom": 0,
                "center_lon_e7": 0,
                "center_lat_e7": 0,
            },
            {"name": "sample", "vector_layers": [{"id": "graticule"}, {"id": "land"}]},
        )
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

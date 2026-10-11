"""Ground elevation from the terrain tiles (system-plan.md, Backend Preprocessing Pipeline).

`RasterTerrain` samples elevations (m above sea level, EGM2008) from GeoTIFF tiles, nearest
pixel. Each tile is decoded once, on first use, and kept in memory. Areas known to be open sea
(tiles Copernicus doesn't publish) read as 0 m. A point covered by neither raises
`TerrainCoverageError`. `terrain_profile` is the pipeline's step 2: one profile per ray.
"""

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import NamedTuple, Protocol

import numpy as np
from pyproj import Geod

from app.h5 import Bools, Floats
from app.raster import RasterInfo, read_raster, read_raster_info

GEOD = Geod(ellps="WGS84")
_EDGE_TOLERANCE = 1e-7  # degrees
_TILE_NAME = re.compile(r"_(N|S)(\d{2})_00_(E|W)(\d{3})_00_")


class Box(NamedTuple):
    west: float
    south: float
    east: float
    north: float

    def contains(self, lat: Floats, lon: Floats) -> Bools:
        # Neighbouring tiles' edges can differ by float noise (~1e-12°); the tolerance (~1 cm)
        # keeps that from opening a gap between them.
        return (
            (lon >= self.west - _EDGE_TOLERANCE)
            & (lon < self.east + _EDGE_TOLERANCE)
            & (lat > self.south - _EDGE_TOLERANCE)
            & (lat <= self.north + _EDGE_TOLERANCE)
        )


class TerrainCoverageError(Exception):
    """A point the terrain data doesn't cover."""

    def __init__(self, lat: float, lon: float) -> None:
        super().__init__(f"no terrain data at {lat:.5f}, {lon:.5f}")
        self.lat = lat
        self.lon = lon


class Terrain(Protocol):
    def elevations(self, lats: Floats, lons: Floats) -> Floats:
        """Elevation (m above sea level) at each point; raises TerrainCoverageError."""
        ...

    def uncovered(self, box: Box) -> str | None:
        """Why the data doesn't cover all of `box`, or None if it does."""
        ...


@dataclass
class _Tile:
    path: Path
    box: Box  # outer edges of its pixels
    info: RasterInfo | None  # None when the file isn't installed


def _box_from_name(name: str) -> Box:
    """A Copernicus tile's 1°x1° cell from its name, e.g. ..._N31_00_E035_00_DEM."""
    m = _TILE_NAME.search(name)
    if m is None:
        raise ValueError(f"not a Copernicus tile name: {name}")
    south = int(m[2]) * (1 if m[1] == "N" else -1)
    west = int(m[4]) * (1 if m[3] == "E" else -1)
    return Box(west, south, west + 1, south + 1)


class RasterTerrain:
    def __init__(self, tiles: Sequence[Path], sea: Sequence[Box]) -> None:
        self._tiles = [_installed(path) for path in tiles]
        self._sea = list(sea)
        self._arrays: dict[Path, np.ndarray[tuple[int, int], np.dtype[np.float32]]] = {}

    @staticmethod
    def from_manifest(manifest_path: Path, terrain_dir: Path) -> "RasterTerrain":
        """The tiles terrain/manifest.json lists, as laid out by terrain/fetch.py under
        `terrain_dir`. Tiles not downloaded yet are reported by `uncovered`, not here."""
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        terrain = RasterTerrain([], [_box_from_name(t["name"]) for t in manifest["missing_tiles"]])
        for tile in manifest["tiles"]:
            name = str(tile["name"])
            path = terrain_dir / "copernicus-dem-30m" / name / f"{name}.tif"
            if path.is_file():
                terrain._tiles.append(_installed(path))
            else:
                terrain._tiles.append(_Tile(path, _box_from_name(name), None))
        return terrain

    def elevations(self, lats: Floats, lons: Floats) -> Floats:
        lats, lons = np.asarray(lats, dtype=np.float64), np.asarray(lons, dtype=np.float64)
        out = np.full(lats.shape, np.nan)
        todo = np.ones(lats.shape, dtype=np.bool_)
        for tile in self._tiles:
            if tile.info is None:
                continue
            inside = todo & tile.box.contains(lats, lons)
            if not inside.any():
                continue
            out[inside] = self._sample(tile, tile.info, lats[inside], lons[inside])
            todo &= ~inside
        for sea in self._sea:
            inside = todo & sea.contains(lats, lons)
            out[inside] = 0.0
            todo &= ~inside
        if todo.any():
            first = int(np.flatnonzero(todo.ravel())[0])
            raise TerrainCoverageError(float(lats.ravel()[first]), float(lons.ravel()[first]))
        return out

    def uncovered(self, box: Box) -> str | None:
        # Split `box` along every tile/sea edge inside it; each piece lies wholly inside or
        # outside each rectangle, so testing one point per piece is exact.
        rects = [t.box for t in self._tiles] + self._sea
        xs = sorted({box.west, box.east, *(e for r in rects for e in (r.west, r.east))})
        ys = sorted({box.south, box.north, *(e for r in rects for e in (r.south, r.north))})
        xs = [x for x in xs if box.west <= x <= box.east]
        ys = [y for y in ys if box.south <= y <= box.north]
        for x0, x1 in pairwise(xs):
            for y0, y1 in pairwise(ys):
                lon, lat = np.array([(x0 + x1) / 2]), np.array([(y0 + y1) / 2])
                tile = next((t for t in self._tiles if t.box.contains(lat, lon)[0]), None)
                if tile is not None and tile.info is None:
                    return f"terrain tile {tile.path.name} is not installed (run terrain/fetch.py)"
                if tile is None and not any(s.contains(lat, lon)[0] for s in self._sea):
                    return f"{lat[0]:.4f}, {lon[0]:.4f} is outside the terrain data"
        return None

    def _sample(self, tile: _Tile, info: RasterInfo, lats: Floats, lons: Floats) -> Floats:
        array = self._arrays.get(tile.path)
        if array is None:
            array = read_raster(tile.path)
            self._arrays[tile.path] = array
        # Nearest pixel: the transform maps pixel edges, so flooring gives the pixel whose
        # centre is closest (GLO-30 is pixel-is-point; its transform is already shifted).
        cols = np.floor((lons - info.west) / info.pixel_width).astype(np.intp)
        rows = np.floor((info.north - lats) / info.pixel_height).astype(np.intp)
        cols = np.clip(cols, 0, info.width - 1)
        rows = np.clip(rows, 0, info.height - 1)
        return array[rows, cols].astype(np.float64)


def _installed(path: Path) -> _Tile:
    info = read_raster_info(path)
    return _Tile(path, Box(info.west, info.south, info.east, info.north), info)


def circle_box(lat: float, lon: float, radius_m: float) -> Box:
    """The lat/lon box around a circle on the ellipsoid (its four compass points)."""
    lons, lats, _ = GEOD.fwd([lon] * 4, [lat] * 4, [0, 90, 180, 270], [radius_m] * 4)
    return Box(min(lons), min(lats), max(lons), max(lats))


def terrain_profile(
    terrain: Terrain, lat: float, lon: float, azimuths: Floats, distances: Floats
) -> tuple[float, Floats]:
    """Ground elevation at the antenna, and terrain [A x D] along each ray (m above sea level).

    Rays start at (lat, lon) and step outward along the geodesic: `azimuths` in degrees from
    north, `distances` in metres.
    """
    count = azimuths.size * distances.size
    az = np.repeat(azimuths, distances.size)
    dist = np.tile(distances, azimuths.size)
    lons, lats, _ = GEOD.fwd(np.full(count, lon), np.full(count, lat), az, dist)
    elevations = terrain.elevations(
        np.asarray(lats, dtype=np.float64), np.asarray(lons, dtype=np.float64)
    )
    ground = terrain.elevations(np.array([lat]), np.array([lon]))
    return float(ground[0]), elevations.reshape(azimuths.size, distances.size)

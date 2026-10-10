"""One height slice of a run, as the map grid the browser draws.

See system-plan.md, Polar -> Cartesian Rasterization.

Per entity: read the polar [D x A] slice, apply the vertical antenna gain, resample it onto the
map grid; then combine the entities cell by cell. Nothing here is stored.
"""

import struct
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt
from pyproj import Geod
from scipy import ndimage  # pyright: ignore[reportMissingTypeStubs]

from app.h5 import Floats, Floats32, StoredEntity, read_height_slice, read_params
from app.pipeline import entity_output_path

GEOD = Geod(ellps="WGS84")
MAGIC = b"WPS1"
VERSION = 1
# magic, version, width, height, min, max, west, south, east, north, 2 reserved bytes
HEADER = struct.Struct("<4sHIIffdddd2x")
assert HEADER.size == 56


class SliceError(Exception):
    def __init__(self, error: str, message: str) -> None:
        super().__init__(message)
        self.error = error
        self.message = message


@dataclass(frozen=True)
class Grid:
    """Map grid over the entities' circles. Row 0 is the north edge; rows are evenly spaced in
    Web Mercator y and columns in longitude, so the image maps linearly onto the map's bbox."""

    west: float
    south: float
    east: float
    north: float
    lons: Floats  # [W] cell-centre longitudes
    lats: Floats  # [H] cell-centre latitudes, north first


@dataclass(frozen=True)
class Slice:
    grid: Grid
    values: Floats32  # [H x W] dBm, NaN outside every entity's radius


def render_slice(
    run_dir: Path, height_m: float, combination_method: str | None, grid_cell_size: float | None
) -> Slice:
    """The combined slice at `height_m`; the overrides replace the run snapshot's values."""
    params_path = run_dir / "params.h5"
    if not params_path.exists():
        raise SliceError("not_ready", "the run has no result yet")
    run = read_params(params_path)
    matches = np.flatnonzero(np.isclose(run.heights, height_m))
    if matches.size == 0:
        raise SliceError("height_out_of_range", f"{height_m} m is not one of the run's heights")
    height_index = int(matches[0])
    method = combination_method or str(run.scenario["combination_method"])
    cell = grid_cell_size or float(run.scenario["grid_cell_size"])
    ground_ref = run.scenario["height_reference"] == "ground"

    grid = _grid(run.entities, cell)
    lon_mesh, lat_mesh = np.meshgrid(grid.lons, grid.lats)
    layers: list[Floats32] = []
    for index, entity in enumerate(run.entities):
        polar = read_height_slice(entity_output_path(run_dir, index), height_index)
        if polar is None:
            raise SliceError("not_ready", f"entity {index + 1} has no data at {height_m} m")
        polar = polar + _vertical_gain(entity, float(run.heights[height_index]), ground_ref)
        layers.append(_rasterize(entity, polar, lon_mesh, lat_mesh))
    return Slice(grid, _combine(layers, method))


def encode_slice(s: Slice) -> bytes:
    rows, cols = s.values.shape
    finite = s.values[np.isfinite(s.values)]
    low, high = (float(finite.min()), float(finite.max())) if finite.size else (np.nan, np.nan)
    g = s.grid
    header = HEADER.pack(MAGIC, VERSION, cols, rows, low, high, g.west, g.south, g.east, g.north)
    return header + s.values.astype("<f4").tobytes()


def _grid(entities: list[StoredEntity], cell_m: float) -> Grid:
    lons: list[float] = []
    lats: list[float] = []
    for e in entities:
        pos = e.entity["position"]
        radius_m = float(e.entity["radius"]) * 1000
        ends = GEOD.fwd([pos["lon"]] * 4, [pos["lat"]] * 4, [0, 90, 180, 270], [radius_m] * 4)
        lons += list(ends[0])
        lats += list(ends[1])
    west, east, south, north = min(lons), max(lons), min(lats), max(lats)
    mid_lat = (south + north) / 2
    width_m = GEOD.inv(west, mid_lat, east, mid_lat)[2]
    height_m = GEOD.inv(west, south, west, north)[2]
    cols = max(1, round(width_m / cell_m))
    rows = max(1, round(height_m / cell_m))
    lon_centres = west + (np.arange(cols) + 0.5) * (east - west) / cols
    y_north, y_south = _mercator_y(north), _mercator_y(south)
    y_centres = y_north + (np.arange(rows) + 0.5) * (y_south - y_north) / rows
    lat_centres = np.degrees(2 * np.arctan(np.exp(y_centres)) - np.pi / 2)
    return Grid(west, south, east, north, lon_centres, lat_centres)


def _mercator_y(lat: float) -> float:
    return float(np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)))


def _vertical_gain(entity: StoredEntity, height: float, ground_ref: bool) -> Floats:
    """3GPP TR 38.901 vertical pattern (placeholder, TBD-8) as a [D x A] dB offset."""
    beam_width = entity.entity.get("beam_width")
    if beam_width is None:
        return np.zeros((entity.distances.size, entity.azimuths.size))
    tilt = float(entity.entity.get("tilt", 0))
    antenna_alt = entity.ground_elevation + float(entity.entity["antenna_height"])
    point_alt = entity.terrain + height if ground_ref else np.full_like(entity.terrain, height)
    phi = np.degrees(np.arctan2(point_alt - antenna_alt, entity.distances[np.newaxis, :]))
    gain = -np.minimum(12 * ((phi - tilt) / float(beam_width)) ** 2, 30)
    return gain.T  # [A x D] -> [D x A]


def _rasterize(
    entity: StoredEntity,
    polar: npt.NDArray[np.floating],
    lon_mesh: Floats,
    lat_mesh: Floats,
) -> Floats32:
    pos = entity.entity["position"]
    origin_lon = np.full_like(lon_mesh, pos["lon"])
    origin_lat = np.full_like(lat_mesh, pos["lat"])
    bearing, _, dist = GEOD.inv(origin_lon, origin_lat, lon_mesh, lat_mesh)
    bearing = np.mod(np.asarray(bearing), 360.0)
    dist = np.asarray(dist)
    step = entity.distances[1] - entity.distances[0] if entity.distances.size > 1 else 1.0
    r_index = np.maximum((dist - entity.distances[0]) / step, 0.0)
    theta_index = bearing * entity.azimuths.size / 360.0
    wrapped = np.concatenate([polar, polar[:, :1]], axis=1)  # 360° == 0°
    values = _bilinear(wrapped, r_index, theta_index)
    values[dist > float(entity.entity["radius"]) * 1000] = np.nan
    return values.astype(np.float32)


def _combine(layers: list[Floats32], method: str) -> Floats32:
    stack = np.stack(layers)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN cells stay NaN
        if method == "max":
            return np.nanmax(stack, axis=0).astype(np.float32)
        linear = np.power(10.0, stack / 10.0)  # mean/sum of received power, in mW
        combined = np.nanmean(linear, axis=0) if method == "mean" else np.nansum(linear, axis=0)
        combined[np.all(np.isnan(stack), axis=0)] = np.nan
        return (10 * np.log10(combined)).astype(np.float32)


def _bilinear(image: npt.NDArray[np.floating], rows: Floats, cols: Floats) -> Floats:
    """`image` sampled at fractional (row, col) positions, clamped at the edges, no overshoot."""
    sampled = ndimage.map_coordinates(image, [rows, cols], order=1, mode="nearest")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    return np.asarray(sampled, dtype=np.float64)  # pyright: ignore[reportUnknownArgumentType]

"""Writes tiny GeoTIFF tiles for terrain tests (rasterio is untyped; kept to this file)."""

# pyright: reportMissingTypeStubs=false, reportUnknownMemberType=false
# pyright: reportUnknownVariableType=false, reportUnknownArgumentType=false

from pathlib import Path

import numpy as np
import numpy.typing as npt
import rasterio
from rasterio.transform import from_origin


def write_tile(
    path: Path, west: float, north: float, pixel_deg: float, values: npt.NDArray[np.float32]
) -> Path:
    """A north-up EPSG:4326 float32 tile whose top-left pixel corner is (west, north)."""
    height, width = values.shape
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=from_origin(west, north, pixel_deg, pixel_deg),
    ) as ds:
        ds.write(values[np.newaxis])
    return path

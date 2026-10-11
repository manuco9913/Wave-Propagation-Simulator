"""The one place rasterio (untyped) is touched: tile metadata and full-tile reads."""

# pyright: reportMissingTypeStubs=false, reportUnknownMemberType=false
# pyright: reportUnknownVariableType=false, reportUnknownArgumentType=false

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio


@dataclass(frozen=True)
class RasterInfo:
    west: float
    south: float
    east: float
    north: float
    width: int
    height: int
    pixel_width: float  # degrees
    pixel_height: float  # degrees, positive (rows run north to south)


def read_raster_info(path: Path) -> RasterInfo:
    """Metadata only; no pixels are decoded."""
    with rasterio.open(path) as ds:
        t = ds.transform
        if t.b != 0 or t.d != 0 or t.e >= 0:
            raise ValueError(f"{path.name}: expected a north-up, unrotated raster")
        b = ds.bounds
        return RasterInfo(
            west=float(b.left),
            south=float(b.bottom),
            east=float(b.right),
            north=float(b.top),
            width=int(ds.width),
            height=int(ds.height),
            pixel_width=float(t.a),
            pixel_height=float(-t.e),
        )


def read_raster(path: Path) -> np.ndarray[tuple[int, int], np.dtype[np.float32]]:
    """Band 1, decoded into memory."""
    with rasterio.open(path) as ds:
        return np.asarray(ds.read(1), dtype=np.float32)

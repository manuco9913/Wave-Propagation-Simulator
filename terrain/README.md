# Terrain data

Real elevation data for developing and testing the terrain preprocessing step (#35).
Chosen per `research/terrain-data/research.md`: **Copernicus DEM GLO-30**, 1°×1° COG tiles,
pre-downloaded and read locally (no network at query time).

## Area of interest: Israel

| | |
|---|---|
| Tiles | N29–N33 × E034–E035 (9 tiles; `N33 E034` is open sea and not published) |
| Coverage | 29°–34°N, 34°–36°E. Covers all of Israel (Eilat 29.5°N to Metula 33.3°N, coast to Golan) |
| Size | ~317 MB total, 6–44 MB per tile (N32 E034 is mostly sea) |
| Elevation range | −428 m (Dead Sea) to 2,811 m (Mt Hermon) |

The AOI is a closed list in `manifest.json`. A scenario entity whose radius reaches outside it
has no terrain. #35 should fail fast with a clear error, as recommended in the research.
To widen the AOI, add tiles to the manifest (name, URL, size, SHA-256) and re-run the fetch.

## Getting the tiles

```bash
python terrain/fetch.py           # → ./terrain-cache/copernicus-dem-30m/<tile>/<tile>.tif
python terrain/fetch.py --check   # verify SHA-256 of what's on disk, no network
```

Stdlib only. Existing tiles with a matching checksum are skipped. `terrain-cache/` is
git-ignored. Per the research, tiles are never committed or baked into an image: mount the
directory read-only instead. The layout mirrors the research's recommended directory layout, so
`gdalbuildvrt terrain-cache/mosaic.vrt terrain-cache/copernicus-dem-30m/*/*.tif` works directly.

## Source and license

- **Source:** Copernicus DEM GLO-30, public AWS bucket `s3://copernicus-dem-30m/`
  (no credentials), retrieved 2026-10-06. Checksums in `manifest.json`.
- **License:** Copernicus DEM licence. Free of charge for any use, including commercial.
  **Attribution is required** wherever the data or derived results are shown:

  > © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under
  > COPERNICUS by the European Union and ESA; all rights reserved

  The UI showing heatmaps derived from this data should carry that line (e.g. in the map
  attribution control).

## Format facts #35 must handle

Verified on the downloaded tiles. Two of these differ from what the research assumed:

| Property | Value | Note |
|---|---|---|
| Format | GeoTIFF COG, 1024×1024 internal blocks, DEFLATE, overviews 2/4/8 | Good for windowed reads |
| Grid | 3600×3600 per tile, 1 arc-second, EPSG:4326 | |
| dtype | float32, metres | |
| Vertical datum | EGM2008 geoid (orthometric / AMSL) | Not ellipsoidal. See the research's open questions |
| Surface | DSM (top of canopy and buildings), not bare earth | |
| **`nodata`** | **unset** | The research's `-32768` fallback never triggers. There are no NaN voids in this AOI |
| Sea | `0.0`, or small negative values near the coast | |
| **Pixel registration** | **`AREA_OR_POINT=Point`** | Pixel centres sit on whole arc-seconds, and the GeoTIFF origin is offset half a pixel (e.g. west edge `33.99986…`). Use the dataset's transform as-is; don't rebuild one from the tile name |

**Sampling performance** (this sandbox, nearest-pixel, NumPy fancy indexing):

- Decoding all 9 tiles into one in-memory mosaic (18000×7200 float32, 518 MB): about 9 s.
- 7.2M points (one entity at 0.1° × 2,000 steps): about 1.5 s.

10 entities therefore fit well under the PRD's "well under a minute" budget with the tiles as
published, so no re-tiling or format conversion is needed.

## Test fixture

`fixtures/jerusalem_dead_sea.tif` (630 KB, committed) is a pixel-aligned clip of tile
`N31 E035`: 31.72°–31.78°N, 35.20°–35.50°E, 1080×216 px, about 1,250 m of relief from the
Jerusalem hills down to the Dead Sea. Same CRS, dtype, datum and `Point` registration as the source.
Internal blocks are 256×256 because the clip is small.

`fixtures/jerusalem_dead_sea.json` holds its bounds plus reference points (lat/lon → row/col →
elevation, read from the source tile). Tests for #35 can assert against these without
downloading anything.

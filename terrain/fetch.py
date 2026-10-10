"""Download the terrain tiles listed in terrain/manifest.json and verify their checksums.

Stdlib only, so it runs before any project dependencies are installed (e.g. on the
machine that prepares an air-gapped bundle). Already-present tiles with a matching
SHA-256 are skipped, so re-running is cheap.

    python terrain/fetch.py                 # download into ./terrain-cache
    python terrain/fetch.py --dest /data    # download elsewhere
    python terrain/fetch.py --check         # verify only, no network
"""

import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

MANIFEST = Path(__file__).resolve().parent / "manifest.json"
DEFAULT_DEST = Path(__file__).resolve().parents[1] / "terrain-cache"
CHUNK = 1 << 20


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while block := f.read(CHUNK):
            digest.update(block)
    return digest.hexdigest()


def tile_path(dest: Path, name: str) -> Path:
    # Mirrors the bucket layout: <dest>/copernicus-dem-30m/<name>/<name>.tif
    return dest / "copernicus-dem-30m" / name / f"{name}.tif"


def is_valid(path: Path, sha256: str) -> bool:
    return path.is_file() and sha256_of(path) == sha256


def download(url: str, path: Path, sha256: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".tif.part")
    with urllib.request.urlopen(url) as response, partial.open("wb") as out:
        while block := response.read(CHUNK):
            out.write(block)
    if sha256_of(partial) != sha256:
        partial.unlink()
        raise RuntimeError(f"checksum mismatch for {url}")
    partial.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    parser.add_argument("--check", action="store_true", help="verify only; do not download")
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    failures: list[str] = []
    for tile in manifest["tiles"]:
        path = tile_path(args.dest, tile["name"])
        if is_valid(path, tile["sha256"]):
            print(f"ok       {tile['name']}")
        elif args.check:
            print(f"MISSING  {tile['name']}")
            failures.append(tile["name"])
        else:
            print(f"fetch    {tile['name']} ({tile['bytes'] / 1e6:.1f} MB)")
            try:
                download(tile["url"], path, tile["sha256"])
            except Exception as e:
                print(f"FAILED   {tile['name']}: {e}")
                failures.append(tile["name"])

    total = len(manifest["tiles"])
    print(f"\n{total - len(failures)}/{total} tiles ok in {args.dest}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

/** One height slice as served by GET .../slices/{height_m} (contracts/api.md, binary format). */
export interface Slice {
  width: number;
  height: number;
  /** dBm range of the finite cells; NaN when every cell is null. */
  min: number;
  max: number;
  bounds: { west: number; south: number; east: number; north: number };
  /** Row-major, row 0 at the north edge; NaN = outside every entity's radius. */
  data: Float32Array;
}

const HEADER_BYTES = 56;
const MAGIC = "WPS1";

export function parseSlice(buf: ArrayBuffer): Slice {
  if (buf.byteLength < HEADER_BYTES) throw new Error("not a slice: too short");
  const view = new DataView(buf);
  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  if (magic !== MAGIC || view.getUint16(4, true) !== 1) {
    throw new Error("not a slice: bad magic or version");
  }
  const width = view.getUint32(6, true);
  const height = view.getUint32(10, true);
  if (buf.byteLength !== HEADER_BYTES + width * height * 4) {
    throw new Error("not a slice: body size doesn't match the header");
  }
  return {
    width,
    height,
    min: view.getFloat32(14, true),
    max: view.getFloat32(18, true),
    bounds: {
      west: view.getFloat64(22, true),
      south: view.getFloat64(30, true),
      east: view.getFloat64(38, true),
      north: view.getFloat64(46, true),
    },
    data: new Float32Array(buf, HEADER_BYTES, width * height),
  };
}

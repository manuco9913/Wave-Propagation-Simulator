import { parseSlice } from "./slice";

function encode(width: number, height: number, data: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(56 + width * height * 4);
  const view = new DataView(buf);
  [0x57, 0x50, 0x53, 0x31].forEach((b, i) => view.setUint8(i, b));
  view.setUint16(4, 1, true);
  view.setUint32(6, width, true);
  view.setUint32(10, height, true);
  view.setFloat32(14, -90, true);
  view.setFloat32(18, -40, true);
  [35, 32, 35.1, 32.2].forEach((v, i) => view.setFloat64(22 + i * 8, v, true));
  new Float32Array(buf, 56).set(data);
  return buf;
}

test("reads the 56-byte header and the row-major float32 grid after it", () => {
  const slice = parseSlice(encode(3, 2, [1, 2, 3, 4, NaN, 6]));

  expect(slice).toMatchObject({ width: 3, height: 2, min: -90, max: -40 });
  expect(slice.bounds).toEqual({ west: 35, south: 32, east: 35.1, north: 32.2 });
  expect(Array.from(slice.data)).toEqual([1, 2, 3, 4, NaN, 6]);
});

test("rejects a body that isn't a version-1 slice", () => {
  const bad = encode(1, 1, [0]);
  new DataView(bad).setUint8(0, 0);

  expect(() => parseSlice(bad)).toThrow(/not a slice/);
  expect(() => parseSlice(new ArrayBuffer(10))).toThrow(/not a slice/);
});

import * as maplibregl from "maplibre-gl";
import type { Slice } from "../run/slice";

/**
 * Draws a slice as an R32F texture on a quad over its bounding box; a fragment shader maps dBm
 * to colour, so recolouring never re-uploads data. NaN cells (outside every radius) are
 * transparent. Slice rows are evenly spaced in Web Mercator y, so the texture maps linearly.
 * Mercator projection only: vertices are 0..1 Mercator coordinates under `mainMatrix`.
 */

// Fixed sequential ramp, low -> high dBm (heatmap colours sit outside the UI tokens; a
// user-defined ramp is later work).
const RAMP: readonly [number, number, number][] = [
  [0.19, 0.07, 0.36],
  [0.13, 0.4, 0.55],
  [0.2, 0.66, 0.47],
  [0.99, 0.91, 0.15],
];
const OPACITY = 0.75;

const VERTEX = `#version 300 es
uniform mat4 u_matrix;
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform highp sampler2D u_data;
uniform float u_min;
uniform float u_max;
uniform vec3 u_ramp[${RAMP.length}];
uniform float u_opacity;
in vec2 v_uv;
out vec4 color;
void main() {
  float v = texture(u_data, v_uv).r;
  if (isnan(v)) discard;
  float t = clamp((v - u_min) / max(u_max - u_min, 1e-6), 0.0, 1.0) * ${RAMP.length - 1}.0;
  int i = int(min(floor(t), ${RAMP.length - 2}.0));
  vec3 rgb = mix(u_ramp[i], u_ramp[i + 1], t - float(i));
  color = vec4(rgb * u_opacity, u_opacity);
}`;

export interface HeatmapLayer extends maplibregl.CustomLayerInterface {
  setSlice(slice: Slice | null): void;
}

export function createHeatmapLayer(id: string): HeatmapLayer {
  let map: maplibregl.Map | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let texture: WebGLTexture | null = null;
  let buffer: WebGLBuffer | null = null;
  let current: Slice | null = null;
  let uploaded: Slice | null = null;

  function upload(ctx: WebGL2RenderingContext, slice: Slice) {
    const { west, south, east, north } = slice.bounds;
    const nw = maplibregl.MercatorCoordinate.fromLngLat([west, north]);
    const se = maplibregl.MercatorCoordinate.fromLngLat([east, south]);
    // x, y, u, v: a triangle strip over the bbox, texture row 0 at the north edge
    const quad = new Float32Array([
      nw.x,
      nw.y,
      0,
      0,
      se.x,
      nw.y,
      1,
      0,
      nw.x,
      se.y,
      0,
      1,
      se.x,
      se.y,
      1,
      1,
    ]);
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer);
    ctx.bufferData(ctx.ARRAY_BUFFER, quad, ctx.STATIC_DRAW);
    ctx.bindTexture(ctx.TEXTURE_2D, texture);
    ctx.pixelStorei(ctx.UNPACK_ALIGNMENT, 4);
    ctx.texImage2D(
      ctx.TEXTURE_2D,
      0,
      ctx.R32F,
      slice.width,
      slice.height,
      0,
      ctx.RED,
      ctx.FLOAT,
      slice.data,
    );
    // float textures aren't filterable everywhere; one texel per grid cell needs no filtering
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.NEAREST);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.NEAREST);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
    uploaded = slice;
  }

  return {
    id,
    type: "custom",
    renderingMode: "2d",

    onAdd(m, ctx) {
      map = m;
      gl = ctx;
      program = link(ctx, VERTEX, FRAGMENT);
      texture = ctx.createTexture();
      buffer = ctx.createBuffer();
    },

    onRemove(_m, ctx) {
      ctx.deleteProgram(program);
      ctx.deleteTexture(texture);
      ctx.deleteBuffer(buffer);
      map = gl = null;
    },

    setSlice(slice) {
      current = slice;
      map?.triggerRepaint();
    },

    render(ctx, args) {
      if (!current || !program || gl !== ctx) return;
      if (uploaded !== current) upload(ctx, current);
      ctx.useProgram(program);
      ctx.uniformMatrix4fv(
        ctx.getUniformLocation(program, "u_matrix"),
        false,
        args.defaultProjectionData.mainMatrix,
      );
      ctx.uniform1f(ctx.getUniformLocation(program, "u_min"), current.min);
      ctx.uniform1f(ctx.getUniformLocation(program, "u_max"), current.max);
      ctx.uniform3fv(ctx.getUniformLocation(program, "u_ramp"), RAMP.flat());
      ctx.uniform1f(ctx.getUniformLocation(program, "u_opacity"), OPACITY);
      ctx.activeTexture(ctx.TEXTURE0);
      ctx.bindTexture(ctx.TEXTURE_2D, texture);
      ctx.uniform1i(ctx.getUniformLocation(program, "u_data"), 0);
      ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer);
      const pos = ctx.getAttribLocation(program, "a_pos");
      const uv = ctx.getAttribLocation(program, "a_uv");
      ctx.enableVertexAttribArray(pos);
      ctx.vertexAttribPointer(pos, 2, ctx.FLOAT, false, 16, 0);
      ctx.enableVertexAttribArray(uv);
      ctx.vertexAttribPointer(uv, 2, ctx.FLOAT, false, 16, 8);
      ctx.enable(ctx.BLEND);
      ctx.blendFunc(ctx.ONE, ctx.ONE_MINUS_SRC_ALPHA);
      ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
    },
  };
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("heatmap: createShader failed");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`heatmap shader: ${gl.getShaderInfoLog(shader) ?? "compile failed"}`);
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`heatmap program: ${gl.getProgramInfoLog(program) ?? "link failed"}`);
  }
  return program;
}

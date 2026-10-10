import { BinWriter, binReader } from './bin.js';

export const DEM_MAGIC = 0x314d4544; // 'DEM1' little-endian
export const DEM_VERSION = 1;

export function encodeTerrain({ originX, originZ, step, cols, rows, heights }) {
  if (heights.length !== cols * rows) throw new Error('height grid size does not match cols*rows');
  const w = new BinWriter();
  w.u32(DEM_MAGIC);
  w.u16(DEM_VERSION);
  w.u16(0);
  w.f32(originX);
  w.f32(originZ);
  w.f32(step);
  w.u32(cols);
  w.u32(rows);
  for (let i = 0; i < heights.length; i++) w.f32(heights[i]);
  return w.bytes();
}

export function decodeTerrain(input) {
  const r = binReader(input);
  if (r.u32() !== DEM_MAGIC) throw new Error('not a DEM1 grid');
  const version = r.u16();
  r.u16();
  if (version !== DEM_VERSION) throw new Error(`terrain version ${version}, expected ${DEM_VERSION}`);
  const originX = r.f32();
  const originZ = r.f32();
  const step = r.f32();
  const cols = r.u32();
  const rows = r.u32();
  const heights = new Float32Array(cols * rows);
  for (let i = 0; i < heights.length; i++) heights[i] = r.f32();
  if (r.rest() !== 0) throw new Error('terrain has trailing bytes');
  return { originX, originZ, step, cols, rows, heights };
}

export function sampleGrid(grid, x, z) {
  const c = (x - grid.originX) / grid.step;
  const row = (z - grid.originZ) / grid.step;
  const c0 = Math.floor(c);
  const r0 = Math.floor(row);
  const tx = c - c0;
  const tz = row - r0;
  const h = (cc, rr) => {
    const cx = Math.max(0, Math.min(grid.cols - 1, cc));
    const ry = Math.max(0, Math.min(grid.rows - 1, rr));
    return grid.heights[ry * grid.cols + cx];
  };
  const h00 = h(c0, r0);
  const h10 = h(c0 + 1, r0);
  const h01 = h(c0, r0 + 1);
  const h11 = h(c0 + 1, r0 + 1);
  return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
}

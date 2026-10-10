import { PNG } from 'pngjs';
import { boundsFromBbox, makeProjection } from '../../src/shared/geo.js';

export function lonToTileX(lon, z) {
  return ((lon + 180) / 360) * 2 ** z;
}

export function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

export function tileRange(bbox, z) {
  return {
    z,
    x0: Math.floor(lonToTileX(bbox.west, z)),
    x1: Math.floor(lonToTileX(bbox.east, z)),
    y0: Math.floor(latToTileY(bbox.north, z)),
    y1: Math.floor(latToTileY(bbox.south, z)),
  };
}

export function readTerrarium(buffer) {
  return PNG.sync.read(buffer);
}

export function terrariumHeight(png, px, py) {
  const x = Math.max(0, Math.min(png.width - 1, px));
  const y = Math.max(0, Math.min(png.height - 1, py));
  const i = (Math.floor(y) * png.width + Math.floor(x)) * 4;
  return png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
}

export function sampleTerrarium(tiles, lon, lat, z) {
  const fx = lonToTileX(lon, z);
  const fy = latToTileY(lat, z);
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  const png = tiles.get(`${tx}_${ty}`);
  if (!png) return null;
  const px = (fx - tx) * png.width;
  const py = (fy - ty) * png.height;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const dx = px - x0;
  const dy = py - y0;
  const h00 = terrariumHeight(png, x0, y0);
  const h10 = terrariumHeight(png, x0 + 1, y0);
  const h01 = terrariumHeight(png, x0, y0 + 1);
  const h11 = terrariumHeight(png, x0 + 1, y0 + 1);
  const h = h00 * (1 - dx) * (1 - dy) + h10 * dx * (1 - dy) + h01 * (1 - dx) * dy + h11 * dx * dy;
  if (!Number.isFinite(h) || h < -500 || h > 9000) return null;
  return h;
}

function fillVoids(heights, cols, rows) {
  const index = (c, r) => r * cols + c;
  for (let pass = 0; pass < 8; pass++) {
    const next = heights.slice();
    let missing = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = index(c, r);
        if (Number.isFinite(heights[i])) continue;
        let sum = 0;
        let n = 0;
        for (let rr = r - 1; rr <= r + 1; rr++) {
          for (let cc = c - 1; cc <= c + 1; cc++) {
            if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
            const h = heights[index(cc, rr)];
            if (Number.isFinite(h)) { sum += h; n += 1; }
          }
        }
        if (n) next[i] = sum / n;
        else missing += 1;
      }
    }
    heights.set(next);
    if (!missing) break;
  }
  for (let i = 0; i < heights.length; i++) if (!Number.isFinite(heights[i])) heights[i] = 4;
}

export function makeGrid(area, sampleLonLat) {
  const proj = makeProjection(area.origin[0], area.origin[1]);
  const bounds = boundsFromBbox(proj, area.bbox);
  const step = area.terrainStep || 16;
  const originX = Math.floor(bounds.minX / step) * step - step;
  const originZ = Math.floor(bounds.minZ / step) * step - step;
  const cols = Math.ceil((bounds.maxX + step - originX) / step) + 1;
  const rows = Math.ceil((bounds.maxZ + step - originZ) / step) + 1;
  const heights = new Float32Array(cols * rows);
  let valid = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = originX + c * step;
      const z = originZ + r * step;
      const [lon, lat] = proj.unproject(x, z);
      const h = sampleLonLat(lon, lat);
      if (h == null || !Number.isFinite(h)) heights[r * cols + c] = NaN;
      else {
        heights[r * cols + c] = h;
        valid += 1;
      }
    }
  }
  fillVoids(heights, cols, rows);
  let min = Infinity;
  let max = -Infinity;
  for (const h of heights) {
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return { originX, originZ, step, cols, rows, heights, valid, total: cols * rows, min, max };
}

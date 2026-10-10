// Small RGBA8 image helpers for the texture packer. Images are { width, height, data }.

export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const LUT = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));

// Halves with a 2x2 box filter. Colour is averaged in linear light, normals as vectors.
function halve(img, normal) {
  const w = img.width >> 1;
  const h = img.height >> 1;
  const src = img.data;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const taps = [((2 * y) * img.width + 2 * x) * 4, ((2 * y) * img.width + 2 * x + 1) * 4,
        ((2 * y + 1) * img.width + 2 * x) * 4, ((2 * y + 1) * img.width + 2 * x + 1) * 4];
      if (normal) {
        let nx = 0; let ny = 0; let nz = 0;
        for (const t of taps) { nx += src[t] / 127.5 - 1; ny += src[t + 1] / 127.5 - 1; nz += src[t + 2] / 127.5 - 1; }
        const len = Math.hypot(nx, ny, nz) || 1;
        out[o] = Math.round((nx / len + 1) * 127.5);
        out[o + 1] = Math.round((ny / len + 1) * 127.5);
        out[o + 2] = Math.round((nz / len + 1) * 127.5);
        out[o + 3] = 255;
      } else {
        for (let c = 0; c < 3; c++) {
          const v = (LUT[src[taps[0] + c]] + LUT[src[taps[1] + c]] + LUT[src[taps[2] + c]] + LUT[src[taps[3] + c]]) / 4;
          out[o + c] = Math.round(linearToSrgb(v) * 255);
        }
        out[o + 3] = (src[taps[0] + 3] + src[taps[1] + 3] + src[taps[2] + 3] + src[taps[3] + 3] + 2) >> 2;
      }
    }
  }
  return { width: w, height: h, data: out };
}

// Bilinear resample to size x size, wrapping at the edges so tiling stays seamless.
function bilinear(img, size) {
  const out = new Uint8Array(size * size * 4);
  const { width: w, height: h, data } = img;
  for (let y = 0; y < size; y++) {
    const fy = ((y + 0.5) * h) / size - 0.5;
    const y0 = Math.floor(fy); const ty = fy - y0;
    const ya = ((y0 % h) + h) % h; const yb = (ya + 1) % h;
    for (let x = 0; x < size; x++) {
      const fx = ((x + 0.5) * w) / size - 0.5;
      const x0 = Math.floor(fx); const tx = fx - x0;
      const xa = ((x0 % w) + w) % w; const xb = (xa + 1) % w;
      for (let c = 0; c < 4; c++) {
        const a = data[(ya * w + xa) * 4 + c]; const b = data[(ya * w + xb) * 4 + c];
        const d = data[(yb * w + xa) * 4 + c]; const e = data[(yb * w + xb) * 4 + c];
        out[(y * size + x) * 4 + c] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty);
      }
    }
  }
  return { width: size, height: size, data: out };
}

export function resizeWrap(img, size, { normal = false } = {}) {
  let cur = { width: img.width, height: img.height, data: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
  while (cur.width >= size * 2 && cur.height >= size * 2) cur = halve(cur, normal);
  return cur.width === size && cur.height === size ? cur : bilinear(cur, size);
}

// Mean colour in linear light; the shader divides by it to turn a photo into detail.
export function linearMean(img) {
  const sum = [0, 0, 0];
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) sum[c] += LUT[img.data[i * 4 + c]];
  return sum.map((s) => s / n);
}

// Facade photo with its glass mask in alpha.
export function packFacade(color, mask) {
  const out = new Uint8Array(color.data);
  for (let i = 0; i < color.width * color.height; i++) out[i * 4 + 3] = mask.data[i * 4];
  return { width: color.width, height: color.height, data: out };
}

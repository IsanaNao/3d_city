// sRGB luminance of the Customs/HSBC pair from the fixed river camera.
// Y = 0.2126 R + 0.7152 G + 0.0722 B, channels in 0..1 (encoded sRGB, not linear).
// Reference frames are Wikimedia Commons night photographs, measured the same way
// and kept out of the repo. The close floodlit Customs frame is the calibration.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

export const srgbLuma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Medians from hand-placed patches on four Commons frames (1400–1920 px thumbs).
export const REFERENCE = {
  photos: [
    {
      id: 'Commons 2014.11.15.190948 Customs House close',
      wall: 0.423,
      highlight: 0.861,
      pier: 0.590,
      soffit: 0.086,
    },
    {
      id: 'Commons 2014.11.15.192101 HSBC dome',
      dome: 0.899,
      wall: 0.250,
    },
    {
      id: 'Commons The Customs House Shanghai Night View',
      wall: 0.204,
      cornice: 0.323,
    },
    {
      id: 'Commons 2014.11.15.192024 HSBC and Customs wide',
      hsbc: 0.220,
      customs: 0.226,
    },
  ],
  // Close floodlit frame, and the ratio asked for after tone mapping.
  target: { wall: 0.45, highlight: 0.85, recess: 0.12 },
};

// 1600×900, time=21, cam=-980,28,118, look=-1192,52,46. HSBC left, Customs centre.
export const RIVER_LANDMARKS = { x: 280, y: 430, w: 740, h: 200 };
// Extruded Bund blocks just north of Customs in the same frame.
export const RIVER_NEIGHBOURS = { x: 1120, y: 470, w: 280, h: 140 };

const median = (values) => {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// Split a facade rectangle into wall, highlight, and recess by sRGB luma.
// Sky, water, and the road are not warm, so they drop out.
export function classifyRegion(data, width, region) {
  const recess = [];
  const wall = [];
  const highlight = [];
  const histogram = Array.from({ length: 20 }, () => 0);
  let above85 = 0;
  let warm = 0;
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const i = (y * width + x) * 4;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const Y = srgbLuma(r, g, b);
      if (!(r > b + 0.03 && r + g > 0.06)) continue;
      warm += 1;
      histogram[Math.min(19, Math.floor(Y * 20))] += 1;
      if (Y > 0.85) above85 += 1;
      if (Y < 0.22) recess.push(Y);
      else if (Y > 0.70) highlight.push(Y);
      else wall.push(Y);
    }
  }
  return {
    wall: median(wall),
    highlight: median(highlight),
    recess: median(recess),
    above85,
    warm,
    wallFractionAbove85: wall.length ? above85 / (wall.length + highlight.length + recess.length) : 0,
    counts: { wall: wall.length, highlight: highlight.length, recess: recess.length },
    histogram,
  };
}

export function readPng(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  return { width: png.width, height: png.height, data: png.data };
}

export function measureFile(file, region = RIVER_LANDMARKS, neighbours = RIVER_NEIGHBOURS) {
  const { width, data } = readPng(file);
  const landmarks = classifyRegion(data, width, region);
  const row = classifyRegion(data, width, neighbours);
  return { file, width, landmarks, neighbours: row, target: REFERENCE.target };
}

export function formatMeasure(result) {
  const t = result.target;
  const L = result.landmarks;
  const n = result.neighbours;
  const fmt = (v) => (v == null ? '—' : v.toFixed(3));
  const lines = [
    `landmarks wall ${fmt(L.wall)}  highlight ${fmt(L.highlight)}  recess ${fmt(L.recess)}`,
    `target     wall ${t.wall.toFixed(3)}  highlight ${t.highlight.toFixed(3)}  recess ${t.recess.toFixed(3)}`,
    `neighbours wall ${fmt(n.wall)}  (landmark should sit just above this)`,
    `facade pixels above 0.85 luma: ${(L.wallFractionAbove85 * 100).toFixed(1)}% of warm samples`,
    `counts wall ${L.counts.wall} highlight ${L.counts.highlight} recess ${L.counts.recess}`,
    `histogram ${L.histogram.map((c, i) => `${(i / 20).toFixed(2)}:${c}`).join(' ')}`,
  ];
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/measure/bund-night-luma.mjs <png>');
    process.exit(2);
  }
  console.log(formatMeasure(measureFile(file)));
}

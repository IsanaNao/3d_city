import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRegion, REFERENCE, srgbLuma } from '../measure/bund-night-luma.mjs';

const fill = (data, x, y, w, width, rgb) => {
  for (let yy = y; yy < y + 10; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * width + xx) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
};

test('bund night classifier reports wall, highlight, and recess luma', () => {
  const width = 40;
  const height = 10;
  const data = new Uint8Array(width * height * 4);
  fill(data, 0, 0, 28, width, [160, 106, 21]);
  fill(data, 28, 0, 6, width, [242, 215, 143]);
  fill(data, 34, 0, 6, width, [45, 29, 8]);
  const got = classifyRegion(data, width, { x: 0, y: 0, w: width, h: height });
  assert.ok(Math.abs(got.wall - 0.45) < 0.03, `wall ${got.wall}`);
  assert.ok(Math.abs(got.highlight - 0.85) < 0.04, `highlight ${got.highlight}`);
  assert.ok(Math.abs(got.recess - 0.12) < 0.03, `recess ${got.recess}`);
  assert.equal(got.above85, 0);
  assert.equal(REFERENCE.target.wall, 0.45);
  assert.equal(REFERENCE.target.highlight, 0.85);
  assert.equal(REFERENCE.target.recess, 0.12);
  const amber = srgbLuma(160 / 255, 106 / 255, 21 / 255);
  assert.ok(amber > 0.40 && amber < 0.50);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { FACADE_LAYERS, GROUND_LAYERS, SOURCES, WALL_LAYERS, textureFiles } from '../../src/shared/textures.js';
import { linearMean, packFacade, resizeWrap } from '../assets/image.mjs';

const layers = [...WALL_LAYERS, ...GROUND_LAYERS, ...FACADE_LAYERS];

test('every photo texture names a CC0 source and a stable layer', () => {
  const keys = layers.map((l) => l.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const layer of layers) {
    const source = SOURCES[layer.source];
    assert.equal(source.license, 'CC0 1.0');
    assert.match(source.url(layer.id), /^https:\/\//);
    assert.ok(layer.use);
  }
  assert.deepEqual(WALL_LAYERS.map((l) => l.key), [
    'tile', 'mosaic', 'brick', 'brick_mixed', 'concrete', 'cladding', 'stone', 'plaster', 'metal', 'roof',
  ]);
  assert.deepEqual(GROUND_LAYERS.map((l) => l.key), ['asphalt', 'pavers', 'grass', 'pavement']);
});

test('facade photos carry a measured window grid', () => {
  for (const layer of FACADE_LAYERS) {
    assert.ok(layer.grid[0] >= 2 && layer.grid[1] >= 2);
    assert.ok(layer.floor > 2 && layer.floor < 8);
    assert.ok(layer.aspect > 0.2 && layer.aspect < 3);
    const [x0, x1, y0, y1] = layer.win;
    assert.ok(x0 >= 0 && x1 <= 1 && y0 >= 0 && y1 <= 1 && x1 > x0 && y1 > y0);
  }
});

test('detail textures are resized in linear light and facades keep their glass mask', () => {
  const solid = { width: 2, height: 2, data: Uint8Array.from([255, 128, 0, 255, 255, 128, 0, 255, 255, 128, 0, 255, 255, 128, 0, 255]) };
  const mean = linearMean(solid);
  assert.ok(Math.abs(mean[0] - 1) < 1e-6);
  assert.ok(mean[1] > 0.2 && mean[1] < 0.3);
  const big = { width: 4, height: 4, data: new Uint8Array(4 * 4 * 4) };
  for (let i = 0; i < 16; i++) big.data.set([i * 16, 0, 0, 255], i * 4);
  const small = resizeWrap(big, 2);
  assert.equal(small.width, 2);
  assert.equal(small.height, 2);
  const mask = { width: 2, height: 2, data: Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]) };
  const packed = packFacade(solid, mask);
  assert.equal(packed.data[3], 255);
  assert.equal(packed.data[7], 0);
  assert.equal(packed.data[0], 255);
});

test('a fetched manifest matches the catalog', () => {
  const file = new URL('../../public/textures/manifest.json', import.meta.url);
  if (!fs.existsSync(file)) return;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(manifest.license, 'CC0 1.0');
  for (const [name, list] of [['wall', WALL_LAYERS], ['ground', GROUND_LAYERS], ['facade', FACADE_LAYERS]]) {
    assert.deepEqual(manifest[name].map((l) => l.key), list.map((l) => l.key));
    for (const layer of manifest[name]) {
      assert.equal(layer.license, 'CC0 1.0');
      assert.equal(layer.url, SOURCES[layer.source].url(layer.id));
      assert.equal(layer.mean.length, 3);
    }
  }
  for (const name of Object.values(textureFiles)) {
    if (name.endsWith('.ktx2')) assert.ok(fs.existsSync(new URL(`../../public/textures/${name}`, import.meta.url)));
  }
});

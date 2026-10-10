import assert from 'node:assert/strict';
import test from 'node:test';
import { TILE, makeProjection, tileOf } from '../../src/shared/geo.js';
import { KIND } from '../../src/shared/kinds.js';
import { buildBuildingGeometry } from '../../src/shared/meshbuild.js';
import { classifyKind, defaultHeight, resolveVertical } from '../../src/shared/heights.js';
import { daylight, nightFactor, sunVector } from '../../src/shared/sun.js';
import { decodeTerrain, encodeTerrain, sampleGrid } from '../../src/shared/terrain.js';
import { decodeTile, encodeTile } from '../../src/shared/tileformat.js';

test('projection round trip stays within a centimetre', () => {
  const proj = makeProjection(121.49, 31.24);
  const [x, z] = proj.project(121.505, 31.233);
  const [lon, lat] = proj.unproject(x, z);
  assert.ok(Math.abs(lon - 121.505) < 1e-8);
  assert.ok(Math.abs(lat - 31.233) < 1e-8);
  assert.equal(TILE, 256);
  assert.deepEqual(tileOf(100, -300), [0, -2]);
});

test('missing heights fall back, and known towers keep their public height', () => {
  const house = resolveVertical({ building: 'house' }, 80);
  assert.equal(house.top, 9);
  assert.equal(defaultHeight({ building: 'warehouse' }), 11);
  const tower = resolveVertical({ name: '上海中心大厦', building: 'yes' }, 4000);
  assert.equal(tower.top, 632);
  assert.equal(classifyKind({ name: '上海中心大厦', building: 'yes' }, tower.top), KIND.LANDMARK);
  const levels = resolveVertical({ building: 'apartments', 'building:levels': '18' }, 500);
  assert.ok(Math.abs(levels.top - 54.9) < 0.2);
  assert.equal(classifyKind({ historic: 'yes', building: 'yes' }, 24), KIND.HISTORIC);
});

test('tile binary round trip keeps Chinese names and boundary flags', () => {
  const bytes = encodeTile({
    tx: -1,
    tz: 2,
    buildings: [{
      kind: KIND.HISTORIC,
      storeys: 6,
      flags: 0,
      baseY: 4.5,
      topY: 28,
      color: 0xe7d3b4,
      name: '外滩',
      rings: [{ points: [[0, 0], [12, 0], [12, 8], [0, 8]], flags: [0, 0, 0, 1] }],
    }],
    land: [{ kind: 2, rings: [[[0, 0], [6, 0], [6, 4]]] }],
    roads: {
      verts: [0, 1, 2, 0.5, 3, 1, 0],
      indices: [0, 0, 0],
    },
    props: [{ kind: 5, variant: 2, x: 1, y: 3, z: 4, rot: 0.5, scale: 6, extra: 1.4 }],
  });
  const tile = decodeTile(bytes);
  assert.equal(tile.tx, -1);
  assert.equal(tile.tz, 2);
  assert.equal(tile.buildings[0].name, '外滩');
  assert.equal(tile.buildings[0].rings[0].flags[3], 1);
  assert.equal(tile.buildings[0].rings[0].points.length, 8);
  assert.equal(tile.land[0].kind, 2);
  assert.equal(tile.roads.verts.length, 7);
  assert.equal(tile.roads.indices[0], 0);
  assert.equal(tile.props[0].scale, 6);
  assert.equal(tile.props[0].variant, 2);
});

test('terrain grid round trip and bilinear sample', () => {
  const heights = Float32Array.from([0, 10, 0, 10]);
  const bytes = encodeTerrain({ originX: 0, originZ: 0, step: 10, cols: 2, rows: 2, heights });
  const grid = decodeTerrain(bytes);
  assert.equal(sampleGrid(grid, 0, 0), 0);
  assert.equal(sampleGrid(grid, 10, 0), 10);
  assert.ok(Math.abs(sampleGrid(grid, 5, 0) - 5) < 1e-4);
});

test('south wall faces south and the roof faces up', () => {
  const geo = buildBuildingGeometry([{
    kind: KIND.RESIDENTIAL,
    storeys: 3,
    flags: 0,
    baseY: 0,
    topY: 12,
    color: 0xffffff,
    name: '里弄',
    rings: [{ points: [[-4, 6], [4, 6], [4, -6], [-4, -6]], flags: [0, 0, 0, 0] }],
  }]);
  let south = 0;
  let southCount = 0;
  let roof = 0;
  let roofCount = 0;
  for (let i = 0; i < geo.position.length; i += 3) {
    const y = geo.position[i + 1];
    const z = geo.position[i + 2];
    if (z > 5.5 && Math.abs(geo.normal[i + 2]) > 0.5) {
      south += geo.normal[i + 2];
      southCount += 1;
    }
    if (y > 11.2 && geo.normal[i + 1] > 0.5) {
      roof += geo.normal[i + 1];
      roofCount += 1;
    }
  }
  assert.ok(southCount > 0);
  assert.ok(south / southCount > 0.8);
  assert.ok(roofCount > 0);
  assert.ok(roof / roofCount > 0.8);
});

test('noon in June is high, midnight is night, dusk turns lights on early', () => {
  const noon = sunVector(12, 172, 31.23);
  const midnight = sunVector(0, 172, 31.23);
  assert.ok(noon.altitude * 180 / Math.PI > 70);
  assert.ok(noon.y > 0.9);
  assert.ok(midnight.altitude < 0);
  assert.ok(nightFactor(noon.altitude) < 0.05);
  assert.ok(nightFactor(midnight.altitude) > 0.9);
  assert.ok(daylight(noon.altitude) > 0.9);
  const duskAlt = 3 * Math.PI / 180;
  assert.ok(nightFactor(duskAlt) > 0.35);
  assert.ok(daylight(duskAlt) > 0.05);
});

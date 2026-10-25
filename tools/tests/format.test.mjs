import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TILE, makeProjection, tileOf } from '../../src/shared/geo.js';
import { KIND, ROOF } from '../../src/shared/kinds.js';
import { buildBuildingGeometry } from '../../src/shared/meshbuild.js';
import { classifyKind, defaultHeight, resolveVertical } from '../../src/shared/heights.js';
import { daylight, duskHaze, nightFactor, sunVector } from '../../src/shared/sun.js';
import { NAMED_TOWERS } from '../../src/shared/towers.js';
import { CROWN_RGB, PEARL_SCHEMES, pearlShow, SCHEME_RGB } from '../../src/shared/show.js';
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
      roofShape: ROOF.DOME,
      roofHeight: 6.5,
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
  assert.equal(tile.buildings[0].roofShape, ROOF.DOME);
  assert.equal(tile.buildings[0].roofHeight, 6.5);
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
  assert.equal(duskHaze(70, 'dusk'), 1);
  assert.equal(duskHaze(6, 'clear'), 0);
  assert.ok(duskHaze(70, '') < 0.05);
  // Golden hour is hazy but not fogged in; the blue hour after it is clear.
  assert.ok(duskHaze(6, '') > 0.4);
  assert.ok(duskHaze(-5, '') < 0.05);
  assert.ok(duskHaze(-20, '') < 0.05);
  const pinned = pearlShow(21, 'blue');
  assert.equal(pinned.name, 'blue');
  assert.equal(pinned.fade, 0);
  assert.deepEqual(pearlShow(21, 'blue'), pearlShow(21, 'blue'));
  assert.notEqual(pearlShow(21, '').name, pearlShow(21.4, '').name);
});

// A typo in a name pattern silently does nothing, so every entry must find
// a building in the compiled tiles. Skipped when the tiles are not built.
test('every named-tower pattern matches a building in the tiles', (t) => {
  const dir = new URL('../../public/tiles/bund/', import.meta.url);
  if (!fs.existsSync(new URL('manifest.json', dir))) { t.skip('no compiled tiles'); return; }
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', dir)));
  const names = new Set();
  for (const k of manifest.tiles) {
    const b = fs.readFileSync(new URL(`t_${k}.bin`, dir));
    for (const x of decodeTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).buildings) if (x.name) names.add(x.name);
  }
  for (const entry of NAMED_TOWERS) {
    assert.ok([...names].some((n) => entry.test.test(n)), `${entry.test} matches nothing`);
  }
});

test('pearl show cycles through colours and the four moving patterns', () => {
  const names = new Set();
  for (let h = 0; h < 24; h += 1 / 3) names.add(pearlShow(h + 0.01, '').name);
  for (const n of ['gradient', 'wave', 'spin', 'alternate']) assert.ok(names.has(n), n);
  assert.equal(SCHEME_RGB.length, PEARL_SCHEMES.length);
  assert.equal(CROWN_RGB.length, PEARL_SCHEMES.length);
  // Patterns are pure functions of the clock and stay slow: the phase only
  // moves 0.15 of a slot in three scene minutes.
  assert.deepEqual(pearlShow(21.1, ''), pearlShow(21.1, ''));
  assert.ok(Math.abs(pearlShow(21.15, '').pattern - pearlShow(21.1, '').pattern) < 0.16);
  const pinned = pearlShow(3.7, 'spin');
  assert.equal(pinned.name, 'spin');
  assert.equal(pinned.next, pinned.scheme);
  assert.equal(pearlShow(21, 'nonsense').name, pearlShow(21, '').name);
});

function box(x0, z0, x1, z1) {
  return [{ points: [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], flags: [0, 0, 0, 0] }];
}

function part(rings, baseY, topY, extra = {}) {
  return { kind: KIND.OFFICE, storeys: 10, flags: 0, baseY, topY, color: 0xcccccc, name: '', rings, ...extra };
}

function wallArea(geo, test) {
  let area = 0;
  for (let i = 0; i < geo.position.length; i += 9) {
    if (geo.wall[(i / 3) * 3 + 1] < 0) continue;
    const ax = geo.position[i]; const ay = geo.position[i + 1]; const az = geo.position[i + 2];
    const bx = geo.position[i + 3]; const by = geo.position[i + 4]; const bz = geo.position[i + 5];
    const cx = geo.position[i + 6]; const cy = geo.position[i + 7]; const cz = geo.position[i + 8];
    if (!test((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3)) continue;
    const ux = bx - ax; const uy = by - ay; const uz = bz - az;
    const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

test('stacked building parts draw a shared facade once instead of z-fighting', () => {
  const low = part(box(0, 0, 20, 10), 0, 30);
  const high = part(box(0, 0, 20, 10), 0, 90);
  const geo = buildBuildingGeometry([low, high]);
  const south = wallArea(geo, (x, y, z) => z > 9.9);
  assert.ok(Math.abs(south - 20 * 90) < 0.5, `south facade area ${south}`);
});

test('neighbouring parts hide the wall they share up to the lower roof', () => {
  const west = part(box(0, 0, 10, 10), 0, 20);
  const east = part(box(10, 0, 20, 10), 0, 50);
  const geo = buildBuildingGeometry([west, east]);
  const shared = wallArea(geo, (x) => Math.abs(x - 10) < 0.01);
  assert.ok(Math.abs(shared - 10 * 30) < 0.5, `shared wall area ${shared}`);
});

test('a dome roof rises to the tagged height and windows know their wall length', () => {
  const ring = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ring.push([Math.cos(a) * 10, -Math.sin(a) * 10]);
  }
  const geo = buildBuildingGeometry([part([{ points: ring, flags: new Uint8Array(24) }], 0, 40, {
    roofShape: ROOF.DOME, roofHeight: 8,
  })]);
  let top = 0;
  for (let i = 1; i < geo.position.length; i += 3) top = Math.max(top, geo.position[i]);
  assert.ok(Math.abs(top - 40) < 1e-3);
  const len = 2 * 10 * Math.sin(Math.PI / 24);
  let wallVerts = 0;
  for (let i = 0; i < geo.wall.length; i += 3) {
    if (geo.wall[i + 1] < 0) continue;
    wallVerts += 1;
    assert.ok(Math.abs(geo.wall[i + 1] - len) < 1e-3);
  }
  assert.ok(wallVerts > 0);
  const n0 = [geo.normal[0], geo.normal[2]];
  assert.ok(Math.abs(Math.hypot(n0[0], n0[1]) - 1) < 1e-3);
});

test('a tall office grows a setback crown above the roof', () => {
  const geo = buildBuildingGeometry([part(box(0, 0, 40, 30), 0, 120)]);
  let top = 0;
  for (let i = 1; i < geo.position.length; i += 3) top = Math.max(top, geo.position[i]);
  assert.ok(top > 128 && top < 170, `crown top ${top}`);
  const low = buildBuildingGeometry([part(box(0, 0, 40, 30), 0, 40)]);
  let lowTop = 0;
  for (let i = 1; i < low.position.length; i += 3) lowTop = Math.max(lowTop, low.position[i]);
  assert.ok(lowTop < 42, `short office top ${lowTop}`);
});

test('a tall tower keeps straight walls, with no made-up podium ledge', () => {
  const geo = buildBuildingGeometry([part(box(0, 0, 40, 30), 0, 160)]);
  // Every facade vertex stays on the footprint edge all the way up.
  for (let v = 0; v < geo.position.length / 3; v++) {
    if (geo.wall[v * 3 + 1] < 0 || geo.position[v * 3 + 1] > 159.9) continue;
    const x = geo.position[v * 3];
    const z = geo.position[v * 3 + 2];
    const onEdge = Math.abs(x) < 1e-3 || Math.abs(x - 40) < 1e-3 || Math.abs(z) < 1e-3 || Math.abs(z - 30) < 1e-3;
    assert.ok(onEdge, `wall vertex pulled in to (${x.toFixed(2)}, ${z.toFixed(2)})`);
  }
});

test('stacked parts of one tower share a facade and a floor grid', () => {
  const podium = part(box(0, 0, 60, 50), 0, 24, { color: 0x887766 });
  const shaft = part(box(10, 10, 50, 40), 24, 180, { color: 0x6688aa, flags: 0 });
  const geo = buildBuildingGeometry([podium, shaft]);
  const seeds = new Set();
  const bases = new Set();
  const colors = new Set();
  for (let v = 0; v < geo.seed.length; v++) {
    seeds.add(geo.seed[v]);
    bases.add(geo.base[v]);
  }
  // Facade triangles of the podium and of the shaft, away from parapets and crown.
  for (let v = 0; v < geo.seed.length; v += 3) {
    const mid = (geo.position[v * 3 + 1] + geo.position[v * 3 + 4] + geo.position[v * 3 + 7]) / 3;
    if (geo.wall[v * 3 + 1] >= 0 && (mid < 20 || (mid > 30 && mid < 170))) colors.add(geo.color[v * 3].toFixed(3));
  }
  assert.equal(seeds.size, 1, 'one facade seed for both parts');
  assert.deepEqual([...bases], [0], 'floors are counted from the podium base');
  assert.equal(colors.size, 1, 'both parts wear the tower colour');
  const apart = buildBuildingGeometry([part(box(0, 0, 20, 20), 0, 60), part(box(100, 0, 120, 20), 0, 90)]);
  assert.equal(new Set(apart.seed).size, 2, 'separate buildings keep their own facades');
});

test('a named Lujiazui tower gets its own glass tone and night style', () => {
  const citi = buildBuildingGeometry([part(box(0, 0, 40, 30), 0, 180, { name: '花旗集团大厦', color: 0xcccccc })]);
  // Odd = curtain wall, twos = night style: 1 media wall -> 1 + 2 * 1.
  assert.equal(citi.wall[2], 3);
  assert.notEqual(citi.color[0].toFixed(3), (0xcc / 255).toFixed(3), 'the table colour replaces the random one');
  const plain = buildBuildingGeometry([part(box(0, 0, 40, 30), 0, 180, { name: '某某大厦' })]);
  assert.ok(plain.wall[2] < 2, 'an unlisted tower has no named night style');
});

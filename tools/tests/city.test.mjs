import assert from 'node:assert/strict';
import test from 'node:test';
import { makeProjection } from '../../src/shared/geo.js';
import { approachIsGreen, createSim, prepareGraph, stepSim } from '../../src/sim/traffic.js';
import { decodeTile, encodeTile } from '../../src/shared/tileformat.js';
import { LAND } from '../../src/shared/kinds.js';
import { bankQuays, carveWater, collectEmbankments, compileDataset, settleGround } from '../pipeline/compile.mjs';
import { liftAlong, parseCity } from '../pipeline/osm.mjs';
import { clipPolygon, finalizeRing, offsetPolyline, polygonArea, resamplePolyline } from '../pipeline/geom.mjs';
import { buildRoadGraph } from '../pipeline/graph.mjs';

test('the Lujiazui ring stays a low deck and a viaduct ramp slopes down', () => {
  const proj = makeProjection(121.5, 31.24);
  const ring = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ring.push({ lat: 31.24 + Math.sin(a) * 0.00045, lon: 121.5 + Math.cos(a) * 0.0005 });
  }
  const parsed = parseCity([
    { type: 'way', id: 1, tags: { highway: 'footway', bridge: 'yes', layer: '3' }, geometry: ring },
    {
      type: 'way', id: 2,
      tags: { highway: 'trunk', bridge: 'yes', layer: '2', lanes: '2', name: '延安高架路' },
      geometry: [{ lat: 31.2336, lon: 121.47 }, { lat: 31.2336, lon: 121.484 }],
    },
    {
      type: 'way', id: 3,
      tags: { highway: 'trunk_link', bridge: 'yes', layer: '2', lanes: '1' },
      geometry: [{ lat: 31.2336, lon: 121.484 }, { lat: 31.2332, lon: 121.487 }],
    },
  ], proj, () => 4);
  const foot = parsed.roads.find((road) => road.ring);
  assert.ok(foot);
  assert.ok(foot.width >= 8);
  assert.ok(foot.lift > 5 && foot.lift < 8);
  const ramp = parsed.roads.find((road) => road.link);
  assert.equal(ramp.ramp, true);
  const lifts = liftAlong(ramp, ramp.points);
  assert.ok(lifts[0] > lifts.at(-1) + 4);
  assert.ok(lifts.at(-1) < 1);
});

test('resample keeps endpoints and inserts samples', () => {
  const pts = resamplePolyline([[0, 0], [25, 0]], 10);
  assert.equal(pts[0][0], 0);
  assert.equal(pts.at(-1)[0], 25);
  assert.ok(pts.length >= 3);
});

test('China drives on the right: eastbound traffic sits south of the centreline', () => {
  const lane = offsetPolyline([[0, 0], [80, 0]], 2.5);
  assert.ok(lane[0][1] > 2);
  assert.ok(lane[1][1] > 2);
  const northbound = offsetPolyline([[0, 0], [0, -80]], 2.5);
  assert.ok(northbound[0][0] > 2, 'northbound right-hand lane is to the east');
});

test('shared tile edges do not grow an interior wall', () => {
  const tile = { minX: 256, maxX: 512, minZ: -256, maxZ: 256 };
  const area = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
  const clipped = clipPolygon([[250, -8], [270, -8], [270, 8], [250, 8]], tile);
  const ring = finalizeRing(clipped, tile, area, true);
  assert.ok(ring.flags.includes(1));
  assert.ok(ring.points.some((p) => Math.abs(p[0] - 256) < 0.05));
});

test('a one-way road has a single direction and a signal holds eastbound traffic', () => {
  const graph = buildRoadGraph([
    {
      points: [[0, 0], [100, 0]],
      y: [4, 4],
      width: 12,
      speed: 10,
      cls: 1,
      oneway: true,
      drive: true,
      bridge: false,
    },
    {
      points: [[100, 0], [100, -40]],
      y: [4, 4],
      width: 12,
      speed: 10,
      cls: 1,
      oneway: false,
      drive: true,
      bridge: false,
    },
  ], [{ x: 100, z: 0 }]);
  const east = graph.edges.filter((edge) => edge.a !== undefined);
  const fromOrigin = graph.edges.filter((edge) => {
    const x0 = edge.points[0];
    const z0 = edge.points[2];
    return Math.hypot(x0, z0) < 5;
  });
  assert.equal(fromOrigin.length, 1);
  assert.ok(fromOrigin[0].points[2] > 1);
  void east;

  const simGraph = prepareGraph({ nodes: graph.nodes, edges: graph.edges });
  const sim = createSim(simGraph, { count: 1, seed: 2 });
  const edge = simGraph.edges.findIndex((item) => item.b === fromOrigin[0].b && item.length > 50);
  sim.cars[0].edge = edge;
  sim.cars[0].dist = 88;
  sim.cars[0].speed = 8;
  sim.time = 0;
  assert.equal(approachIsGreen(simGraph.edges[edge].head1, 0), false);
  // Stay inside the first 7s red phase for east-west traffic.
  for (let i = 0; i < 40; i++) stepSim(sim, 0.1);
  assert.equal(sim.cars[0].edge, edge);
  assert.ok(sim.cars[0].dist < 96);

  sim.time = 7;
  sim.cars[0].dist = 70;
  sim.cars[0].speed = 10;
  for (let i = 0; i < 40; i++) stepSim(sim, 0.1);
  assert.ok(sim.cars[0].edge !== edge || sim.cars[0].dist > 90);
});

test('followers do not pass the car ahead', () => {
  const prepared = prepareGraph({
    nodes: [
      { x: 0, y: 0, z: 0, signal: 0 },
      { x: 200, y: 0, z: 0, signal: 0 },
    ],
    edges: [{ a: 0, b: 1, speed: 12, cls: 1, points: [0, 0, 0, 200, 0, 0] }],
  });
  const sim = createSim(prepared, { count: 2, seed: 1 });
  sim.cars[0].edge = 0;
  sim.cars[0].dist = 40;
  sim.cars[0].speed = 10;
  sim.cars[0].rate = 1;
  sim.cars[1].edge = 0;
  sim.cars[1].dist = 48;
  sim.cars[1].speed = 0;
  sim.cars[1].rate = 0;
  for (let i = 0; i < 40; i++) stepSim(sim, 0.1);
  const follower = sim.cars.find((car) => car.rate === 1);
  const leader = sim.cars.find((car) => car.rate === 0);
  assert.ok(follower.dist + 3 < leader.dist);
});

test('a tiny city compiles into decodable chunks', () => {
  const origin = [121.5, 31.24];
  const proj = makeProjection(origin[0], origin[1]);
  const ll = (x, z) => {
    const [lon, lat] = proj.unproject(x, z);
    return { lon, lat };
  };
  const way = (id, tags, coords) => ({
    type: 'way',
    id,
    tags,
    geometry: coords.map(([x, z]) => ll(x, z)),
  });
  const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
  const elements = [
    way(1, { building: 'office', name: '沿江办公楼', height: '40' }, square(-40, -20, -10, 16)),
    way(2, { building: 'yes', name: '上海中心大厦' }, square(80, -25, 110, 10)),
    way(3, { highway: 'primary', lanes: '4', oneway: 'yes' }, [[-120, 30], [120, 30]]),
    way(4, { highway: 'secondary', oneway: 'no' }, [[0, -80], [0, 90]]),
    { type: 'node', id: 9, lon: ll(0, 30).lon, lat: ll(0, 30).lat, tags: { highway: 'traffic_signals' } },
    way(5, { natural: 'water', name: '黄浦江' }, square(20, -70, 70, 70)),
    way(6, { leisure: 'park', name: '外滩公园' }, square(-90, -70, -50, -30)),
    way(7, { railway: 'subway', ref: '2', tunnel: 'yes' }, [[-15, -120], [-15, 120]]),
  ];
  const grid = {
    originX: -400, originZ: -400, step: 40, cols: 20, rows: 20,
    heights: new Float32Array(400).fill(5),
  };
  const area = {
    id: 'test',
    name: '测试',
    description: '',
    bbox: { south: 31.235, west: 121.494, north: 31.245, east: 121.506 },
    origin,
    terrainStep: 40,
  };
  const city = compileDataset({ area, elements, grid, demSource: 'flat test' });
  assert.ok(city.manifest.counts.buildings >= 1);
  assert.ok(city.manifest.landmarks.some((item) => item.id === 'shanghai' && item.h >= 600));
  assert.ok(city.manifest.counts.tiles >= 1);
  assert.ok(city.roads.edges.some((edge) => edge.points.length >= 6));
  const east = city.roads.edges.find((edge) => edge.points[0] < -50 && edge.points[3] > edge.points[0]);
  assert.ok(east, 'eastbound edge exists');
  assert.ok(east.points[2] > 30, 'eastbound lane is south of z=30');
  assert.equal(city.rails.lines.length, 1);
  assert.equal(city.rails.lines[0].tunnel, true);
  assert.ok(city.manifest.waterLevel != null);
  assert.ok(Array.isArray(city.manifest.bridges));
  const tile = city.tiles.values().next().value;
  const bytes = encodeTileSafe(tile);
  assert.ok(bytes.length > 32);
});

test('building spikes in the elevation grid settle back to street level', () => {
  const cols = 8;
  const rows = 8;
  const heights = new Float32Array(cols * rows).fill(4);
  heights[3 * cols + 3] = 90;
  heights[3 * cols + 4] = 80;
  const grid = { originX: 0, originZ: 0, step: 10, cols, rows, heights };
  const ring = [[25, 25], [45, 25], [45, 45], [25, 45]];
  const settled = settleGround(grid, [ring]);
  assert.ok(settled.heights[3 * cols + 3] < 12);
  assert.equal(settled.heights[0], 4);
});

test('a sloped river is cut to one bed and the smeared bank is raised', () => {
  const cols = 24;
  const rows = 16;
  const step = 8;
  const heights = new Float32Array(cols * rows);
  heights.fill(12);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * step;
      const z = r * step;
      if (x > 60 && x < 120 && z > 12 && z < 100) heights[r * cols + c] = 7 - (x - 64) * 0.12;
    }
  }
  heights[1] = 14;
  heights[2 * cols + 6] = 3;
  const grid = { originX: 0, originZ: 0, step, cols, rows, heights };
  const hydro = carveWater(grid, [{ rings: [[[64, 16], [112, 16], [112, 96], [64, 96]]] }]);
  assert.ok(hydro.waterLevel < 6);
  const bed = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * step;
      const z = r * step;
      if (x > 70 && x < 104 && z > 24 && z < 88) bed.push(heights[r * cols + c]);
    }
  }
  assert.ok(bed.length > 8);
  assert.ok(bed.every((h) => Math.abs(h - bed[0]) < 0.001));
  assert.ok(bed[0] < hydro.waterLevel);
  assert.equal(heights[1], 14);
  assert.ok(heights[2 * cols + 6] > 8);
});

test('Suzhou Creek is buffered into water and the Huangpu centreline is not', () => {
  const proj = makeProjection(0, 0);
  const line = (id, name, lon1) => ({
    type: 'way',
    id,
    tags: { waterway: 'river', name },
    geometry: [
      { lon: 0, lat: 0 },
      { lon: lon1 * 0.5, lat: 0.0001 },
      { lon: lon1, lat: 0 },
    ],
  });
  const creek = parseCity([line(1, '苏州河', 0.008)], proj, () => 4);
  const water = creek.land.filter((f) => f.kind === LAND.WATER);
  assert.equal(water.length, 1);
  assert.ok(polygonArea(water[0].rings[0]) > 4000);
  const huangpu = parseCity([line(2, '黄浦江', 0.01)], proj, () => 4);
  assert.equal(huangpu.land.length, 0);
});

test('the Bund and Lujiazui shores keep a hard embankment where a park meets the water', () => {
  const water = {
    kind: LAND.WATER,
    rings: [[[-1300, -200], [-700, -200], [-700, 200], [-1300, 200]]],
  };
  const lines = collectEmbankments([water]);
  assert.ok(lines.some((line) => line.id === 'bund' && line.width >= 40 && line.points.length >= 2));
  assert.ok(lines.some((line) => line.id === 'lujiazui' && line.points.length >= 2));
  const park = {
    kind: LAND.PARK,
    rings: [[[-1450, -260], [-1120, -260], [-1120, 260], [-1450, 260]]],
  };
  const kept = collectEmbankments([water, park]);
  assert.ok(kept.some((line) => line.id === 'bund' && line.width >= 40));
  assert.ok(kept.some((line) => line.id === 'lujiazui'));
});

test('a wide channel grows a paved bank on the land side', () => {
  const land = [{ kind: LAND.WATER, rings: [[[0, 0], [500, 0], [500, 500], [0, 500]]] }];
  const n = bankQuays(land);
  assert.ok(n > 8);
  assert.ok(land.some((f) => f.kind === LAND.PLAZA));
  const plaza = land.find((f) => f.kind === LAND.PLAZA);
  assert.ok(polygonArea(plaza.rings[0]) > 20);
});

function encodeTileSafe(tile) {
  const bytes = encodeTile(tile);
  const back = decodeTile(bytes);
  assert.equal(back.tx, tile.tx);
  assert.equal(back.buildings.length, tile.buildings.length);
  return bytes;
}

test('worker pose buffers match the simulation and segments cover every edge', async () => {
  const { CAR_STRIDE, PERSON_STRIDE, createStreets, roadSegmentBuffer, stepStreets, writeCarPoses, writePersonPoses } = await import('../../src/sim/poses.js');
  const { carPose } = await import('../../src/sim/traffic.js');
  const line = (a, b, x0, x1) => ({ a, b, cls: 3, speed: 12, points: [x0, 0, 0, (x0 + x1) / 2, 0, 0, x1, 0, 0] });
  const roads = {
    nodes: [{ x: 0, y: 0, z: 0, signal: 0 }, { x: 600, y: 0, z: 0, signal: 0 }],
    edges: [line(0, 1, 0, 600), line(1, 0, 600, 0)],
    walks: [{ points: [0, 0, 5, 600, 0, 5] }],
  };
  const streets = createStreets(roads);
  assert.ok(streets.sim.cars.length >= 12);
  stepStreets(streets, 0.5);
  const cars = writeCarPoses(streets.sim, new Float32Array(streets.sim.cars.length * CAR_STRIDE));
  const p = carPose(streets.sim, streets.sim.cars[3]);
  assert.ok(Math.abs(cars[3 * CAR_STRIDE] - p.x) < 1e-3);
  assert.ok(Math.abs(cars[3 * CAR_STRIDE + 2] - p.z) < 1e-3);
  if (streets.crowd.people.length) {
    const people = writePersonPoses(streets.crowd, new Float32Array(streets.crowd.people.length * PERSON_STRIDE));
    assert.ok(Number.isFinite(people[0]));
  }
  assert.equal(roadSegmentBuffer(roads).length, 2 * 2 * 4);
});

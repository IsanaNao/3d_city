import { mulberry32 } from '../shared/rng.js';
import { headingOf, pathFromFlat, samplePath } from './path.js';

export const SIGNAL_PERIOD = 7;

// phase 0: north-south green. phase 1: east-west green.
export function approachIsGreen(heading, time) {
  const eastWest = Math.abs(Math.cos(heading)) >= Math.SQRT1_2;
  const phase = Math.floor(time / SIGNAL_PERIOD) % 2;
  return eastWest ? phase === 1 : phase === 0;
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function prepareGraph(data) {
  const edges = (data.edges || []).map((edge) => {
    const path = pathFromFlat(edge.points);
    const head0 = path.pts.length > 1 ? headingOf(path.pts[1].x - path.pts[0].x, path.pts[1].z - path.pts[0].z) : 0;
    const n = path.pts.length;
    const head1 = n > 1 ? headingOf(path.pts[n - 1].x - path.pts[n - 2].x, path.pts[n - 1].z - path.pts[n - 2].z) : head0;
    return { ...edge, path, head0, head1, length: path.length };
  }).filter((edge) => edge.length > 4);
  const out = Array.from({ length: (data.nodes || []).length }, () => []);
  edges.forEach((edge, index) => {
    if (out[edge.a]) out[edge.a].push(index);
  });
  const walks = (data.walks || []).map((edge) => {
    const path = pathFromFlat(edge.points);
    return { ...edge, path, length: path.length };
  }).filter((edge) => edge.length > 12);
  return { nodes: data.nodes || [], edges, out, walks };
}

function weightedPick(items, rng) {
  let sum = 0;
  for (const item of items) sum += item.w;
  let r = rng() * sum;
  for (const item of items) {
    r -= item.w;
    if (r <= 0) return item.e;
  }
  return items[items.length - 1].e;
}

function pickNext(sim, edge) {
  const outs = sim.graph.out[edge.b] || [];
  if (!outs.length) return null;
  const choices = [];
  for (const index of outs) {
    const next = sim.graph.edges[index];
    if (next.a === edge.b && next.b === edge.a && outs.length > 1) continue;
    const turn = Math.abs(angleDiff(edge.head1, next.head0));
    if (turn > Math.PI * 0.85 && outs.length > 1) continue;
    choices.push({ e: index, w: Math.max(0.05, Math.cos(turn / 2) ** 2) });
  }
  const pool = choices.length ? choices : outs.map((index) => ({ e: index, w: 1 }));
  return weightedPick(pool, sim.rng);
}

// Cumulative spawn weight per edge, built once per graph: busy roads get more cars.
function spawnTable(graph) {
  if (graph.spawnTable) return graph.spawnTable;
  const cum = new Float64Array(graph.edges.length);
  let total = 0;
  graph.edges.forEach((edge, i) => {
    total += edge.length * (edge.cls <= 2 ? 6 : edge.cls === 5 ? 0.15 : 1);
    cum[i] = total;
  });
  graph.spawnTable = cum;
  return cum;
}

function spawn(sim, rng) {
  const edges = sim.graph.edges;
  const cum = spawnTable(sim.graph);
  const r = rng() * (cum[cum.length - 1] || 0);
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  const pick = Math.max(0, lo);
  const edge = edges[pick];
  return {
    edge: pick,
    dist: rng() * edge.length,
    speed: edge.speed * 0.6,
    rate: 0.78 + rng() * 0.35,
  };
}

export function createSim(graph, { count = 80, seed = 1 } = {}) {
  const rng = mulberry32(seed);
  const cars = [];
  const n = Math.max(0, Math.min(count, graph.edges.length ? count : 0));
  for (let i = 0; i < n; i++) cars.push(spawn({ graph, rng }, rng));
  return { graph, cars, rng, time: 0 };
}

export function stepSim(sim, dt) {
  sim.time += dt;
  // Each car only needs the car just ahead on its edge. Sorting per edge once
  // and linking neighbours keeps the step linear in the number of cars.
  const buckets = sim.buckets || (sim.buckets = new Map());
  for (const list of buckets.values()) list.length = 0;
  for (const car of sim.cars) {
    let list = buckets.get(car.edge);
    if (!list) buckets.set(car.edge, list = []);
    list.push(car);
  }
  for (const list of buckets.values()) {
    if (list.length > 1) list.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < list.length; i++) list[i].ahead = list[i + 1] || null;
  }
  for (const car of sim.cars) {
    const edge = sim.graph.edges[car.edge];
    if (!edge) { car.want = 0; continue; }
    let want = edge.speed * car.rate;
    const node = sim.graph.nodes[edge.b];
    const remain = edge.length - car.dist;
    if (node?.signal && !approachIsGreen(edge.head1, sim.time) && remain < 24 && remain > 2) {
      const stopAt = edge.length - 6.5;
      if (car.dist >= stopAt) want = 0;
      else want = Math.min(want, (stopAt - car.dist) * 0.55);
    }
    if (car.ahead) {
      const gap = car.ahead.dist - car.dist;
      if (gap < 12) want = Math.min(want, Math.max(0, gap - 7) * 1.15);
    }
    car.want = want;
  }
  for (const car of sim.cars) {
    const edge = sim.graph.edges[car.edge];
    if (!edge) {
      Object.assign(car, spawn(sim, sim.rng));
      continue;
    }
    const want = car.want ?? 0;
    const accel = want >= car.speed ? 7 : 14;
    if (car.speed < want) car.speed = Math.min(want, car.speed + accel * dt);
    else car.speed = Math.max(want, car.speed - accel * dt);
    if (want === 0 && car.speed < 0.35) {
      car.speed = 0;
      const node = sim.graph.nodes[edge.b];
      const remain = edge.length - car.dist;
      if (node?.signal && !approachIsGreen(edge.head1, sim.time) && remain < 24 && remain > 2) {
        car.dist = Math.min(car.dist, edge.length - 6.5);
      }
    }
    car.dist += car.speed * dt;
    if (car.dist >= edge.length) {
      const next = pickNext(sim, edge);
      if (next == null) {
        Object.assign(car, spawn(sim, sim.rng));
        continue;
      }
      car.dist = Math.max(0, car.dist - edge.length);
      car.edge = next;
      const nextEdge = sim.graph.edges[next];
      if (car.dist > nextEdge.length) car.dist = 0;
    }
  }
}

export function carPose(sim, car) {
  const edge = sim.graph.edges[car.edge];
  if (!edge) return null;
  return samplePath(edge.path, Math.min(car.dist, Math.max(0, edge.length - 0.05)));
}

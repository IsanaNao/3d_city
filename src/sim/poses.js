import { carPose, createSim, prepareGraph, stepSim } from './traffic.js';
import { createCrowd, personPose, stepCrowd } from './crowd.js';

// Shared by the traffic worker and the tests: the simulation set-up the main
// thread used to do, and the flat pose buffers it now receives instead.
export const CAR_STRIDE = 5; // x y z dx dz; NaN x = car off the graph
export const PERSON_STRIDE = 6; // x y z dx dz bob

export function createStreets(roads) {
  const graph = prepareGraph(roads);
  const count = Math.min(2800, Math.max(12, Math.round(graph.edges.reduce((s, e) => s + e.length, 0) / 180)));
  const sim = graph.edges.length ? createSim(graph, { count, seed: 7 }) : null;
  const crowd = sim ? createCrowd(graph, { seed: 11 }) : null;
  return { graph, sim, crowd };
}

export function stepStreets(streets, dt) {
  if (streets.sim) stepSim(streets.sim, dt);
  if (streets.crowd) stepCrowd(streets.crowd, dt);
}

export function writeCarPoses(sim, out) {
  for (let i = 0; i < sim.cars.length; i++) {
    const pose = carPose(sim, sim.cars[i]);
    const o = i * CAR_STRIDE;
    if (!pose) { out[o] = NaN; continue; }
    out[o] = pose.x; out[o + 1] = pose.y; out[o + 2] = pose.z; out[o + 3] = pose.dx; out[o + 4] = pose.dz;
  }
  return out;
}

export function writePersonPoses(crowd, out) {
  for (let i = 0; i < crowd.people.length; i++) {
    const pose = personPose(crowd.people[i]);
    const o = i * PERSON_STRIDE;
    out[o] = pose.x; out[o + 1] = pose.y; out[o + 2] = pose.z; out[o + 3] = pose.dx; out[o + 4] = pose.dz; out[o + 5] = pose.bob;
  }
  return out;
}

// Road centreline segments (ax az bx bz) for the pavement tint, so the main
// thread never has to parse roads.json itself.
export function roadSegmentBuffer(roads) {
  const out = [];
  for (const edge of roads?.edges || []) {
    const p = edge.points;
    if (!p || p.length < 6) continue;
    for (let k = 0; k + 5 < p.length; k += 3) out.push(p[k], p[k + 2], p[k + 3], p[k + 5]);
  }
  return new Float32Array(out);
}

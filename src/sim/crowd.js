import { mulberry32 } from '../shared/rng.js';
import { samplePath } from './path.js';

const SKIP = new Set([0, 9]);

function midpoint(edge) {
  const pts = edge.path.pts;
  const p = pts[Math.floor(pts.length / 2)] || pts[0];
  return p || { x: 0, z: 0 };
}

export function createCrowd(graph, { seed = 11 } = {}) {
  const edges = (graph.edges || []).filter((edge) => edge.length > 28 && !SKIP.has(edge.cls));
  if (!edges.length) return { people: [] };
  const rng = mulberry32(seed);
  const people = [];
  for (const edge of edges) {
    const mid = midpoint(edge);
    const central = mid.x > -1500 && mid.x < 900 && Math.abs(mid.z) < 1100;
    if (!central || edge.cls > 3) continue;
    const step = edge.cls <= 2 ? 24 : 42;
    const offset = edge.cls <= 2 ? 6.2 : 4.2;
    for (let dist = 6 + rng() * 8; dist < edge.length && people.length < 1600; dist += step) {
      people.push({
        edge,
        dist,
        speed: 0.85 + rng() * 0.7,
        side: people.length % 2 === 0 ? 1 : -1,
        offset: offset + rng() * 0.6,
        phase: rng() * Math.PI * 2,
      });
    }
    if (people.length >= 1600) break;
  }
  return { people };
}

export function stepCrowd(crowd, dt) {
  if (!crowd) return;
  for (const person of crowd.people) {
    person.dist += person.speed * dt;
    if (person.dist > person.edge.length) person.dist -= person.edge.length;
    person.phase += dt * (person.speed * 2.2);
  }
}

export function personPose(person) {
  const pose = samplePath(person.edge.path, person.dist);
  const len = Math.hypot(pose.dx, pose.dz) || 1;
  const nx = -pose.dz / len;
  const nz = pose.dx / len;
  return {
    x: pose.x + nx * person.offset * person.side,
    y: pose.y,
    z: pose.z + nz * person.offset * person.side,
    dx: pose.dx,
    dz: pose.dz,
    bob: Math.abs(Math.sin(person.phase)) * 0.05,
  };
}

// Two lanes in the Huangpu channel off the Bund, plus one further toward Lujiazui.
export function createBoats(waterY) {
  const lanes = [
    { x: -900, z0: -820, z1: 980, speed: 3.6, dir: 1 },
    { x: -760, z0: -820, z1: 980, speed: 2.8, dir: -1 },
    { x: -420, z0: -360, z1: 640, speed: 4.4, dir: 1 },
  ];
  const boats = [];
  for (const lane of lanes) {
    const span = lane.z1 - lane.z0;
    for (let i = 0; i < 3; i++) {
      boats.push({
        ...lane,
        z: lane.z0 + (span * (i + 0.35)) / 3,
        y: waterY + 0.15,
      });
    }
  }
  return boats;
}

export function stepBoats(boats, dt) {
  for (const boat of boats) {
    boat.z += boat.speed * boat.dir * dt;
    if (boat.z > boat.z1) boat.z = boat.z0;
    if (boat.z < boat.z0) boat.z = boat.z1;
  }
}

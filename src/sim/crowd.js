import { mulberry32 } from '../shared/rng.js';
import { samplePath } from './path.js';

const SKIP = new Set([0, 9]);

function midpoint(edge) {
  const pts = edge.path.pts;
  const p = pts[Math.floor(pts.length / 2)] || pts[0];
  return p || { x: 0, z: 0 };
}

export function createCrowd(graph, { count = 420, seed = 11 } = {}) {
  const edges = (graph.edges || []).filter((edge) => edge.length > 28 && !SKIP.has(edge.cls));
  if (!edges.length) return { people: [] };
  const rng = mulberry32(seed);
  const people = [];
  const push = (edge, side) => {
    const offset = edge.cls <= 2 ? 7.4 : 4.6;
    people.push({
      edge,
      dist: rng() * edge.length,
      speed: 0.85 + rng() * 0.7,
      side,
      offset: offset + rng() * 0.8,
      phase: rng() * Math.PI * 2,
    });
  };
  const hero = edges.filter((edge) => {
    const mid = midpoint(edge);
    return (mid.x < -1000 && mid.x > -1400) || (mid.x > -450 && mid.x < 700 && Math.abs(mid.z) < 700);
  });
  const pool = hero.length > 12 ? hero : edges;
  while (people.length < count) {
    const edge = pool[Math.floor(rng() * pool.length)];
    push(edge, people.length % 2 === 0 ? 1 : -1);
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

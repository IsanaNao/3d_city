import { mulberry32 } from '../shared/rng.js';
import { samplePath } from './path.js';

const SKIP = new Set([0, 9]);

function midpoint(edge) {
  const pts = edge.path.pts;
  const p = pts[Math.floor(pts.length / 2)] || pts[0];
  return p || { x: 0, z: 0 };
}

export function createCrowd(graph, { seed = 11 } = {}) {
  const walks = graph.walks || [];
  const edges = walks.length
    ? walks.filter((edge) => edge.length > 18)
    : (graph.edges || []).filter((edge) => edge.length > 28 && !SKIP.has(edge.cls));
  if (!edges.length) return { people: [] };
  const rng = mulberry32(seed);
  const eligible = [];
  for (const edge of edges) {
    const mid = midpoint(edge);
    const central = mid.x > -1500 && mid.x < 900 && Math.abs(mid.z) < 1100;
    if (!central || edge.cls > 4) continue;
    eligible.push(edge);
  }
  // Major roads first, and a step sized to the whole set, so one district
  // does not consume the cap before Lujiazui's sidewalks are reached.
  eligible.sort((a, b) => a.cls - b.cls || b.length - a.length);
  const major = eligible.filter((edge) => edge.cls <= 2);
  const minor = eligible.filter((edge) => edge.cls > 2);
  const majorLen = major.reduce((sum, edge) => sum + edge.length, 0) || 1;
  const majorStep = Math.max(16, majorLen / 1100);
  const people = [];
  const place = (list, stepFor) => {
    for (const edge of list) {
      const step = stepFor(edge);
      const half = walks.length ? Math.max(0.35, (edge.sidewalk || 3.2) * 0.28) : 0.8;
      for (let dist = 4 + rng() * step * 0.4; dist < edge.length && people.length < 1600; dist += step) {
        people.push({
          edge,
          dist,
          speed: 0.85 + rng() * 0.7,
          side: 1,
          offset: (rng() * 2 - 1) * half,
          phase: rng() * Math.PI * 2,
        });
      }
      if (people.length >= 1600) return;
    }
  };
  place(major, (edge) => (edge.cls <= 1 ? majorStep * 0.7 : majorStep));
  place(minor, () => 70);
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

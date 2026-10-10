import { ROAD } from '../../src/shared/kinds.js';
import { coordKey, offsetPolyline, polylineLength } from './geom.mjs';

function pointAlongFromEnd(points, ys, dist) {
  let remain = dist;
  for (let i = points.length - 1; i > 0; i--) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len >= remain) {
      const t = remain / (len || 1);
      return {
        x: b[0] + (a[0] - b[0]) * t,
        z: b[1] + (a[1] - b[1]) * t,
        y: ys[i] + (ys[i - 1] - ys[i]) * (remain / (len || 1)),
      };
    }
    remain -= len;
  }
  return null;
}

function crosswalk(points, ys, width) {
  if (polylineLength(points) < 16) return null;
  const far = pointAlongFromEnd(points, ys, 14);
  const near = pointAlongFromEnd(points, ys, 6);
  if (!far || !near) return null;
  return {
    points: [[far.x, far.z], [near.x, near.z]],
    y: [far.y + 0.05, near.y + 0.05],
    width,
    cls: ROAD.CROSSWALK,
    flags: 0,
  };
}

export function buildRoadGraph(roads, signals) {
  const drive = roads.filter((road) => road.drive && road.points.length >= 2);
  const usage = new Map();
  const use = (p, id) => {
    const key = coordKey(p[0], p[1]);
    let set = usage.get(key);
    if (!set) usage.set(key, set = new Set());
    set.add(id);
  };
  drive.forEach((road, id) => {
    for (const p of road.points) use(p, id);
  });
  const isSplit = (p) => (usage.get(coordKey(p[0], p[1]))?.size || 0) >= 2;

  const nodes = [];
  const index = new Map();
  const nodeFor = (x, y, z) => {
    const key = coordKey(x, z);
    if (index.has(key)) return index.get(key);
    const id = nodes.length;
    nodes.push({ x, y, z, signal: 0 });
    index.set(key, id);
    return id;
  };

  const pieces = [];
  drive.forEach((road) => {
    let curP = [road.points[0]];
    let curY = [road.y[0]];
    for (let i = 1; i < road.points.length; i++) {
      curP.push(road.points[i]);
      curY.push(road.y[i]);
      if (i === road.points.length - 1 || isSplit(road.points[i])) {
        if (curP.length >= 2) pieces.push({ road, points: curP, y: curY });
        curP = [road.points[i]];
        curY = [road.y[i]];
      }
    }
  });

  for (const piece of pieces) {
    const a = piece.points[0];
    const b = piece.points[piece.points.length - 1];
    nodeFor(a[0], piece.y[0], a[1]);
    nodeFor(b[0], piece.y[piece.y.length - 1], b[1]);
  }
  for (const node of nodes) {
    for (const signal of signals) {
      if ((node.x - signal.x) ** 2 + (node.z - signal.z) ** 2 < 18 * 18) {
        node.signal = 1;
        break;
      }
    }
  }

  const edges = [];
  const crosswalks = [];
  for (const piece of pieces) {
    const length = polylineLength(piece.points);
    if (length < 4) continue;
    const offset = Math.max(0.7, Math.min(piece.road.width * 0.26, piece.road.width * 0.5 - 0.55));
    const lane = offsetPolyline(piece.points, offset);
    const flat = [];
    for (let i = 0; i < lane.length; i++) flat.push(lane[i][0], piece.y[i] ?? piece.y[piece.y.length - 1], lane[i][1]);
    const a = nodeFor(piece.points[0][0], piece.y[0], piece.points[0][1]);
    const b = nodeFor(piece.points.at(-1)[0], piece.y.at(-1), piece.points.at(-1)[1]);
    const forward = {
      a, b, speed: piece.road.speed, cls: piece.road.cls, points: flat,
    };
    edges.push(forward);
    if (!piece.road.oneway) {
      const backPoints = piece.points.slice().reverse();
      const backY = piece.y.slice().reverse();
      const laneB = offsetPolyline(backPoints, offset);
      const flatB = [];
      for (let i = 0; i < laneB.length; i++) flatB.push(laneB[i][0], backY[i] ?? backY.at(-1), laneB[i][1]);
      edges.push({ a: b, b: a, speed: piece.road.speed, cls: piece.road.cls, points: flatB });
    }
    const end = piece.points.at(-1);
    const junction = isSplit(end) || nodes[b]?.signal;
    if (junction && piece.road.cls !== ROAD.MOTORWAY && piece.road.cls !== ROAD.LINK) {
      const mark = crosswalk(piece.points, piece.y, Math.min(piece.road.width, 16));
      if (mark) crosswalks.push(mark);
    }
  }
  return { nodes, edges, crosswalks };
}

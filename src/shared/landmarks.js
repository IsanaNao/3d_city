// Named towers the extruded footprint cannot represent. Geometry is built in the
// client (src/world/landmarks.js); this module only decides which OSM buildings
// they replace. Patterns are specific so a short building that merely shares a
// word is left as an extrusion.

export const LANDMARK_SPECS = [
  { id: 'pearl', test: /东方明珠|oriental pearl/i, h: 468, minH: 80, radius: 48 },
  { id: 'shanghai', test: /上海中心大厦|shanghai tower/i, h: 632, minH: 250, radius: 42 },
  { id: 'swfc', test: /环球金融中心|world financial center/i, h: 492, minH: 200, radius: 40 },
  { id: 'jinmao', test: /金茂大厦|jin mao tower/i, h: 421, minH: 200, radius: 40 },
  { id: 'customs', test: /江海关|外滩海关|customs house/i, h: 79, minH: 55, radius: 26 },
];

function pointInPoly(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const zi = ring[i][1];
    const xj = ring[j][0];
    const zj = ring[j][1];
    const hit = (zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / ((zj - zi) || 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

// Three.js rotation.y that sends local +X along the longest footprint edge.
function edgeYaw(ring) {
  let best = 0;
  let yaw = 0;
  if (!ring) return 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len > best) {
      best = len;
      yaw = Math.atan2(-dz, dx);
    }
  }
  return yaw;
}

export function findLandmarks(buildings) {
  const out = [];
  for (const spec of LANDMARK_SPECS) {
    const parts = buildings.filter((b) => spec.test.test(b.name || '') && b.topY - b.baseY >= spec.minH);
    if (!parts.length) continue;
    parts.sort((a, b) => b.area - a.area);
    const main = parts[0];
    out.push({
      id: spec.id,
      name: main.name || spec.id,
      x: main.centroid[0],
      z: main.centroid[1],
      y: main.baseY,
      h: Math.max(spec.h, main.topY - main.baseY),
      yaw: edgeYaw(main.rings[0]),
      radius: spec.radius,
      ring: main.rings[0],
    });
  }
  return out;
}

export function hiddenByLandmark(building, landmarks) {
  for (const lm of landmarks) {
    const spec = LANDMARK_SPECS.find((s) => s.id === lm.id);
    const height = building.topY - building.baseY;
    const named = spec.test.test(building.name || '');
    if (named && height >= spec.minH) return true;
    const c = building.centroid;
    if (!c) continue;
    // A named neighbour that merely stands nearby stays an extrusion.
    if (building.name && !named) continue;
    if (lm.ring && pointInPoly(c[0], c[1], lm.ring)) return true;
    if (!building.name) {
      const d = Math.hypot(c[0] - lm.x, c[1] - lm.z);
      if (d < lm.radius * 0.55 && height > 25) return true;
    }
  }
  return false;
}

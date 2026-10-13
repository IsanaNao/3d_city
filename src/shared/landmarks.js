// Named towers the extruded footprint cannot represent. Geometry is built in the
// client (src/world/landmarks.js); this module only decides which OSM buildings
// they replace. Patterns are specific so a short building that merely shares a
// word is left as an extrusion.

export const LANDMARK_SPECS = [
  { id: 'pearl', test: /东方明珠|oriental pearl/i, h: 468, minH: 80, radius: 48 },
  { id: 'shanghai', test: /上海中心大厦|shanghai tower/i, h: 632, minH: 250, radius: 42 },
  { id: 'swfc', test: /环球金融中心|world financial center/i, h: 492, minH: 200, radius: 40 },
  { id: 'jinmao', test: /金茂大厦|jin mao tower/i, h: 421, minH: 200, radius: 40 },
  { id: 'customs', test: /(?<!浦东)上海海关|江海关|外滩海关|customs house/i, h: 90, minH: 10, maxH: 120, radius: 28 },
  { id: 'hsbc', test: /上海浦东发展银行|外滩汇丰/i, h: 52, minH: 12, maxH: 80, radius: 55 },
  { id: 'peace', test: /和平饭店(?!南)|fairmont peace hotel/i, h: 77, minH: 12, maxH: 120, radius: 30 },
  { id: 'boc', test: /中国银行大楼/i, h: 70, minH: 15, maxH: 120, radius: 32 },
  { id: 'asia', test: /中国太平洋保险公司/, h: 32, minH: 8, maxH: 50, radius: 30 },
  { id: 'club', test: /华尔道夫|waldorf-astoria/i, h: 34, minH: 8, maxH: 60, radius: 30 },
  { id: 'union', test: /有利大楼|union building/i, h: 32, minH: 8, maxH: 50, radius: 40 },
  { id: 'nisshin', test: /外滩五号|five on the bund/i, h: 32, minH: 8, maxH: 50, radius: 34 },
  { id: 'bund18', test: /外滩18号|^bund\s*18$/i, h: 30, minH: 8, maxH: 50, radius: 32 },
  { id: 'peaceSouth', test: /和平饭店南楼|peace hotel south/i, h: 32, minH: 8, maxH: 50, radius: 46 },
  { id: 'bocom', test: /上海市总工会/, h: 38, minH: 8, maxH: 60, radius: 28 },
  { id: 'russo', test: /上海外汇交易中心/, h: 26, minH: 8, maxH: 45, radius: 28 },
  { id: 'merchants', test: /^招商银行$/, h: 28, minH: 8, maxH: 45, radius: 22 },
  { id: 'yokohama', test: /^中国工商银行$/, h: 32, minH: 8, maxH: 40, radius: 30 },
  { id: 'jardine', test: /外滩27|house of roosevelt|罗斯福/i, h: 38, minH: 8, maxH: 55, radius: 30 },
  { id: 'indochine', test: /^中国光大银行$/, h: 30, minH: 8, maxH: 45, radius: 34 },
  { id: 'magnolia', test: /白玉兰|sinar\s*mas|white magnolia|金光中心/i, h: 319.5, minH: 180, radius: 40 },
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
    const parts = buildings.filter((b) => {
    const height = b.topY - b.baseY;
    if (!spec.test.test(b.name || '') || height < spec.minH) return false;
    if (spec.maxH && height > spec.maxH) return false;
    return true;
  });
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
    if (named && height >= spec.minH && !(spec.maxH && height > spec.maxH)) return true;
    const c = building.centroid;
    if (!c) continue;
    if (lm.id === 'pearl' && !building.name) {
      const d = Math.hypot(c[0] - lm.x, c[1] - lm.z);
      if (d < 250 && height < 115) return true;
    }
    // A named neighbour that merely stands nearby stays an extrusion.
    if (building.name && !named) continue;
    if (lm.ring && pointInPoly(c[0], c[1], lm.ring)) return true;
    if (!building.name) {
      const d = Math.hypot(c[0] - lm.x, c[1] - lm.z);
      if (d < lm.radius * 0.55 && height > 25) return true;
      // The Pearl's stepped plinth is wider than its OSM footprint. Low blocks
      // inside that circle hide the legs, so they come out.
      if (lm.id === 'pearl' && d < 90 && height < 70) return true;
    }
  }
  return false;
}

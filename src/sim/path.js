export function pathFromFlat(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 3) pts.push({ x: flat[i], y: flat[i + 1], z: flat[i + 2] });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  return { pts, cum, length: cum[cum.length - 1] || 0 };
}

export function samplePath(path, dist) {
  const length = path.length || 1;
  let d = dist % length;
  if (d < 0) d += length;
  let i = 1;
  while (i < path.cum.length - 1 && path.cum[i] < d) i += 1;
  const i1 = Math.min(path.pts.length - 1, Math.max(1, i));
  const i0 = i1 - 1;
  const span = (path.cum[i1] - path.cum[i0]) || 1;
  const t = Math.max(0, Math.min(1, (d - path.cum[i0]) / span));
  const a = path.pts[i0];
  const b = path.pts[i1];
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    dx: b.x - a.x,
    dz: b.z - a.z,
  };
}

export function headingOf(dx, dz) {
  return Math.atan2(dz, dx);
}

export function yawFromHeading(dx, dz) {
  // Geometry faces +X. Three.js Y rotation maps +X to (cos θ, -sin θ) in (x, z).
  return Math.atan2(-dz, dx);
}

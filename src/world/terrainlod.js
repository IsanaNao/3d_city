import * as THREE from 'three';

// The whole-area grid was one ~1M-vertex mesh that every pass (view, mirror,
// shadow) drew in full. It is cut into square chunks that frustum-cull, and
// each chunk keeps a few index buffers over the same vertices: every grid
// point near the camera, every 2nd, 4th or 8th further out.
const CHUNK = 128;
const STEPS = [1, 2, 4, 8];
// Neighbouring chunks at different steps leave slivers along their seam.
// A skirt hanging below each inner edge closes them.
const SKIRT = 14;

function gridNormals(pos, cols, rows, step) {
  const nrm = new Float32Array(cols * rows * 3);
  const y = (c, r) => pos[(Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))) * 3 + 1];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dx = (y(c + 1, r) - y(c - 1, r)) / (2 * step);
      const dz = (y(c, r + 1) - y(c, r - 1)) / (2 * step);
      const len = Math.hypot(dx, 1, dz);
      const i = (r * cols + c) * 3;
      nrm[i] = -dx / len;
      nrm[i + 1] = 1 / len;
      nrm[i + 2] = -dz / len;
    }
  }
  return nrm;
}

// keepCell(a, b, d, e, mx, mz) decides whether a quad is drawn; the flood
// wall leaves a gap in the grid that the embankment mesh fills.
export function buildTerrainChunks({ pos, col, cols, rows, step, keepCell }, material) {
  const nrm = gridNormals(pos, cols, rows, step);
  const group = new THREE.Group();
  group.name = 'terrain';
  const chunks = [];
  for (let r0 = 0; r0 < rows - 1; r0 += CHUNK) {
    for (let c0 = 0; c0 < cols - 1; c0 += CHUNK) {
      const c1 = Math.min(cols - 1, c0 + CHUNK);
      const r1 = Math.min(rows - 1, r0 + CHUNK);
      const w = c1 - c0 + 1;
      const h = r1 - r0 + 1;
      // Inner edges carry a skirt; the outer rim of the area does not.
      const edges = [
        r0 > 0 ? Array.from({ length: w }, (_, k) => [c0 + k, r0]) : null,
        r1 < rows - 1 ? Array.from({ length: w }, (_, k) => [c0 + k, r1]) : null,
        c0 > 0 ? Array.from({ length: h }, (_, k) => [c0, r0 + k]) : null,
        c1 < cols - 1 ? Array.from({ length: h }, (_, k) => [c1, r0 + k]) : null,
      ].filter(Boolean);
      const skirtCount = edges.reduce((s, e) => s + e.length, 0);
      const count = w * h + skirtCount;
      const p = new Float32Array(count * 3);
      const n = new Float32Array(count * 3);
      const cl = new Float32Array(count * 3);
      // Grid index of each vertex, so a later paint can refresh the colours.
      const from = new Uint32Array(count);
      const local = (c, r) => (r - r0) * w + (c - c0);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          from[local(c, r)] = r * cols + c;
          const src = (r * cols + c) * 3;
          const dst = local(c, r) * 3;
          for (let k = 0; k < 3; k++) {
            p[dst + k] = pos[src + k];
            n[dst + k] = nrm[src + k];
            cl[dst + k] = col[src + k];
          }
        }
      }
      // Skirt vertices: a copy of each edge vertex, dropped.
      let cursor = w * h;
      const skirtStart = [];
      for (const edge of edges) {
        skirtStart.push(cursor);
        for (const [c, r] of edge) {
          from[cursor] = r * cols + c;
          const src = local(c, r) * 3;
          const dst = cursor * 3;
          p[dst] = p[src];
          p[dst + 1] = p[src + 1] - SKIRT;
          p[dst + 2] = p[src + 2];
          for (let k = 0; k < 3; k++) {
            n[dst + k] = n[src + k];
            cl[dst + k] = cl[src + k];
          }
          cursor += 1;
        }
      }
      const levels = STEPS.map((s) => {
        const idx = [];
        for (let r = r0; r < r1; r += s) {
          const rn = Math.min(r1, r + s);
          for (let c = c0; c < c1; c += s) {
            const cn = Math.min(c1, c + s);
            const a = r * cols + c;
            const b = r * cols + cn;
            const d = rn * cols + c;
            const e = rn * cols + cn;
            if (!keepCell(a, b, d, e)) continue;
            const la = local(c, r);
            const lb = local(cn, r);
            const ld = local(c, rn);
            const le = local(cn, rn);
            idx.push(la, ld, lb, lb, ld, le);
          }
        }
        // Skirts follow the finest edge so they meet whatever the neighbour draws.
        edges.forEach((edge, k) => {
          const base = skirtStart[k];
          for (let i = 0; i + 1 < edge.length; i++) {
            const t0 = local(edge[i][0], edge[i][1]);
            const t1 = local(edge[i + 1][0], edge[i + 1][1]);
            const b0 = base + i;
            const b1 = base + i + 1;
            idx.push(t0, b0, t1, t1, b0, b1, t0, t1, b0, t1, b1, b0);
          }
        });
        const Arr = count > 65535 ? Uint32Array : Uint16Array;
        return new THREE.BufferAttribute(new Arr(idx), 1);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      geo.setIndex(levels[0]);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.userData.levels = levels;
      mesh.userData.from = from;
      mesh.userData.level = 0;
      group.add(mesh);
      chunks.push(mesh);
    }
  }
  group.userData.chunks = chunks;
  return group;
}

// col: the grid's colours, painted again (roads arrived).
export function repaintTerrain(group, col) {
  for (const mesh of group.userData.chunks || []) {
    const attr = mesh.geometry.getAttribute('color');
    const from = mesh.userData.from;
    for (let k = 0; k < from.length; k++) {
      const src = from[k] * 3;
      attr.array[k * 3] = col[src];
      attr.array[k * 3 + 1] = col[src + 1];
      attr.array[k * 3 + 2] = col[src + 2];
    }
    attr.needsUpdate = true;
  }
}

const _near = new THREE.Vector3();

// Distance to the nearest point of each chunk picks its step.
export function updateTerrainLod(group, camera) {
  const eye = camera.position;
  for (const mesh of group.userData.chunks || []) {
    const box = mesh.geometry.boundingBox;
    box.clampPoint(eye, _near);
    const d = _near.distanceTo(eye);
    const level = d < 1100 ? 0 : d < 2400 ? 1 : d < 4800 ? 2 : 3;
    if (level === mesh.userData.level) continue;
    mesh.userData.level = level;
    mesh.geometry.setIndex(mesh.userData.levels[level]);
  }
}

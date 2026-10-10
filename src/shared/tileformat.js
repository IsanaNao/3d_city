import { BinWriter, binReader } from './bin.js';

// Binary chunk. The compiler writes it; the viewer reads it.
//
// little-endian
// u32 magic 'SHG1' | u16 version | u16 reserved | i32 tx | i32 tz
// u32 nBuildings | u32 nLand | u32 nRoadVerts | u32 nRoadIdx | u32 nProps
//
// building:
//   u8 kind | u8 storeys | u16 flags | f32 baseY | f32 topY
//   u8 roofShape | u8 reserved | f32 roofHeight | u32 color
//   u16 nameBytes | utf8 name
//   u16 nRings
//   ring: u16 n | n bytes of edge flags | n * (f32 x, f32 z)
//   Outer rings are counter-clockwise with north up. Flag bit 0 means the edge
//   lies on a shared tile boundary and should not grow a wall.
// land:
//   u8 kind | u8 reserved | u16 reserved | u16 nRings
//   ring: u16 n | n * (f32 x, f32 z)
// road mesh, 7 floats per vertex: x y z across along class flags
//   then nRoadIdx u32 indices
// prop:
//   u8 kind | u8 variant | u16 reserved
//   f32 x y z rot scale extra

export const MAGIC = 0x31474853; // 'SHG1'
export const VERSION = 2;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function asPairs(points) {
  if (points instanceof Float32Array) return points;
  if (points?.points) return asPairs(points.points);
  const out = new Float32Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    out[i * 2] = points[i][0];
    out[i * 2 + 1] = points[i][1];
  }
  return out;
}

function writeRing(w, ring, withFlags) {
  const pts = asPairs(ring.points ?? ring);
  const n = pts.length / 2;
  w.u16(n);
  if (withFlags) {
    const flags = ring.flags || [];
    for (let i = 0; i < n; i++) w.u8(flags[i] || 0);
  }
  for (let i = 0; i < pts.length; i++) w.f32(pts[i]);
}

function readRing(r, withFlags) {
  const n = r.u16();
  const flags = withFlags ? new Uint8Array(n) : null;
  if (withFlags) for (let i = 0; i < n; i++) flags[i] = r.u8();
  const points = new Float32Array(n * 2);
  for (let i = 0; i < points.length; i++) points[i] = r.f32();
  return withFlags ? { points, flags } : { points };
}

export function encodeTile({ tx, tz, buildings = [], land = [], roads = null, props = [] }) {
  const roadVerts = roads?.verts ? Float32Array.from(roads.verts) : new Float32Array();
  const roadIdx = roads?.indices ? Uint32Array.from(roads.indices) : new Uint32Array();
  if (roadVerts.length % 7 !== 0) throw new Error('road vertices must be groups of 7 floats');
  const w = new BinWriter();
  w.u32(MAGIC);
  w.u16(VERSION);
  w.u16(0);
  w.i32(tx);
  w.i32(tz);
  w.u32(buildings.length);
  w.u32(land.length);
  w.u32(roadVerts.length / 7);
  w.u32(roadIdx.length);
  w.u32(props.length);
  for (const b of buildings) {
    w.u8(b.kind || 0);
    w.u8(Math.max(0, Math.min(255, b.storeys || 1)));
    w.u16(b.flags || 0);
    w.f32(b.baseY || 0);
    w.f32(b.topY || 0);
    w.u8(b.roofShape || 0);
    w.u8(0);
    w.f32(b.roofHeight || 0);
    w.u32((b.color ?? 0xcccccc) >>> 0);
    const name = textEncoder.encode(b.name || '');
    w.u16(name.length);
    w.raw(name);
    w.u16(b.rings.length);
    for (const ring of b.rings) writeRing(w, ring, true);
  }
  for (const area of land) {
    w.u8(area.kind || 0);
    w.u8(0);
    w.u16(0);
    w.u16(area.rings.length);
    for (const ring of area.rings) writeRing(w, ring, false);
  }
  for (let i = 0; i < roadVerts.length; i++) w.f32(roadVerts[i]);
  for (let i = 0; i < roadIdx.length; i++) w.u32(roadIdx[i]);
  for (const p of props) {
    w.u8(p.kind || 0);
    w.u8(p.variant || 0);
    w.u16(0);
    w.f32(p.x || 0);
    w.f32(p.y || 0);
    w.f32(p.z || 0);
    w.f32(p.rot || 0);
    w.f32(p.scale ?? 1);
    w.f32(p.extra ?? 1);
  }
  return w.bytes();
}

export function decodeTile(input) {
  const r = binReader(input);
  if (r.u32() !== MAGIC) throw new Error('not an SHG1 tile');
  const version = r.u16();
  r.u16();
  if (version !== VERSION) throw new Error(`tile version ${version}, expected ${VERSION}`);
  const tx = r.i32();
  const tz = r.i32();
  const nB = r.u32();
  const nL = r.u32();
  const nRV = r.u32();
  const nRI = r.u32();
  const nP = r.u32();
  const buildings = [];
  for (let i = 0; i < nB; i++) {
    const kind = r.u8();
    const storeys = r.u8();
    const flags = r.u16();
    const baseY = r.f32();
    const topY = r.f32();
    const roofShape = r.u8();
    r.u8();
    const roofHeight = r.f32();
    const color = r.u32();
    const nameBytes = r.bytes(r.u16());
    const name = textDecoder.decode(nameBytes);
    const rings = [];
    const nRings = r.u16();
    for (let k = 0; k < nRings; k++) rings.push(readRing(r, true));
    buildings.push({ kind, storeys, flags, baseY, topY, roofShape, roofHeight, color, name, rings });
  }
  const land = [];
  for (let i = 0; i < nL; i++) {
    const kind = r.u8();
    r.u8();
    r.u16();
    const rings = [];
    const nRings = r.u16();
    for (let k = 0; k < nRings; k++) rings.push(readRing(r, false));
    land.push({ kind, rings });
  }
  const roadVerts = new Float32Array(nRV * 7);
  for (let i = 0; i < roadVerts.length; i++) roadVerts[i] = r.f32();
  const roadIndices = new Uint32Array(nRI);
  for (let i = 0; i < roadIndices.length; i++) roadIndices[i] = r.u32();
  const props = [];
  for (let i = 0; i < nP; i++) {
    const kind = r.u8();
    const variant = r.u8();
    r.u16();
    props.push({
      kind, variant,
      x: r.f32(), y: r.f32(), z: r.f32(), rot: r.f32(), scale: r.f32(), extra: r.f32(),
    });
  }
  if (r.rest() !== 0) throw new Error(`tile has ${r.rest()} trailing bytes`);
  return { tx, tz, buildings, land, roads: { verts: roadVerts, indices: roadIndices }, props };
}

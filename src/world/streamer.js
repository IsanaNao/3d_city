import * as THREE from 'three';
import { TILE, tileKey, tileOf } from '../shared/geo.js';
import { LAND } from '../shared/kinds.js';
import { buildBuildingGeometry, buildLandGeometry } from '../shared/meshbuild.js';
import { decodeTerrain, sampleGrid } from '../shared/terrain.js';
import { decodeTile } from '../shared/tileformat.js';
import { KIND_NAME } from '../shared/kinds.js';
import { createBuildingMaterial, createGroundMaterial, createRoadMaterial, createWaterMaterial } from './materials.js';
import { lampPools, lampScene } from './lamplight.js';
import { DETAIL_LAYER, WATER_LAYER } from './mirror.js';
import { createBridges, syncBridgeNight } from './bridges.js';
import { createEmbankments, embankmentSegments } from './embankment.js';
import { createLandmarks, syncLandmarkNight } from './landmarks.js';
import { mergeChildren } from './merge.js';
import { createClusters } from './clusters.js';
import { buildTerrainChunks, repaintTerrain, updateTerrainLod } from './terrainlod.js';
import {
  cupolaMesh, instanceProps, lampGeometries, lampHeadMaterial, signMesh, signalGeometry, staticPropMesh, treeGeometry, treeGeometryFar,
} from './props.js';
import { PROP } from '../shared/kinds.js';

// Beyond these distances (metres from the eye to the tile centre) the small
// props and the simple tree crowns are hidden.
const PROP_RANGE = 1100;
const TREE_RANGE = 2200;

function setAttr(geo, name, array, size) {
  geo.setAttribute(name, new THREE.BufferAttribute(array, size));
}

function roadGeometry(roads) {
  const verts = roads.verts;
  const count = verts.length / 7;
  if (!count || !roads.indices.length) return null;
  const pos = new Float32Array(count * 3);
  const road = new Float32Array(count * 2);
  const cls = new Float32Array(count);
  const flags = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = verts[i * 7];
    pos[i * 3 + 1] = verts[i * 7 + 1];
    pos[i * 3 + 2] = verts[i * 7 + 2];
    road[i * 2] = verts[i * 7 + 3];
    road[i * 2 + 1] = verts[i * 7 + 4];
    cls[i] = verts[i * 7 + 5];
    flags[i] = verts[i * 7 + 6];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRoad', new THREE.BufferAttribute(road, 2));
  geo.setAttribute('aCls', new THREE.BufferAttribute(cls, 1));
  geo.setAttribute('aFlags', new THREE.BufferAttribute(flags, 1));
  geo.setIndex(new THREE.BufferAttribute(roads.indices, 1));
  geo.computeVertexNormals();
  return geo;
}

function segDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const ab2 = abx * abx + abz * abz || 1e-6;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / ab2));
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

function blockHash(ix, iz) {
  let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// Bare terrain used to be one grey. Paint pavement beside carriageways and a
// patchwork of turf and yards in the blocks; parks and plazas still overlay it.
function hardBankHash(segments) {
  const cell = 48;
  const buckets = new Map();
  const key = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);
  for (const seg of segments) {
    const minX = Math.min(seg.ax, seg.bx) - seg.width - 8;
    const maxX = Math.max(seg.ax, seg.bx) + seg.width + 8;
    const minZ = Math.min(seg.az, seg.bz) - seg.width - 8;
    const maxZ = Math.max(seg.az, seg.bz) + seg.width + 8;
    const ix0 = Math.floor(minX / cell);
    const ix1 = Math.floor(maxX / cell);
    const iz0 = Math.floor(minZ / cell);
    const iz1 = Math.floor(maxZ / cell);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = key(ix, iz);
        let list = buckets.get(k);
        if (!list) { list = []; buckets.set(k, list); }
        list.push(seg);
      }
    }
  }
  return (x, z, extra = 0) => {
    const ix = Math.floor(x / cell);
    const iz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = buckets.get(key(ix + dx, iz + dz));
        if (!list) continue;
        for (const seg of list) {
          if (segDist(x, z, seg.ax, seg.az, seg.bx, seg.bz) < seg.width + extra) return true;
        }
      }
    }
    return false;
  };
}

// For every grid point, the distance to the nearest segment less its half
// width, written only within `pad` metres of a segment.
function distanceField(grid, segments, pad, field) {
  const { originX, originZ, step, cols, rows } = grid;
  for (const seg of segments) {
    const reach = pad + (seg.width || 0);
    const c0 = Math.max(0, Math.floor((Math.min(seg.ax, seg.bx) - reach - originX) / step));
    const c1 = Math.min(cols - 1, Math.ceil((Math.max(seg.ax, seg.bx) + reach - originX) / step));
    const r0 = Math.max(0, Math.floor((Math.min(seg.az, seg.bz) - reach - originZ) / step));
    const r1 = Math.min(rows - 1, Math.ceil((Math.max(seg.az, seg.bz) + reach - originZ) / step));
    for (let r = r0; r <= r1; r++) {
      const z = originZ + r * step;
      for (let c = c0; c <= c1; c++) {
        const d = segDist(originX + c * step, z, seg.ax, seg.az, seg.bx, seg.bz) - (seg.width || 0);
        const i = r * cols + c;
        if (d < field[i]) field[i] = d;
      }
    }
  }
  return field;
}

function roadSegments(roads) {
  const out = [];
  for (const edge of roads?.edges || []) {
    const p = edge.points;
    if (!p || p.length < 6) continue;
    for (let k = 0; k + 5 < p.length; k += 3) out.push({ ax: p[k], az: p[k + 2], bx: p[k + 3], bz: p[k + 5] });
  }
  return out;
}

// The terrain sheet: positions now, colours painted by paintTerrain. The
// first paint runs before roads.json has arrived; a second one adds the
// pavement beside the carriageways once it has.
function terrainSheet(grid, waterLevel, embankments) {
  const { originX, originZ, step, cols, rows, heights } = grid;
  const segments = embankmentSegments(embankments);
  const onPromenade = hardBankHash(segments);
  const bank = distanceField(grid, segments, 4, new Float32Array(cols * rows).fill(1e9));
  const pos = new Float32Array(cols * rows * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      pos[i * 3] = originX + c * step;
      pos[i * 3 + 1] = heights[i];
      pos[i * 3 + 2] = originZ + r * step;
    }
  }
  const yOf = (i) => pos[i * 3 + 1];
  const keepCell = (a, b, d, e) => {
    const drop = Math.max(yOf(a), yOf(b), yOf(d), yOf(e)) - Math.min(yOf(a), yOf(b), yOf(d), yOf(e));
    if (drop <= 4.5) return true;
    const mx = (pos[a * 3] + pos[b * 3] + pos[d * 3] + pos[e * 3]) / 4;
    const mz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[d * 3 + 2] + pos[e * 3 + 2]) / 4;
    // The flood wall closes this gap. A park bank is not in the hash, so its slope stays.
    return !onPromenade(mx, mz, 10);
  };
  return {
    grid, pos, col: new Float32Array(cols * rows * 3), bank, cols, rows, step, keepCell,
    wet: Number.isFinite(waterLevel) ? waterLevel : -1e9,
  };
}

function paintTerrain(sheet, roads) {
  const { grid, pos, col, bank, wet } = sheet;
  const nearRoad = distanceField(grid, roadSegments(roads), 22, new Float32Array(grid.cols * grid.rows).fill(40));
  const n = grid.cols * grid.rows;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const shade = 0.94 + 0.08 * blockHash(Math.floor(x / 18), Math.floor(z / 18));
    let cr;
    let cg;
    let cb;
    if (y < wet + 0.35) {
      cr = 0.1; cg = 0.18; cb = 0.2;
    } else if (bank[i] < 2) {
      cr = 0.62; cg = 0.58; cb = 0.52;
    } else if (nearRoad[i] < 16) {
      const t = Math.min(1, nearRoad[i] / 16);
      cr = 0.5 + 0.08 * t;
      cg = 0.48 + 0.08 * t;
      cb = 0.45 + 0.06 * t;
    } else {
      const h = blockHash(Math.floor(x / 32), Math.floor(z / 32));
      if (h < 0.58) { cr = 0.38; cg = 0.5; cb = 0.3; }
      else if (h < 0.82) { cr = 0.62; cg = 0.6; cb = 0.54; }
      else { cr = 0.46; cg = 0.52; cb = 0.36; }
    }
    col[i * 3] = cr * shade;
    col[i * 3 + 1] = cg * shade;
    col[i * 3 + 2] = cb * shade;
  }
  return sheet;
}

// A riverside park is meshed as one sheet. Triangles that fall onto the flood
// wall or the promenade would drape grass over the stone, so those faces go.
function stripBankDrape(geo, onBank, waterLevel) {
  const srcP = geo.position;
  const srcN = geo.normal;
  const srcC = geo.color;
  const pos = [];
  const nrm = [];
  const col = [];
  const wet = Number.isFinite(waterLevel) ? waterLevel : -1e9;
  for (let i = 0; i < srcP.length; i += 9) {
    const ys = [srcP[i + 1], srcP[i + 4], srcP[i + 7]];
    const drop = Math.max(ys[0], ys[1], ys[2]) - Math.min(ys[0], ys[1], ys[2]);
    const mx = (srcP[i] + srcP[i + 3] + srcP[i + 6]) / 3;
    const mz = (srcP[i + 2] + srcP[i + 5] + srcP[i + 8]) / 3;
    const low = Math.min(ys[0], ys[1], ys[2]);
    if (drop > 3.2 && low < wet + 4 && onBank(mx, mz, 16)) continue;
    if (onBank(mx, mz, -4)) continue;
    for (let k = 0; k < 9; k++) {
      pos.push(srcP[i + k]);
      nrm.push(srcN[i + k]);
      col.push(srcC[i + k]);
    }
  }
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    color: new Float32Array(col),
  };
}

export async function loadCity(area, base) {
  const root = `${base}tiles/${area}/`;
  const manifest = await fetch(`${root}manifest.json`).then((r) => {
    if (!r.ok) throw new Error(`没有找到 ${area} 的 manifest`);
    return r.json();
  });
  // The road graph is ~15 MB of JSON. The city draws without it; traffic
  // and the pavement tint wait for this promise.
  const roads = fetch(`${root}roads.json`).then((r) => {
    if (!r.ok) throw new Error(`roads.json ${r.status}`);
    return r.json();
  });
  const [terrainBuf, rails] = await Promise.all([
    fetch(`${root}terrain.tile`).then((r) => r.arrayBuffer()),
    fetch(`${root}rails.json`).then((r) => r.json()),
  ]);
  return { manifest, terrain: decodeTerrain(terrainBuf), roads, rails, root };
}

export function createStreamer({ scene, getView }) {
  const buildingMat = createBuildingMaterial();
  const roadMat = createRoadMaterial();
  const waterMat = createWaterMaterial();
  const groundMat = createGroundMaterial();
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 });
  const signalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.5, metalness: 0.5 });
  const headMat = lampHeadMaterial();
  let waterCount = 0;
  const loaded = new Map();
  const loading = new Set();
  const pickables = [];
  const clusters = createClusters(scene);
  let known = new Set();
  let root = '';
  let grid = null;
  let waterLevel = 0;
  let terrainMesh = null;
  let sheet = null;
  let onBank = () => false;
  const signAtlas = { current: null };

  function yAt(x, z, kind) {
    if (kind === LAND.WATER) return waterLevel;
    if (kind === LAND.PIER) return waterLevel + 1.35;
    return sampleGrid(grid, x, z) + (kind === LAND.PLAZA ? 0.16 : 0.12);
  }

  function meshTile(tile) {
    const group = new THREE.Group();
    group.userData.buildings = tile.buildings.map((b) => ({
      name: b.name,
      kind: KIND_NAME[b.kind] || '建筑',
      storeys: b.storeys,
      height: Math.max(0, b.topY - b.baseY),
    }));
    // The meshes a distant block of tiles merges into one draw each.
    const parts = {
      building: null, land: null, road: null, water: null,
    };
    group.userData.parts = parts;
    const built = buildBuildingGeometry(tile.buildings);
    if (built.position.length) {
      const geo = new THREE.BufferGeometry();
      setAttr(geo, 'position', built.position, 3);
      setAttr(geo, 'normal', built.normal, 3);
      setAttr(geo, 'color', built.color, 3);
      setAttr(geo, 'aSeed', built.seed, 1);
      setAttr(geo, 'aBase', built.base, 1);
      setAttr(geo, 'aTop', built.top, 1);
      setAttr(geo, 'aKind', built.kind, 1);
      setAttr(geo, 'aId', built.id, 1);
      setAttr(geo, 'aWall', built.wall, 3);
      const mesh = new THREE.Mesh(geo, buildingMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.buildings = group.userData.buildings;
      group.add(mesh);
      pickables.push(mesh);
      parts.building = mesh;
    }
    const opaque = tile.land.filter((f) => f.kind !== LAND.WATER);
    const water = tile.land.filter((f) => f.kind === LAND.WATER);
    const landGeo = stripBankDrape(buildLandGeometry(opaque, yAt), onBank, waterLevel);
    if (landGeo.position.length) {
      const geo = new THREE.BufferGeometry();
      setAttr(geo, 'position', landGeo.position, 3);
      setAttr(geo, 'normal', landGeo.normal, 3);
      setAttr(geo, 'color', landGeo.color, 3);
      const mesh = new THREE.Mesh(geo, groundMat);
      mesh.receiveShadow = true;
      mesh.layers.set(DETAIL_LAYER);
      group.add(mesh);
      parts.land = mesh;
    }
    const waterGeo = buildLandGeometry(water, yAt);
    if (waterGeo.position.length) {
      const geo = new THREE.BufferGeometry();
      setAttr(geo, 'position', waterGeo.position, 3);
      setAttr(geo, 'normal', waterGeo.normal, 3);
      const mesh = new THREE.Mesh(geo, waterMat);
      mesh.layers.set(WATER_LAYER);
      group.add(mesh);
      parts.water = mesh;
      group.userData.water = true;
    }
    const roads = roadGeometry(tile.roads);
    if (roads) {
      const mesh = new THREE.Mesh(roads, roadMat);
      mesh.receiveShadow = true;
      mesh.layers.set(DETAIL_LAYER);
      group.add(mesh);
      parts.road = mesh;
    }
    const trees = tile.props.filter((p) => p.kind === PROP.TREE);
    const lights = tile.props.filter((p) => p.kind === PROP.LIGHT);
    const lamps = tile.props.filter((p) => p.kind === PROP.LAMP);
    const signs = tile.props.filter((p) => p.kind === PROP.SIGN);
    const blocks = tile.props.filter((p) => p.kind === PROP.AC || p.kind === PROP.TANK || p.kind === PROP.PENTHOUSE || p.kind === PROP.PIER);
    const cupolas = tile.props.filter((p) => p.kind === PROP.CUPOLA);
    const tree = instanceProps(PROP.TREE, trees, treeGeometry(), treeMat);
    const treeFar = instanceProps(PROP.TREE, trees, treeGeometryFar(), treeMat);
    if (tree) group.add(tree);
    if (treeFar) {
      treeFar.castShadow = false;
      treeFar.visible = false;
      group.add(treeFar);
    }
    if (tree) {
      group.userData.treeLod = {
        near: tree,
        far: treeFar,
        cx: (tile.tx + 0.5) * TILE,
        cz: (tile.tz + 0.5) * TILE,
      };
    }
    const signalGeo = signalGeometry();
    const signals = signalGeo ? instanceProps(PROP.LIGHT, lights, signalGeo, signalMat) : null;
    if (signals) group.add(signals);
    const lampsGeo = lampGeometries();
    const poles = instanceProps(PROP.LAMP, lamps, lampsGeo.pole, poleMat);
    const heads = instanceProps(PROP.LAMP, lamps, lampsGeo.head, headMat);
    if (poles) group.add(poles);
    if (heads) group.add(heads);
    group.userData.pools = lampPools(lamps);
    const sign = signMesh(signs, signAtlas.current);
    if (sign) group.add(sign);
    const blocksMesh = staticPropMesh(blocks);
    if (blocksMesh) group.add(blocksMesh);
    const roofs = cupolaMesh(cupolas);
    if (roofs) group.add(roofs);
    // Street furniture is a few pixels past a kilometre and never reads in
    // the river; it stays out of the mirror and drops out with distance.
    const props = [tree, treeFar, signals, poles, heads, sign, blocksMesh, roofs].filter(Boolean);
    for (const mesh of props) mesh.layers.set(DETAIL_LAYER);
    group.userData.props = [signals, poles, heads, sign, blocksMesh, roofs].filter(Boolean);
    group.userData.cx = (tile.tx + 0.5) * TILE;
    group.userData.cz = (tile.tz + 0.5) * TILE;
    group.userData.near = true;
    return group;
  }

  async function loadTile(key) {
    if (loaded.has(key) || loading.has(key) || !known.has(key)) return;
    loading.add(key);
    try {
      const res = await fetch(`${root}t_${key}.tile`);
      if (!res.ok) throw new Error(`tile ${key} ${res.status}`);
      const tile = decodeTile(await res.arrayBuffer());
      if (!known.has(key)) return;
      const group = meshTile(tile);
      group.userData.key = key;
      scene.add(group);
      clusters.add(group, tile.tx, tile.tz);
      if (group.userData.pools) lampScene.add(group.userData.pools);
      if (group.userData.water) waterCount += 1;
      loaded.set(key, group);
    } catch (error) {
      console.warn(error);
    } finally {
      loading.delete(key);
    }
  }

  function unload(key) {
    const group = loaded.get(key);
    if (!group) return;
    scene.remove(group);
    clusters.remove(group);
    if (group.userData.pools) {
      lampScene.remove(group.userData.pools);
      group.userData.pools.dispose();
    }
    if (group.userData.water) waterCount -= 1;
    group.traverse((obj) => {
      if (obj.userData?.buildings) {
        const i = pickables.indexOf(obj);
        if (i >= 0) pickables.splice(i, 1);
      }
      if (obj.geometry && !obj.userData.sharedGeo && !obj.geometry.userData?.sharedGeo) obj.geometry.dispose();
    });
    loaded.delete(key);
  }

  return {
    buildingMat,
    roadMat,
    waterMat,
    headMat,
    get hasWater() { return waterCount > 0; },
    get loadedCount() { return loaded.size; },
    get total() { return known.size; },
    pickables,
    async start(city, atlas) {
      root = city.root;
      grid = city.terrain;
      waterLevel = city.manifest.waterLevel ?? sampleGrid(grid, 0, 0);
      onBank = hardBankHash(embankmentSegments(city.manifest.embankments));
      known = new Set(city.manifest.tiles);
      signAtlas.current = atlas;
      sheet = paintTerrain(terrainSheet(grid, waterLevel, city.manifest.embankments), null);
      terrainMesh = buildTerrainChunks(sheet, groundMat);
      scene.add(terrainMesh);
      this.update();
      if (city.manifest.landmarks?.length) {
        const models = mergeChildren(createLandmarks(city.manifest.landmarks));
        scene.add(models);
        this.landmarks = models;
      }
      if (city.manifest.bridges?.length) {
        scene.add(mergeChildren(createBridges(city.manifest.bridges)));
      }
      if (city.manifest.embankments?.length) {
        scene.add(createEmbankments(city.manifest.embankments, grid, waterLevel));
      }
    },
    // roads.json arrives after the first frame; the pavement beside each
    // carriageway is painted into the terrain then.
    paintRoads(roads) {
      if (!sheet || !terrainMesh) return;
      repaintTerrain(terrainMesh, paintTerrain(sheet, roads).col);
    },
    syncNight(night) {
      syncLandmarkNight(night);
      syncBridgeNight(night);
    },
    update() {
      const { target, camera } = getView();
      const dist = camera.position.distanceTo(target);
      const altitude = Math.max(0, camera.position.y - 40);
      // Street level stays inside a neighbourhood. From a high overview the
      // cap grows so the river section in frame is actually loaded.
      const cap = altitude > 400 ? Math.min(3600, 900 + altitude) : 1500;
      // The Bund row is nearly a kilometre. A camera parked mid-river used to
      // drop the north and south ends once they left a 420 m disc.
      const reach = Math.min(cap, Math.max(780, dist * 0.85, altitude > 400 ? altitude * 0.9 : 0));
      const want = new Set();
      const cover = (x, z, radius) => {
        const [tx, tz] = tileOf(x, z);
        const r = Math.ceil(radius / TILE);
        for (let i = tx - r; i <= tx + r; i++) {
          for (let j = tz - r; j <= tz + r; j++) {
            const key = tileKey(i, j);
            if (known.has(key)) want.add(key);
          }
        }
      };
      cover(target.x, target.z, reach);
      cover(camera.position.x, camera.position.z, reach * 0.65);
      if (terrainMesh) updateTerrainLod(terrainMesh, camera);
      const eyeY = Math.max(0, camera.position.y);
      for (const group of loaded.values()) {
        const { cx, cz } = group.userData;
        const flat = Math.hypot(camera.position.x - cx, camera.position.z - cz);
        const dist = Math.hypot(flat, eyeY);
        const near = dist < PROP_RANGE;
        if (near !== group.userData.near) {
          group.userData.near = near;
          for (const mesh of group.userData.props) mesh.visible = near;
        }
        const lod = group.userData.treeLod;
        if (!lod?.near) continue;
        const far = flat > 170;
        lod.near.visible = !far;
        if (lod.far) lod.far.visible = far && dist < TREE_RANGE;
      }
      for (const key of loaded.keys()) if (!want.has(key)) unload(key);
      for (const key of want) loadTile(key);
      clusters.update(camera.position);
    },
    heightAt(x, z) {
      return grid ? sampleGrid(grid, x, z) : 0;
    },
  };
}

import * as THREE from 'three';
import { TILE, tileKey, tileOf } from '../shared/geo.js';
import { LAND } from '../shared/kinds.js';
import { buildBuildingGeometry, buildLandGeometry } from '../shared/meshbuild.js';
import { decodeTerrain, sampleGrid } from '../shared/terrain.js';
import { decodeTile } from '../shared/tileformat.js';
import { KIND_NAME } from '../shared/kinds.js';
import { createBuildingMaterial, createRoadMaterial, createWaterMaterial } from './materials.js';
import {
  instanceProps, lampGeometries, lampHeadMaterial, signMesh, staticPropMesh, treeGeometry,
} from './props.js';
import { PROP } from '../shared/kinds.js';

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

function terrainGeometry(grid) {
  const { originX, originZ, step, cols, rows, heights } = grid;
  const pos = new Float32Array(cols * rows * 3);
  const col = new Float32Array(cols * rows * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = originX + c * step;
      const z = originZ + r * step;
      const y = heights[i];
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      const shade = 0.86 + 0.14 * Math.sin(x * 0.04) * Math.cos(z * 0.035);
      col[i * 3] = 0.48 * shade;
      col[i * 3 + 1] = 0.5 * shade;
      col[i * 3 + 2] = 0.44 * shade;
    }
  }
  const idx = [];
  const vi = (c, r) => r * cols + c;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = vi(c, r);
      const b = vi(c + 1, r);
      const d = vi(c, r + 1);
      const e = vi(c + 1, r + 1);
      idx.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export async function loadCity(area, base) {
  const root = `${base}tiles/${area}/`;
  const manifest = await fetch(`${root}manifest.json`).then((r) => {
    if (!r.ok) throw new Error(`没有找到 ${area} 的 manifest`);
    return r.json();
  });
  const [terrainBuf, roads, rails] = await Promise.all([
    fetch(`${root}terrain.bin`).then((r) => r.arrayBuffer()),
    fetch(`${root}roads.json`).then((r) => r.json()),
    fetch(`${root}rails.json`).then((r) => r.json()),
  ]);
  return { manifest, terrain: decodeTerrain(terrainBuf), roads, rails, root };
}

export function createStreamer({ scene, getView }) {
  const buildingMat = createBuildingMaterial();
  const roadMat = createRoadMaterial();
  const waterMat = createWaterMaterial();
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
  const headMat = lampHeadMaterial();
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0xffc98a,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
  });
  const loaded = new Map();
  const loading = new Set();
  const pickables = [];
  let known = new Set();
  let root = '';
  let grid = null;
  let waterLevel = 0;
  let terrainMesh = null;
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
    }
    const opaque = tile.land.filter((f) => f.kind !== LAND.WATER);
    const water = tile.land.filter((f) => f.kind === LAND.WATER);
    const landGeo = buildLandGeometry(opaque, yAt);
    if (landGeo.position.length) {
      const geo = new THREE.BufferGeometry();
      setAttr(geo, 'position', landGeo.position, 3);
      setAttr(geo, 'normal', landGeo.normal, 3);
      setAttr(geo, 'color', landGeo.color, 3);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const waterGeo = buildLandGeometry(water, yAt);
    if (waterGeo.position.length) {
      const geo = new THREE.BufferGeometry();
      setAttr(geo, 'position', waterGeo.position, 3);
      setAttr(geo, 'normal', waterGeo.normal, 3);
      const mesh = new THREE.Mesh(geo, waterMat);
      mesh.renderOrder = 2;
      group.add(mesh);
    }
    const roads = roadGeometry(tile.roads);
    if (roads) {
      const mesh = new THREE.Mesh(roads, roadMat);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const trees = tile.props.filter((p) => p.kind === PROP.TREE);
    const lamps = tile.props.filter((p) => p.kind === PROP.LAMP);
    const signs = tile.props.filter((p) => p.kind === PROP.SIGN);
    const blocks = tile.props.filter((p) => p.kind === PROP.AC || p.kind === PROP.TANK || p.kind === PROP.PENTHOUSE || p.kind === PROP.PIER);
    const tree = instanceProps(PROP.TREE, trees, treeGeometry(), treeMat);
    if (tree) group.add(tree);
    const lampsGeo = lampGeometries();
    const poles = instanceProps(PROP.LAMP, lamps, lampsGeo.pole, poleMat);
    const heads = instanceProps(PROP.LAMP, lamps, lampsGeo.head, headMat);
    if (poles) group.add(poles);
    if (heads) group.add(heads);
    if (lamps.length) {
      const poolGeo = new THREE.PlaneGeometry(1, 1);
      poolGeo.rotateX(-Math.PI / 2);
      const pools = new THREE.InstancedMesh(poolGeo, poolMat, lamps.length);
      pools.userData.sharedGeo = true;
      pools.renderOrder = 3;
      pools.frustumCulled = false;
      const dummy = new THREE.Object3D();
      lamps.forEach((lamp, i) => {
        dummy.position.set(lamp.x, lamp.y + 0.25, lamp.z);
        dummy.scale.set(16, 16, 16);
        dummy.updateMatrix();
        pools.setMatrixAt(i, dummy.matrix);
      });
      group.add(pools);
    }
    const sign = signMesh(signs, signAtlas.current);
    if (sign) group.add(sign);
    const blocksMesh = staticPropMesh(blocks);
    if (blocksMesh) group.add(blocksMesh);
    return group;
  }

  async function loadTile(key) {
    if (loaded.has(key) || loading.has(key) || !known.has(key)) return;
    loading.add(key);
    try {
      const res = await fetch(`${root}t_${key}.bin`);
      if (!res.ok) throw new Error(`tile ${key} ${res.status}`);
      const tile = decodeTile(await res.arrayBuffer());
      if (!known.has(key)) return;
      const group = meshTile(tile);
      group.userData.key = key;
      scene.add(group);
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
    poolMat,
    get loadedCount() { return loaded.size; },
    get total() { return known.size; },
    pickables,
    async start(city, atlas) {
      root = city.root;
      grid = city.terrain;
      waterLevel = city.manifest.waterLevel ?? sampleGrid(grid, 0, 0);
      known = new Set(city.manifest.tiles);
      signAtlas.current = atlas;
      const geo = terrainGeometry(grid);
      terrainMesh = new THREE.Mesh(geo, terrainMat);
      terrainMesh.receiveShadow = true;
      scene.add(terrainMesh);
      this.update();
    },
    update() {
      const { target, camera } = getView();
      const reach = Math.min(1100, Math.max(420, camera.position.distanceTo(target) * 0.8));
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
      for (const key of loaded.keys()) if (!want.has(key)) unload(key);
      for (const key of want) loadTile(key);
    },
    heightAt(x, z) {
      return grid ? sampleGrid(grid, x, z) : 0;
    },
  };
}

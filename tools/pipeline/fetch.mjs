import fs from 'node:fs';
import path from 'node:path';
import { encodeTerrain } from '../../src/shared/terrain.js';
import { resolveArea } from './config.mjs';
import { makeGrid, readTerrarium, sampleTerrarium, tileRange } from './dem.mjs';

const OVERPASS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const USER_AGENT = 'shanghai-3d-city/0.1 (educational compile; local use)';

const QUERIES = {
  buildings: (b) => `way["building"](${b});relation["building"](${b});way["building:part"](${b});relation["building:part"](${b});`,
  roads: (b) => `way["highway"](${b});node["highway"="traffic_signals"](${b});`,
  rails: (b) => `way["railway"](${b});`,
  land: (b) => `way["natural"="water"](${b});relation["natural"="water"](${b});way["waterway"="riverbank"](${b});relation["waterway"="riverbank"](${b});way["waterway"="river"](${b});way["leisure"~"^(park|garden|pitch|playground|plaza)$"](${b});relation["leisure"~"^(park|garden)$"](${b});way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|flowerbed)$"](${b});relation["landuse"~"^(grass|forest|meadow)$"](${b});way["natural"~"^(wood|scrub|wetland)$"](${b});way["man_made"="pier"](${b});way["place"="square"](${b});`,
};

function bboxString(bbox) {
  return `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
}

async function postOverpass(endpoint, query) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`${endpoint} returned ${res.status}`);
  return res.json();
}

async function overpass(query) {
  let last = null;
  for (const endpoint of OVERPASS) {
    try {
      console.log(`  overpass ${endpoint}`);
      return await postOverpass(endpoint, query);
    } catch (error) {
      last = error;
      console.warn(`  failed: ${error.message}`);
    }
  }
  throw last;
}

async function fetchOsm(area) {
  const box = bboxString(area.bbox);
  const elements = [];
  const seen = new Set();
  for (const [name, build] of Object.entries(QUERIES)) {
    const query = `[out:json][timeout:180];(${build(box)});out geom;`;
    console.log(`query ${name}`);
    const json = await overpass(query);
    let added = 0;
    for (const el of json.elements || []) {
      const key = `${el.type}:${el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      elements.push(el);
      added += 1;
    }
    console.log(`  ${added} elements`);
  }
  return { elements, attribution: '© OpenStreetMap contributors' };
}

async function fetchTerrarium(area) {
  const range = tileRange(area.bbox, 14);
  const tiles = new Map();
  console.log(`elevation tiles z${range.z} x ${range.x0}-${range.x1} y ${range.y0}-${range.y1}`);
  for (let x = range.x0; x <= range.x1; x++) {
    for (let y = range.y0; y <= range.y1; y++) {
      const url = `${TERRARIUM}/${range.z}/${x}/${y}.png`;
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`terrain tile ${url} returned ${res.status}`);
      const png = readTerrarium(Buffer.from(await res.arrayBuffer()));
      tiles.set(`${x}_${y}`, png);
    }
  }
  const grid = makeGrid(area, (lon, lat) => sampleTerrarium(tiles, lon, lat, range.z));
  if (grid.valid < grid.total * 0.8) throw new Error('terrain tiles did not cover the area');
  return { grid, source: 'AWS Terrain Tiles / Mapzen Terrarium (includes SRTM and other open DEMs)' };
}

async function fetchOpenMeteo(area) {
  console.log('falling back to Open-Meteo elevation');
  const coarse = { ...area, terrainStep: Math.max(area.terrainStep, 30) };
  const projPoints = [];
  const grid = makeGrid(coarse, () => null);
  // makeGrid with a null sampler fills 4m. Sample for real in batches instead.
  const { originX, originZ, step, cols, rows } = grid;
  const { makeProjection } = await import('../../src/shared/geo.js');
  const proj = makeProjection(area.origin[0], area.origin[1]);
  const coords = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [lon, lat] = proj.unproject(originX + c * step, originZ + r * step);
      coords.push([lat, lon]);
    }
  }
  const heights = new Float32Array(coords.length);
  for (let i = 0; i < coords.length; i += 80) {
    const batch = coords.slice(i, i + 80);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${batch.map((p) => p[0]).join(',')}&longitude=${batch.map((p) => p[1]).join(',')}`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`open-meteo returned ${res.status}`);
    const json = await res.json();
    const values = json.elevation || [];
    for (let k = 0; k < batch.length; k++) heights[i + k] = values[k] ?? 4;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  let min = Infinity;
  let max = -Infinity;
  for (const h of heights) {
    if (h < min) min = h;
    if (h > max) max = h;
  }
  void projPoints;
  return {
    grid: { originX, originZ, step, cols, rows, heights, valid: heights.length, total: heights.length, min, max },
    source: 'Open-Meteo elevation (Copernicus DEM)',
  };
}

async function fetchDem(area) {
  try {
    return await fetchTerrarium(area);
  } catch (error) {
    console.warn(`terrarium failed: ${error.message}`);
    return fetchOpenMeteo(area);
  }
}

async function main() {
  const area = resolveArea();
  fs.mkdirSync(area.rawDir, { recursive: true });
  const osmPath = path.join(area.rawDir, 'osm.json');
  const demPath = path.join(area.rawDir, 'dem.bin');
  const metaPath = path.join(area.rawDir, 'dem.json');
  if (!area.force && fs.existsSync(osmPath) && fs.existsSync(demPath) && fs.existsSync(metaPath)) {
    console.log(`using cached raw data in ${area.rawDir} (pass --force to download again)`);
    return;
  }
  console.log(`fetch ${area.id}  ${area.bbox.south},${area.bbox.west} .. ${area.bbox.north},${area.bbox.east}`);
  const osm = await fetchOsm(area);
  fs.writeFileSync(osmPath, JSON.stringify({ elements: osm.elements }));
  console.log(`wrote ${osm.elements.length} OSM elements`);
  const dem = await fetchDem(area);
  fs.writeFileSync(demPath, encodeTerrain(dem.grid));
  fs.writeFileSync(metaPath, JSON.stringify({
    source: dem.source,
    min: dem.grid.min,
    max: dem.grid.max,
    cols: dem.grid.cols,
    rows: dem.grid.rows,
    step: dem.grid.step,
    valid: dem.grid.valid,
  }, null, 2));
  console.log(`elevation ${dem.grid.min.toFixed(1)}..${dem.grid.max.toFixed(1)} m from ${dem.source}`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'));
if (isMain || process.argv[1]?.endsWith('fetch.mjs')) main().catch((error) => {
  console.error(error);
  process.exit(1);
});

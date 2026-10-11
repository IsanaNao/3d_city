import { BFLAG, KIND, LAND, ROAD, ROOF } from '../../src/shared/kinds.js';
import { classifyKind, parseMetres, resolveVertical, wallColor } from '../../src/shared/heights.js';
import { hashString } from '../../src/shared/rng.js';
import {
  bufferOpen, centroid, cleanRing, ensureWinding, pointInPoly, polygonArea,
} from './geom.mjs';

const DRIVE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street)(_link)?$/;

const WIDTH = {
  motorway: 16, trunk: 14, primary: 12, secondary: 9, tertiary: 7.5,
  unclassified: 6.5, residential: 6, service: 3.6, living_street: 4.2,
  motorway_link: 8, trunk_link: 7.5, primary_link: 7, secondary_link: 6.5, tertiary_link: 6,
};

const SPEED = {
  motorway: 22, trunk: 16, primary: 13, secondary: 11, tertiary: 9,
  unclassified: 8, residential: 7, service: 4.5, living_street: 4,
  motorway_link: 12, trunk_link: 11, primary_link: 9, secondary_link: 8, tertiary_link: 7,
};

const CLASS = {
  motorway: ROAD.MOTORWAY, trunk: ROAD.PRIMARY, primary: ROAD.PRIMARY,
  secondary: ROAD.SECONDARY, tertiary: ROAD.TERTIARY, unclassified: ROAD.RESIDENTIAL,
  residential: ROAD.RESIDENTIAL, service: ROAD.SERVICE, living_street: ROAD.SERVICE,
  motorway_link: ROAD.LINK, trunk_link: ROAD.LINK, primary_link: ROAD.LINK,
  secondary_link: ROAD.LINK, tertiary_link: ROAD.LINK,
};

function elementLine(el, proj) {
  const geom = el.geometry;
  if (!geom || geom.length < 2) return null;
  const points = [];
  for (const g of geom) {
    if (g.lon == null || g.lat == null) continue;
    const [x, z] = proj.project(g.lon, g.lat);
    const prev = points[points.length - 1];
    if (prev && Math.hypot(x - prev[0], z - prev[1]) < 0.08) continue;
    points.push([x, z]);
  }
  if (points.length < 2) return null;
  const closed = Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 0.7;
  if (closed) points.pop();
  return { points, closed: closed && points.length >= 3 };
}

function stitch(lines) {
  const pool = lines.map((line) => line.map((p) => p.slice()));
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.9;
  const rings = [];
  while (pool.length) {
    let cur = pool.pop();
    let moved = true;
    while (moved) {
      moved = false;
      for (let i = 0; i < pool.length; i++) {
        const line = pool[i];
        if (near(cur.at(-1), line[0])) cur = cur.concat(line.slice(1));
        else if (near(cur.at(-1), line.at(-1))) cur = cur.concat(line.slice(0, -1).reverse());
        else if (near(cur[0], line.at(-1))) cur = line.concat(cur.slice(1));
        else if (near(cur[0], line[0])) cur = line.slice().reverse().concat(cur.slice(1));
        else continue;
        pool.splice(i, 1);
        moved = true;
        break;
      }
    }
    if (cur.length >= 2 && near(cur[0], cur.at(-1))) cur.pop();
    if (cur.length >= 3) rings.push(cur);
    else if (cur.length >= 2) rings.push(cur);
  }
  return rings;
}

function relationPolys(el, proj) {
  const outers = [];
  const inners = [];
  for (const member of el.members || []) {
    if (member.type && member.type !== 'way') continue;
    const line = elementLine({ geometry: member.geometry }, proj);
    if (!line) continue;
    const pts = line.closed ? line.points : line.points;
    if (member.role === 'inner') inners.push(pts);
    else outers.push(pts);
  }
  const outerRings = stitch(outers).filter((r) => r.length >= 3);
  const innerRings = stitch(inners).filter((r) => r.length >= 3);
  return outerRings.map((outer) => ({
    outer,
    holes: innerRings.filter((hole) => {
      const c = centroid(hole);
      return pointInPoly(c[0], c[1], outer);
    }),
  }));
}

export function carriageWidth(tags, highway) {
  const name = tags.name || '';
  const lanes = Number.parseFloat(tags.lanes);
  const tagged = parseMetres(tags.width);
  // Century Avenue is a 100 m boulevard. Each OSM carriageway is one direction;
  // a bare lane count understates the bus lanes and the shoulder.
  if (/世纪大道/.test(name)) {
    const n = lanes >= 1 && lanes <= 10 ? lanes : 4;
    return Math.max(tagged > 3 ? tagged : 0, n * 3.6 + 3);
  }
  const elevated = tags.bridge === 'yes' || tags.bridge === 'viaduct' || Number(tags.layer) > 0;
  if (elevated && (highway === 'trunk' || highway === 'motorway' || highway === 'trunk_link')) {
    const n = lanes >= 1 && lanes <= 8 ? lanes : 2;
    return Math.max(tagged > 3 && tagged < 48 ? tagged : 0, n * 3.6 + 2.2);
  }
  if (tagged > 3 && tagged < 48) return tagged;
  if (lanes >= 1 && lanes <= 10) return lanes * 3.35 + 0.5;
  return WIDTH[highway] || 6.5;
}

// Nanpu's stacked spiral and the Yangpu crossing sit far above a normal viaduct.
export function deckLift(tags, points, bridge, lv) {
  if (!bridge) return 0;
  const name = tags.name || '';
  if (/南浦大桥/.test(name)) return lv >= 3 ? 34 : lv === 2 ? 22 : 12;
  if (/内环高架路/.test(name) && points.length >= 2) {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    const mid = points[points.length >> 1];
    if (len > 700 && len < 860 && mid[0] > 3600 && mid[0] < 4500 && mid[1] < -1900 && mid[1] > -2500) return 36;
  }
  return 5.2 + Math.max(0, lv - 1) * 3.4;
}

export function laneCount(width) {
  return Math.max(1, Math.min(8, Math.round((width - 0.5) / 3.35)));
}

export function sidewalkWidthFor(highway, bridge, name = '') {
  if (bridge) return 0;
  if (String(highway).includes('motorway') || highway === 'trunk' || highway === 'trunk_link') return 0;
  if (/世纪大道|陆家嘴环路|中山东/.test(name)) return 7.2;
  if (highway === 'service' || highway === 'living_street') return 2.4;
  if (highway === 'primary' || highway === 'secondary' || highway === 'primary_link') return 4.4;
  return 3.5;
}

// Per-vertex deck height above the ground. Ramps fall from the viaduct to the street.
export function liftAlong(road, points) {
  const n = points.length;
  const acc = new Array(n);
  acc[0] = 0;
  for (let i = 1; i < n; i++) {
    acc[i] = acc[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  const total = acc[n - 1] || 1;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let lift = road.lift || 0;
    if (road.ramp) {
      const u = road.highAtStart ? acc[i] / total : 1 - acc[i] / total;
      lift = road.liftHigh + (road.liftLow - road.liftHigh) * u;
    }
    out[i] = lift;
  }
  return out;
}

function nearestDist(p, roads) {
  let best = Infinity;
  for (const road of roads) {
    for (const q of road.points) {
      const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

// The Yangpu span sits about 36 m up. The inner-ring ways that meet it are the
// approaches: slope them from the span down to a normal viaduct, instead of a cliff.
export function gradeYangpuApproaches(roads) {
  const spans = roads.filter((road) => road.bridge && road.lift >= 30 && /内环高架路/.test(road.name || ''));
  if (!spans.length) return;
  const joints = [];
  for (const span of spans) joints.push(span.points[0], span.points[span.points.length - 1]);
  const near = (p) => joints.some((j) => Math.hypot(j[0] - p[0], j[1] - p[1]) < 45);
  for (const road of roads) {
    if (!road.bridge || road.ramp || road.lift >= 30) continue;
    if (!/内环高架路/.test(road.name || '')) continue;
    const start = near(road.points[0]);
    const end = near(road.points[road.points.length - 1]);
    if (!start && !end) continue;
    road.ramp = true;
    road.liftHigh = 36;
    road.liftLow = road.lift || 5.2;
    road.highAtStart = start && !end ? true : end && !start ? false : start;
  }
}

function gradeRamps(roads) {
  const mains = roads.filter((road) => road.drive && road.bridge && !road.link);
  const decks = roads.filter((road) => road.bridge && road.ribbon && !road.steps);
  for (const road of roads) {
    const a = road.points[0];
    const b = road.points.at(-1);
    if (road.drive && road.link && road.bridge && mains.length) {
      const da = nearestDist(a, mains);
      const db = nearestDist(b, mains);
      if (Math.min(da, db) > 50) continue;
      road.ramp = true;
      road.liftHigh = road.lift;
      road.liftLow = 0.35;
      road.highAtStart = da <= db;
    } else if (road.steps && road.bridge && decks.length) {
      const da = nearestDist(a, decks);
      const db = nearestDist(b, decks);
      if (Math.min(da, db) > 30) continue;
      road.ramp = true;
      road.liftHigh = road.lift;
      road.liftLow = 0.2;
      road.highAtStart = da <= db;
    }
  }
}

function parseSpeed(tags, fallback) {
  if (!tags.maxspeed) return fallback;
  const raw = String(tags.maxspeed);
  const match = raw.match(/[\d.]+/);
  if (!match) return fallback;
  let v = Number(match[0]);
  if (/mph/i.test(raw)) v *= 0.44704;
  else v /= 3.6;
  return Math.max(3, Math.min(28, v));
}

function insideRing(p, ring) {
  return pointInPoly(p[0], p[1], ring);
}

function outsideChannel(points, masks) {
  if (!masks.length) return points.length >= 2 ? [points] : [];
  const wet = (p) => masks.some((ring) => insideRing(p, ring));
  const edge = (dry, soaked) => {
    let a = dry;
    let b = soaked;
    for (let k = 0; k < 10; k++) {
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (wet(m)) b = m;
      else a = m;
    }
    return a;
  };
  const runs = [];
  let cur = [];
  for (const p of points) {
    if (!wet(p)) {
      cur.push(p);
      continue;
    }
    if (cur.length) {
      cur.push(edge(cur[cur.length - 1], p));
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

function landKind(tags) {
  const leisure = tags.leisure;
  const landuse = tags.landuse;
  const natural = tags.natural;
  if (natural === 'water' || tags.water || tags.waterway === 'riverbank') return LAND.WATER;
  if (natural === 'wood' || landuse === 'forest') return LAND.WOOD;
  if (leisure === 'park' || leisure === 'garden' || landuse === 'grass' || landuse === 'meadow'
    || landuse === 'village_green' || landuse === 'recreation_ground' || landuse === 'flowerbed'
    || natural === 'scrub' || natural === 'wetland' || leisure === 'playground') return LAND.PARK;
  if (leisure === 'pitch') return LAND.PITCH;
  if (tags.man_made === 'pier' || tags.place === 'square' || leisure === 'plaza') return LAND.PIER;
  if (tags.highway === 'pedestrian' && tags.area === 'yes') return LAND.PLAZA;
  return null;
}

const ROOF_SHAPES = {
  dome: ROOF.DOME, round: ROOF.DOME, half_dome: ROOF.DOME,
  pyramidal: ROOF.PYRAMID, hipped: ROOF.PYRAMID, cone: ROOF.PYRAMID,
  onion: ROOF.ONION,
};

function roofOf(tags, area, wallHeight) {
  const shape = ROOF_SHAPES[String(tags['roof:shape'] || '').toLowerCase()] ?? ROOF.FLAT;
  if (shape === ROOF.FLAT) return { roofShape: ROOF.FLAT, roofHeight: 0 };
  const radius = Math.sqrt(area / Math.PI);
  const fallback = shape === ROOF.PYRAMID ? radius * 0.55 : radius * (shape === ROOF.ONION ? 1.3 : 0.8);
  const tagged = parseMetres(tags['roof:height']);
  const roofHeight = Math.min(tagged ?? fallback, wallHeight * 0.8, 60);
  return roofHeight > 0.8 ? { roofShape: shape, roofHeight } : { roofShape: ROOF.FLAT, roofHeight: 0 };
}

function isGlass(tags) {
  const material = String(tags['building:material'] || tags['building:facade:material'] || '').toLowerCase();
  return material === 'glass' || material === 'mirror';
}

function makeBuilding(outer, holes, tags, sampleHeight, seq) {
  const cleaned = cleanRing(outer);
  if (cleaned.length < 3) return null;
  const area = polygonArea(cleaned);
  if (area < 8 || area > 400000) return null;
  const vertical = resolveVertical(tags, area);
  const samples = [centroid(cleaned)];
  const step = Math.max(1, Math.floor(cleaned.length / 6));
  for (let i = 0; i < cleaned.length; i += step) samples.push(cleaned[i]);
  const heights = samples.map((p) => sampleHeight(p[0], p[1])).sort((a, b) => a - b);
  const ground = heights[heights.length >> 1];
  if (!Number.isFinite(ground)) return null;
  const kind = classifyKind(tags, vertical.top);
  const id = seq.value++;
  let flags = vertical.minHeight > 0.6 ? BFLAG.FLOATING : 0;
  if (isGlass(tags)) flags |= BFLAG.GLASS;
  return {
    id,
    part: Boolean(tags['building:part'] && tags['building:part'] !== 'no'),
    kind,
    name: tags.name || tags['name:zh'] || '',
    storeys: vertical.storeys,
    flags,
    ...roofOf(tags, area, vertical.top - vertical.minHeight),
    baseY: ground + vertical.minHeight,
    topY: ground + vertical.top,
    minHeight: vertical.minHeight,
    color: wallColor(kind, hashString(tags.name || id), vertical.top, tags),
    area,
    centroid: centroid(cleaned),
    rings: [ensureWinding(cleaned, true), ...holes.map((h) => ensureWinding(cleanRing(h), false)).filter((h) => h.length >= 3)],
  };
}

function suppressOutlines(buildings) {
  const parts = buildings.filter((b) => b.part);
  if (!parts.length) return buildings;
  const kept = [];
  for (const outline of buildings) {
    if (!outline.part) {
      const covered = parts.some((part) => part.area < outline.area * 0.98
        && pointInPoly(part.centroid[0], part.centroid[1], outline.rings[0]));
      if (covered) continue;
    }
    kept.push(outline);
  }
  return kept;
}

export function parseCity(elements, proj, sampleHeight) {
  const buildings = [];
  const land = [];
  const openWater = [];
  const roads = [];
  const rails = [];
  const signals = [];
  const seq = { value: 1 };
  const seen = new Set();

  for (const el of elements) {
    if (!el || el.type === 'node') {
      if (el?.type === 'node' && el.tags?.highway === 'traffic_signals' && el.lon != null) {
        const [x, z] = proj.project(el.lon, el.lat);
        signals.push({ x, z });
      }
      continue;
    }
    const key = `${el.type}:${el.id}`;
    if (el.id != null && seen.has(key)) continue;
    if (el.id != null) seen.add(key);
    const tags = el.tags || {};
    if (tags.location === 'underground' && !tags.railway && !tags.building && !tags['building:part']) continue;

    if (el.type === 'way' && (tags.building || tags['building:part'])) {
      const line = elementLine(el, proj);
      if (!line?.closed) continue;
      const building = makeBuilding(line.points, [], tags, sampleHeight, seq);
      if (building) buildings.push(building);
      continue;
    }
    if (el.type === 'relation' && (tags.building || tags['building:part'])) {
      for (const poly of relationPolys(el, proj)) {
        const building = makeBuilding(poly.outer, poly.holes, tags, sampleHeight, seq);
        if (building) buildings.push(building);
      }
      continue;
    }
    const channel = tags.waterway === 'river' || tags.waterway === 'canal' || tags.waterway === 'stream';
    if ((el.type === 'way' || el.type === 'relation') && (landKind(tags) != null || tags.natural === 'water' || tags.waterway === 'riverbank' || channel)) {
      const kind = landKind(tags) ?? LAND.WATER;
      if (el.type === 'relation') {
        for (const poly of relationPolys(el, proj)) {
          if (polygonArea(poly.outer) < 20) continue;
          land.push({
            kind,
            rings: [ensureWinding(poly.outer, true), ...poly.holes.map((h) => ensureWinding(h, false))],
          });
        }
      } else {
        const line = elementLine(el, proj);
        if (!line) continue;
        if (line.closed && polygonArea(line.points) >= 20) {
          land.push({ kind, rings: [ensureWinding(line.points, true)] });
        } else if (!line.closed && (tags.man_made === 'pier' || tags.waterway === 'riverbank')) {
          const poly = bufferOpen(line.points, tags.man_made === 'pier' ? 5 : 18);
          if (poly && polygonArea(poly) > 20) land.push({ kind, rings: [ensureWinding(poly, true)] });
        } else if (!line.closed && channel) {
          openWater.push({ points: line.points, tags });
        }
      }
      continue;
    }
    if (el.type === 'way' && tags.highway) {
      const highway = tags.highway;
      const line = elementLine(el, proj);
      if (!line || line.points.length < 2) continue;
      const points = line.closed ? [...line.points, line.points[0].slice()] : line.points;
      if (DRIVE.test(highway) && tags.tunnel !== 'yes' && tags.tunnel !== 'culvert') {
        let oneway = tags.oneway === 'yes' || tags.oneway === '1' || tags.junction === 'roundabout';
        if ((highway === 'motorway' || highway === 'motorway_link') && tags.oneway !== 'no') oneway = true;
        let ordered = points;
        if (tags.oneway === '-1') {
          ordered = points.slice().reverse();
          oneway = true;
        }
        const layer = Number(tags.layer);
        const bridge = tags.bridge === 'yes' || tags.bridge === 'viaduct' || tags.bridge === 'cantilever' || layer > 0;
        const lv = Number.isFinite(layer) && layer > 0 ? layer : 1;
        const lift = deckLift(tags, ordered, bridge, lv);
        const width = carriageWidth(tags, highway);
        roads.push({
          id: el.id,
          points: ordered,
          drive: true,
          oneway,
          bridge,
          link: /_link$/.test(highway),
          width,
          lanes: laneCount(width),
          cls: CLASS[highway] ?? ROAD.RESIDENTIAL,
          speed: parseSpeed(tags, SPEED[highway] || 8),
          lift,
          sidewalk: sidewalkWidthFor(highway, bridge, tags.name || ''),
          name: tags.name || '',
        });
      } else if ((highway === 'footway' || highway === 'path' || highway === 'pedestrian' || highway === 'steps') && (tags.bridge === 'yes' || Number(tags.layer) > 0)) {
        const layer = Number(tags.layer);
        const lv = Number.isFinite(layer) && layer > 0 ? layer : 1;
        // The Lujiazui ring is a closed footway on layer 3. That layer is the
        // stack of roads under it, not an 11 m flyover: the deck clears traffic
        // by about six metres. The ring itself is a wide promenade, not a 3 m path.
        const ring = line.closed;
        const steps = highway === 'steps';
        let span = 0;
        if (ring) {
          let minX = Infinity;
          let maxX = -Infinity;
          let minZ = Infinity;
          let maxZ = -Infinity;
          for (const p of points) {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minZ) minZ = p[1];
            if (p[1] > maxZ) maxZ = p[1];
          }
          span = Math.max(maxX - minX, maxZ - minZ);
        }
        // The Lujiazui circular footbridge is the large closed ring (about 110 m
        // across). OSM gives it height=9. Smaller closed footways stay path-width.
        const wideRing = ring && span > 90;
        const taggedH = parseMetres(tags.height);
        const lift = taggedH >= 4 && taggedH <= 16
          ? taggedH
          : (wideRing ? 6.2 : Math.min(6.4, 4.6 + (lv - 1) * 0.8));
        roads.push({
          id: el.id,
          points,
          drive: false,
          oneway: true,
          bridge: true,
          ring: wideRing,
          steps,
          width: wideRing ? 9 : (steps ? 2.6 : 3.6),
          lanes: 1,
          cls: ROAD.SIDEWALK,
          speed: 0,
          lift,
          sidewalk: 0,
          ribbon: true,
        });
      } else if (highway === 'pedestrian' || highway === 'footway' && (tags.name || tags.footway === 'sidewalk' || tags.area === 'yes')) {
        if (line.closed && line.points.length >= 3) {
          land.push({ kind: LAND.PLAZA, rings: [ensureWinding(line.points, true)] });
        } else if (!line.closed) {
          roads.push({
            id: el.id,
            points,
            drive: false,
            oneway: true,
            bridge: false,
            width: highway === 'pedestrian' ? 8 : 4,
            cls: ROAD.SIDEWALK,
            speed: 0,
            lift: 0,
            sidewalk: false,
            ribbon: true,
          });
        }
      }
      continue;
    }
    if (el.type === 'way' && tags.railway) {
      const skip = ['abandoned', 'disused', 'razed', 'proposed', 'construction', 'platform', 'subway_entrance'].includes(tags.railway);
      if (skip) continue;
      const line = elementLine(el, proj);
      if (!line || line.points.length < 2) continue;
      const tunnel = tags.tunnel === 'yes' || tags.tunnel === 'culvert' || Number(tags.layer) < 0 || tags.railway === 'subway';
      const bridge = tags.bridge === 'yes' || Number(tags.layer) > 0;
      rails.push({
        id: el.id,
        points: line.closed ? [...line.points, line.points[0].slice()] : line.points,
        ref: tags.ref || tags.name || '',
        name: tags.name || tags.ref || tags.railway,
        tunnel: tunnel && !bridge,
        bridge,
      });
    }
  }

  const masks = land
    .filter((f) => f.kind === LAND.WATER && polygonArea(f.rings[0]) > 40000)
    .map((f) => f.rings[0]);
  for (const item of openWater) {
    const name = item.tags.name || item.tags['name:zh'] || '';
    if (/黄浦江/.test(name)) continue;
    let half = 18;
    if (item.tags.waterway === 'canal') half = 12;
    if (item.tags.waterway === 'stream') half = 7;
    if (/苏州河|吴淞江/.test(name)) half = 40;
    for (const run of outsideChannel(item.points, masks)) {
      const poly = bufferOpen(run, half);
      if (poly && polygonArea(poly) > 40) land.push({ kind: LAND.WATER, rings: [ensureWinding(poly, true)] });
    }
  }

  gradeRamps(roads);
  gradeYangpuApproaches(roads);

  return {
    buildings: suppressOutlines(buildings),
    // Named outlines are dropped once their parts cover them, and the parts
    // usually carry no name. Landmark matching needs the outlines.
    footprints: buildings,
    land,
    roads,
    rails,
    signals,
  };
}

export const stitchRings = stitch;

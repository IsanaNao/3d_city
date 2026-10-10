import { BFLAG, KIND, LAND, ROAD } from '../../src/shared/kinds.js';
import { classifyKind, resolveVertical, wallColor } from '../../src/shared/heights.js';
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
  return {
    id,
    part: Boolean(tags['building:part'] && tags['building:part'] !== 'no'),
    kind,
    name: tags.name || tags['name:zh'] || '',
    storeys: vertical.storeys,
    flags: vertical.minHeight > 0.6 ? BFLAG.FLOATING : 0,
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
    if ((el.type === 'way' || el.type === 'relation') && (landKind(tags) != null || tags.natural === 'water' || tags.waterway === 'riverbank')) {
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
        const lanes = Number.parseFloat(tags.lanes);
        let width = WIDTH[highway] || 6;
        if (lanes > 0) width = Math.max(width, lanes * 3.2);
        let oneway = tags.oneway === 'yes' || tags.oneway === '1' || tags.junction === 'roundabout';
        if ((highway === 'motorway' || highway === 'motorway_link') && tags.oneway !== 'no') oneway = true;
        let ordered = points;
        if (tags.oneway === '-1') {
          ordered = points.slice().reverse();
          oneway = true;
        }
        const bridge = tags.bridge === 'yes' || tags.bridge === 'viaduct' || Number(tags.layer) > 0;
        const lift = bridge ? 6.5 + Math.max(0, (Number(tags.layer) || 1) - 1) * 3.5 : 0;
        roads.push({
          id: el.id,
          points: ordered,
          drive: true,
          oneway,
          bridge,
          width,
          cls: CLASS[highway] ?? ROAD.RESIDENTIAL,
          speed: parseSpeed(tags, SPEED[highway] || 8),
          lift,
          sidewalk: !bridge && !highway.includes('motorway') && highway !== 'trunk',
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

  return {
    buildings: suppressOutlines(buildings),
    land,
    roads,
    rails,
    signals,
  };
}

export const stitchRings = stitch;

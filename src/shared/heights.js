import { KIND } from './kinds.js';

const NAMED = [
  { test: /上海中心|shanghai tower/i, h: 632 },
  { test: /环球金融中心|world financial center/i, h: 492 },
  { test: /东方明珠|oriental pearl/i, h: 468 },
  { test: /金茂|jin mao/i, h: 421 },
  { test: /上海大厦|broadway mansions/i, h: 82 },
  { test: /海关|customs house/i, h: 79 },
];

const CSS = {
  white: 0xf4f1ea, grey: 0xbdb8b0, gray: 0xbdb8b0, beige: 0xe6d3b0, brown: 0x8a6a4f,
  blue: 0x8aa4c2, red: 0xa85a52, green: 0x7d8f78, yellow: 0xd6c27a, black: 0x4a4a4a,
  orange: 0xd08a4c, silver: 0xd5d8dc, pink: 0xd7b4ae,
};

const KIND_COLOR = {
  [KIND.OTHER]: 0xcfc6ba,
  [KIND.RESIDENTIAL]: 0xd9c7b0,
  [KIND.OFFICE]: 0xc5ced6,
  [KIND.COMMERCIAL]: 0xe3d2be,
  [KIND.INDUSTRIAL]: 0xb7b0a6,
  [KIND.LANDMARK]: 0xb7c9d6,
  [KIND.HISTORIC]: 0xe7d3b4,
};

export function parseMetres(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim().toLowerCase();
  if (!s || s === 'none' || s === 'no') return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  let n = Number(m[0]);
  if (!Number.isFinite(n) || n < 0) return null;
  if (s.includes('ft') || s.includes("'")) n *= 0.3048;
  return n;
}

function floorHeight(tags) {
  const b = tags.building || '';
  if (b === 'office' || tags.office) return 3.9;
  if (b === 'residential' || b === 'apartments') return 3.05;
  if (b === 'industrial' || b === 'warehouse') return 5;
  if (b === 'retail' || b === 'commercial' || tags.shop) return 3.6;
  return 3.3;
}

function buildingName(tags) {
  return `${tags.name || ''} ${tags['name:en'] || ''} ${tags['name:zh'] || ''}`;
}

export function defaultHeight(tags, area = 0) {
  const b = tags.building || tags['building:part'] || 'yes';
  if (['roof', 'garage', 'garages', 'shed', 'carport', 'kiosk', 'hut', 'cabin', 'guardhouse', 'service'].includes(b)) return 3.6;
  if (['house', 'detached', 'semidetached_house', 'terrace', 'bungalow'].includes(b)) return 9;
  if (['apartments', 'residential', 'dormitory'].includes(b)) {
    if (area > 700) return 36;
    if (area > 280) return 21;
    return 12;
  }
  if (['commercial', 'retail', 'supermarket'].includes(b) || tags.shop) return area > 900 ? 28 : 12;
  if (['office', 'government', 'civic', 'public'].includes(b) || tags.office) {
    if (area > 1600) return 72;
    if (area > 450) return 36;
    return 18;
  }
  if (['industrial', 'warehouse', 'factory', 'hangar'].includes(b)) return 11;
  if (b === 'hotel') return 48;
  if (['hospital', 'school', 'university', 'train_station', 'transportation'].includes(b)) return 20;
  if (b === 'tower' || b === 'skyscraper') return 120;
  if (area > 5000) return 24;
  if (area > 900) return 18;
  return 12;
}

export function classifyKind(tags, height) {
  const b = tags.building || tags['building:part'] || '';
  const year = Number.parseInt(tags.start_date, 10);
  const name = buildingName(tags);
  if (NAMED.some((entry) => entry.test.test(name)) || height >= 180 || b === 'skyscraper' || b === 'tower') {
    return KIND.LANDMARK;
  }
  if (tags.historic || tags.heritage || (Number.isFinite(year) && year > 1400 && year < 1949)
    || ['church', 'cathedral', 'temple', 'chapel'].includes(b)) {
    return KIND.HISTORIC;
  }
  if (['commercial', 'retail', 'supermarket', 'kiosk', 'shop'].includes(b) || tags.shop) return KIND.COMMERCIAL;
  if (['office', 'government', 'civic', 'public'].includes(b) || tags.office) return KIND.OFFICE;
  if (['residential', 'apartments', 'house', 'detached', 'semidetached_house', 'terrace', 'dormitory'].includes(b)) {
    return KIND.RESIDENTIAL;
  }
  if (['industrial', 'warehouse', 'factory', 'hangar'].includes(b)) return KIND.INDUSTRIAL;
  if (tags.amenity === 'school' || tags.amenity === 'university' || tags.amenity === 'hospital') return KIND.OFFICE;
  return KIND.OTHER;
}

export function resolveVertical(tags, area = 0) {
  const name = buildingName(tags);
  let top = parseMetres(tags.height);
  const levelH = floorHeight(tags);
  if (top == null && tags['building:levels']) {
    const levels = Number.parseFloat(tags['building:levels']);
    if (levels > 0) top = levels * levelH;
  }
  if (top == null) {
    const named = NAMED.find((entry) => entry.test.test(name));
    if (named) top = named.h;
  }
  if (top == null) top = defaultHeight(tags, area);
  top = Math.min(top, 700);
  let minH = parseMetres(tags.min_height);
  if (minH == null && tags['building:min_level']) {
    const minLevel = Number.parseFloat(tags['building:min_level']);
    if (minLevel > 0) minH = minLevel * levelH;
  }
  minH = minH || 0;
  if (top < minH + 2.4) top = minH + Math.max(2.4, defaultHeight(tags, area));
  const storeys = Math.max(1, Math.min(255, Math.round((top - minH) / levelH)));
  return { top, minHeight: minH, storeys };
}

function scaleHex(hex, factor) {
  const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 255) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 255) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((hex & 255) * factor)));
  return (r << 16) | (g << 8) | b;
}

function parseColor(tags) {
  const raw = tags['building:colour'] || tags['building:color'];
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (s.startsWith('#') && /^#[0-9a-f]{6}$/.test(s)) return Number.parseInt(s.slice(1), 16);
  return CSS[s] ?? null;
}

export function wallColor(kind, seed, height, tags = {}) {
  const painted = parseColor(tags);
  let hex = painted ?? KIND_COLOR[kind] ?? KIND_COLOR[KIND.OTHER];
  if (!painted && height > 160) hex = 0xa9c0d0;
  const factor = 0.9 + (seed % 17) / 100;
  return scaleHex(hex, factor);
}

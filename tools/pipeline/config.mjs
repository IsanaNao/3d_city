import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Areas are a centre (the world origin) and a lon/lat box. Grow the box, or add
// another key, then rerun `npm run pipeline -- --area=<id>`.
export const AREAS = {
  bund: {
    name: '外滩 · 陆家嘴',
    description: '黄浦江两岸：外滩历史建筑与陆家嘴天际线',
    bbox: {
      south: 31.2328,
      west: 121.4868,
      north: 31.2452,
      east: 121.5088,
    },
    terrainStep: 8,
  },
};

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { area: 'bund', force: false, bbox: null };
  for (const arg of argv) {
    if (arg.startsWith('--area=')) out.area = arg.slice(7);
    else if (arg === '--force') out.force = true;
    else if (arg.startsWith('--bbox=')) {
      const [south, west, north, east] = arg.slice(7).split(',').map(Number);
      if ([south, west, north, east].some((n) => !Number.isFinite(n))) {
        throw new Error('--bbox expects south,west,north,east');
      }
      out.bbox = { south, west, north, east };
    }
  }
  return out;
}

export function resolveArea(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const base = AREAS[args.area];
  if (!base && !args.bbox) {
    throw new Error(`unknown area "${args.area}" (known: ${Object.keys(AREAS).join(', ')})`);
  }
  const bbox = args.bbox || base.bbox;
  const origin = base?.origin || [(bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2];
  return {
    id: args.area,
    name: base?.name || args.area,
    description: base?.description || '',
    bbox,
    origin,
    terrainStep: base?.terrainStep || 16,
    view: base?.view || null,
    force: args.force,
    rawDir: path.join(ROOT, 'data/raw', args.area),
    outDir: path.join(ROOT, 'public/tiles', args.area),
    tilesRoot: path.join(ROOT, 'public/tiles'),
    root: ROOT,
  };
}

// Local metre frame shared by the compiler and the viewer.
// x = east, y = up, z = south, so north is negative z. Distances are metres.

export const TILE = 256;

export function makeProjection(lon0, lat0) {
  const phi = (lat0 * Math.PI) / 180;
  const mLat = 111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const mLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
  return {
    lon0,
    lat0,
    project(lon, lat) {
      return [(lon - lon0) * mLon, -(lat - lat0) * mLat];
    },
    unproject(x, z) {
      return [x / mLon + lon0, -z / mLat + lat0];
    },
  };
}

export const tileOf = (x, z, tile = TILE) => [Math.floor(x / tile), Math.floor(z / tile)];
export const tileKey = (tx, tz) => `${tx}_${tz}`;

export function tileRect(tx, tz, tile = TILE) {
  return { minX: tx * tile, maxX: (tx + 1) * tile, minZ: tz * tile, maxZ: (tz + 1) * tile };
}

export function boundsFromBbox(proj, bbox) {
  const [westX, northZ] = proj.project(bbox.west, bbox.north);
  const [eastX, southZ] = proj.project(bbox.east, bbox.south);
  return {
    minX: Math.min(westX, eastX),
    maxX: Math.max(westX, eastX),
    minZ: Math.min(northZ, southZ),
    maxZ: Math.max(northZ, southZ),
  };
}

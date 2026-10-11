// A compact solar position for Shanghai. Hour is local civil time (UTC+8),
// dayOfYear is 1..365. Good enough to drive a day/night slider, not a nautical almanac.

const DEG = Math.PI / 180;

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function sunVector(hour, dayOfYear = 172, latDeg = 31.23) {
  const lat = latDeg * DEG;
  const decl = 23.44 * DEG * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81));
  const ha = (hour - 12) * 15 * DEG;
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const altitude = Math.asin(clamp(sinAlt, -1, 1));
  const cosAlt = Math.cos(altitude);
  let cosAz = 0;
  if (cosAlt > 1e-4) {
    cosAz = (Math.sin(decl) - Math.sin(altitude) * Math.sin(lat)) / (cosAlt * Math.cos(lat));
  }
  cosAz = clamp(cosAz, -1, 1);
  let az = Math.acos(cosAz);
  if (ha > 0) az = Math.PI * 2 - az;
  const east = Math.sin(az) * cosAlt;
  const north = Math.cos(az) * cosAlt;
  const up = Math.sin(altitude);
  const len = Math.hypot(east, up, north) || 1;
  return { x: east / len, y: up / len, z: -north / len, altitude };
}

// Lights fade in while the sun is still a few degrees up, then the sky follows.
export function nightFactor(altitude) {
  return 1 - smoothstep(-6, 12, altitude * 180 / Math.PI);
}

export function daylight(altitude) {
  return smoothstep(-3, 14, altitude * 180 / Math.PI);
}

// Pale warm haze of the reference dusk. `dusk` forces it, `clear` keeps the
// analytic sky, and with no preset it follows the sun down through late afternoon.
export function duskHaze(altitudeDeg, preset) {
  if (preset === 'dusk') return 1;
  if (preset === 'clear') return 0;
  return smoothstep(16, 4, altitudeDeg) * (1 - smoothstep(1, -8, altitudeDeg));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)];
}

function mixRgb(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function skyColors(altitude) {
  const day = daylight(altitude);
  const deg = altitude * 180 / Math.PI;
  const sunset = Math.exp(-(deg * deg) / 26);
  const dayZenith = hexToRgb(0x8ec6ee);
  const dayHorizon = hexToRgb(0xd7e8f4);
  const setZenith = hexToRgb(0x243056);
  const setHorizon = hexToRgb(0xee8648);
  const nightZenith = hexToRgb(0x070b16);
  const nightHorizon = hexToRgb(0x1c2a48);
  const zenith = mixRgb(mixRgb(nightZenith, setZenith, sunset * (1 - day)), dayZenith, day);
  const horizon = mixRgb(mixRgb(nightHorizon, setHorizon, Math.min(1, sunset * 1.15)), dayHorizon, day);
  const sun = mixRgb(hexToRgb(0xffb15a), hexToRgb(0xfff4dd), day);
  return { zenith, horizon, sun, day, night: nightFactor(altitude), sunset };
}

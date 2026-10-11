// Night lighting programme for the Oriental Pearl.
// A scheme is a pure function of the scene clock: the same hour always
// produces the same colour, chase phase and crossfade. `pearl=<name>` pins
// one scheme for screenshots.

export const PEARL_SCHEMES = ['red', 'magenta', 'blue', 'purple', 'gold', 'green', 'rainbow'];

// Twenty minutes of scene time per scheme, with a short crossfade at the end.
const SLOT_HOURS = 1 / 3;

export function pearlShow(hour, pin) {
  const t = ((Number(hour) % 24) + 24) % 24;
  const phase = t / SLOT_HOURS;
  const index = Math.floor(phase) % PEARL_SCHEMES.length;
  const pattern = phase - Math.floor(phase);
  const fade = pattern > 0.85 ? (pattern - 0.85) / 0.15 : 0;
  const pinned = typeof pin === 'string' && PEARL_SCHEMES.includes(pin);
  const scheme = pinned ? PEARL_SCHEMES.indexOf(pin) : index;
  return {
    scheme,
    name: PEARL_SCHEMES[scheme],
    next: pinned ? scheme : (index + 1) % PEARL_SCHEMES.length,
    fade: pinned ? 0 : fade,
    pattern,
  };
}

// RGB used by the searchlights and the column/leg materials. The sphere
// shader has the same palette; rainbow cells vary across the surface.
export const SCHEME_RGB = [
  [1, 0.05, 0.10],
  [1, 0.06, 0.52],
  [0.15, 0.45, 1],
  [0.55, 0.16, 1],
  [1, 0.72, 0.22],
  [0.15, 0.95, 0.35],
  [1, 0.35, 0.7],
];

export const CROWN_RGB = [
  [0.25, 0.55, 1],
  [0.9, 0.28, 0.75],
  [0.2, 0.9, 1],
  [0.5, 0.28, 1],
  [0.35, 0.8, 1],
  [0.2, 1, 0.55],
  [0.6, 0.4, 1],
];

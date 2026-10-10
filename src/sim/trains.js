import { pathFromFlat, samplePath } from './path.js';

const LINE_COLORS = {
  1: 0xe4002b,
  2: 0x87c232,
  3: 0xfcd600,
  4: 0x512c8c,
  7: 0xff6900,
  8: 0x0094d8,
  9: 0x91c5db,
  10: 0xc9a7d8,
  11: 0x83272d,
  12: 0x007a61,
  13: 0xef95c1,
  14: 0x827a68,
  18: 0xc4984f,
};

export function lineColor(ref) {
  const match = String(ref || '').match(/\d+/);
  if (match && LINE_COLORS[Number(match[0])]) return LINE_COLORS[Number(match[0])];
  let h = 0;
  const s = String(ref || 'rail');
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  const palette = [0xd0d4dc, 0xc4564a, 0x3d7ea6, 0xd0a24a, 0x6a8f4e];
  return palette[h % palette.length];
}

export function prepareLines(data) {
  return (data.lines || []).map((line) => {
    const path = pathFromFlat(line.points);
    const carriages = path.length > 240 ? 4 : path.length > 80 ? 2 : 1;
    return {
      ...line,
      path,
      length: path.length,
      carriages,
      color: lineColor(line.ref || line.name),
    };
  }).filter((line) => line.length > 40);
}

export function createTrains(lines) {
  const trains = [];
  for (const line of lines) {
    const count = Math.min(3, Math.max(1, Math.floor(line.length / 700)));
    for (let i = 0; i < count; i++) {
      trains.push({
        line,
        dist: (i / count) * line.length,
        speed: line.tunnel ? 16 : 12,
      });
    }
  }
  return trains.slice(0, 12);
}

export function stepTrains(trains, dt) {
  for (const train of trains) {
    train.dist = (train.dist + train.speed * dt) % train.length;
  }
}

export function trainPoses(train) {
  const gap = 18;
  const poses = [];
  for (let i = 0; i < train.line.carriages; i++) {
    poses.push(samplePath(train.line.path, train.dist - (i + 0.5) * gap));
  }
  return poses;
}

// Pull the three named crossings out of OSM so the client can hang a truss
// or a cable fan on the real centreline. The carriageway itself stays a road.

function wayLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return len;
}

function projectWay(el, proj) {
  const points = [];
  for (const g of el.geometry || []) {
    if (g.lon == null || g.lat == null) continue;
    const [x, z] = proj.project(g.lon, g.lat);
    const prev = points[points.length - 1];
    if (prev && Math.hypot(x - prev[0], z - prev[1]) < 1) continue;
    points.push([x, z]);
  }
  return points;
}

function simplify(points, step) {
  if (points.length < 3) return points.map((p) => p.slice());
  const out = [points[0].slice()];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    acc += seg;
    if (acc >= step || i === points.length - 1) {
      out.push(points[i].slice());
      acc = 0;
    }
  }
  return out;
}

function withDeck(points, sampleHeight, lift) {
  return points.map(([x, z]) => [x, sampleHeight(x, z) + lift, z]);
}

export function collectBridges(elements, proj, sampleHeight) {
  const ways = [];
  for (const el of elements) {
    if (el.type !== 'way' || !el.tags?.highway || el.tags.bridge !== 'yes') continue;
    const points = projectWay(el, proj);
    if (points.length < 2) continue;
    ways.push({
      id: el.id,
      name: el.tags.name || '',
      points,
      len: wayLength(points),
      mid: points[points.length >> 1],
    });
  }
  const out = [];
  const waibaidu = ways.filter((w) => /外白渡桥/.test(w.name)).sort((a, b) => b.len - a.len)[0];
  if (waibaidu && waibaidu.len > 40 && waibaidu.len < 200) {
    out.push({
      id: 'waibaidu',
      name: '外白渡桥',
      kind: 'truss',
      points: withDeck(simplify(waibaidu.points, 12), sampleHeight, 5.6),
    });
  }
  const nanpu = ways.filter((w) => /南浦大桥/.test(w.name)).sort((a, b) => b.len - a.len)[0];
  if (nanpu && nanpu.len > 400) {
    out.push({
      id: 'nanpu',
      name: '南浦大桥',
      kind: 'cable',
      style: 'h',
      towerH: 150,
      mainSpan: 423,
      points: withDeck(simplify(nanpu.points, 24), sampleHeight, 34),
    });
  }
  // Yangpu carries the inner ring and is not named 杨浦大桥. The river span is
  // the ~770 m pair beside 杨浦大桥公园; longer inland legs and the viaduct
  // further east are the same road but not the cable-stayed crossing.
  const yangpu = ways
    .filter((w) => /内环高架路/.test(w.name)
      && w.len > 700 && w.len < 860
      && w.mid[0] > 3600 && w.mid[0] < 4500
      && w.mid[1] < -1900 && w.mid[1] > -2500)
    .sort((a, b) => b.len - a.len)[0];
  if (yangpu) {
    out.push({
      id: 'yangpu',
      name: '杨浦大桥',
      kind: 'cable',
      style: 'y',
      towerH: 208,
      mainSpan: 602,
      points: withDeck(simplify(yangpu.points, 28), sampleHeight, 36),
    });
  }
  return out;
}

// Named Lujiazui towers whose look is familiar from photographs and promo
// films. Generic towers draw a random facade; these get the glass tone they
// show by day and the lighting they show at night. Names are OSM names; a
// tower split into building:part outlines inherits the name in the pipeline.

export const NIGHT = {
  NONE: 0,
  // Full-facade LED screen: the riverfront video walls.
  MEDIA: 1,
  // LED lines up the corners and round the crown.
  WHITE: 2,
  BLUE: 3,
  // Warm floodlit crown.
  GOLD: 4,
};

export const NAMED_TOWERS = [
  // Citigroup Tower, on the river: dark grey-green glass, a giant screen at night.
  { test: /花旗集团大厦/, color: 0x5f7178, night: NIGHT.MEDIA },
  // Aurora Plaza: bronze-gold glass by day, the whole face a video wall at night.
  { test: /震旦国际大楼/, color: 0xb39a64, night: NIGHT.MEDIA },
  // Bank of China Tower: silver-blue curtain wall, white outline.
  { test: /中银大厦/, color: 0x93a9bb, night: NIGHT.WHITE },
  // Bocom Financial Towers: blue glass, cool outline.
  { test: /交银金融大厦/, color: 0x7c9cb6, night: NIGHT.BLUE },
  // Shanghai IFC: grey-silver glass, white crown.
  { test: /国金中心/, color: 0xa3b1bb, night: NIGHT.WHITE },
  // HSBC Building (former Senmao): pale silver.
  { test: /汇丰银行大楼/, color: 0xaab6bf, night: NIGHT.WHITE },
  // Mirae Asset Tower: blue glass with a curved crown.
  { test: /未来资产大厦/, color: 0x88a6c2, night: NIGHT.BLUE },
  // Pudong Shangri-La: stone and bronze, warm crown.
  { test: /香格里拉/, color: 0xb0a790, night: NIGHT.GOLD },
  { test: /招商局大厦/, color: 0x9aa9b3, night: NIGHT.WHITE },
  { test: /国寿中心|太平金融|工银大厦/, color: 0x8fa3b2, night: NIGHT.WHITE },
];

export function namedTower(name) {
  if (!name) return null;
  return NAMED_TOWERS.find((t) => t.test.test(name)) || null;
}

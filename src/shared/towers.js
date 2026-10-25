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
  // Second pass, from public photos of the Lujiazui, North Bund and Puxi
  // skylines. Colours are the average daytime glass tone; night styles follow
  // what the towers show on an ordinary evening, not festival programmes.
  // Bank of Shanghai HQ (Tange): blue-grey glass, lit ring crown.
  { test: /上海银行大厦/, color: 0x8ea3b5, night: NIGHT.WHITE },
  // China Merchants Bank Tower: blue glass, cool outline.
  { test: /招商银行上海大厦/, color: 0x7d98b0, night: NIGHT.BLUE },
  // Bank of China's neighbours on Yincheng Road: grey-silver curtain walls.
  { test: /农银大厦|建行大厦|中国民生银行大厦|华能联合大厦/, color: 0x98a6b0, night: NIGHT.WHITE },
  // Shanghai Information Tower: blue glass under the antenna crown.
  { test: /上海信息大楼/, color: 0x86a2bb, night: NIGHT.BLUE },
  // Bi Yu Lan Tian: blue-green glass with a spire.
  { test: /中融碧玉蓝天大厦/, color: 0x6f9aa8, night: NIGHT.BLUE },
  // Futures Tower and China Development Bank: deep blue glass.
  { test: /上海期货大厦|国家开发银行大厦/, color: 0x7e9bb4, night: NIGHT.BLUE },
  // 21st Century Tower: pale silver frame with sky gardens.
  { test: /21世纪大厦/, color: 0xb6bec4, night: NIGHT.WHITE },
  // Hang Seng: grey-green glass on the river front. Stone-clad towers (Ping An,
  // China Insurance, World Financial Tower, Mandarin Oriental) stay out: every
  // entry is drawn as a glass curtain wall, which turns stone into a lit slab.
  { test: /恒生银行大厦/, color: 0x6e8f88, night: NIGHT.WHITE },
  // Puxi: Bund Centre's lotus crown is floodlit gold.
  { test: /外滩中心/, color: 0x8c9aa3, night: NIGHT.GOLD },
  // Shimao International Plaza: dark glass, two lit spires.
  { test: /上海世茂广场/, color: 0x6f7f8c, night: NIGHT.WHITE },
  // Raffles City, Golden Bell Plaza, Haitong Securities: cool silver glass.
  { test: /来福士广场|金钟广场|海通证券大厦/, color: 0x93a4ae, night: NIGHT.WHITE },
  { test: /兰生大厦|香港新世界大厦/, color: 0x7f9ab0, night: NIGHT.BLUE },
  // North Bund: W Hotel's dark glass with white edge lines.
  { test: /外滩\s*W\s*酒店/, color: 0x5f6f7a, night: NIGHT.WHITE },
];

export function namedTower(name) {
  if (!name) return null;
  return NAMED_TOWERS.find((t) => t.test.test(name)) || null;
}

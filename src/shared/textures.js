// Photo textures: every one is CC0 1.0 (public domain) from Poly Haven or ambientCG.
// The layer order is the layer index the shaders read; append, never reorder.
// `npm run textures` downloads them and packs public/textures/*.ktx2.

export const SOURCES = {
  polyhaven: { name: 'Poly Haven', url: (id) => `https://polyhaven.com/a/${id}`, license: 'CC0 1.0' },
  ambientcg: { name: 'ambientCG', url: (id) => `https://ambientcg.com/view?id=${id}`, license: 'CC0 1.0' },
};
export const LICENSE_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';

// Wall and roof surfaces. They are detail textures: the shader divides each by its
// mean colour, so the building's own colour shows through the photo's pattern.
export const WALL_LAYERS = [
  { key: 'tile', source: 'polyhaven', id: 'long_white_tiles', use: '高层住宅白色瓷砖 · white tiled residential towers' },
  { key: 'mosaic', source: 'polyhaven', id: 'rounded_square_tiled_wall', use: '八九十年代住宅马赛克面砖 · 1980s–90s mosaic-tiled housing' },
  { key: 'brick', source: 'polyhaven', id: 'red_brick_03', use: '红砖里弄 · red-brick lane houses' },
  { key: 'brick_mixed', source: 'polyhaven', id: 'mixed_brick_wall', use: '石库门青红砖 · shikumen grey and red brick' },
  { key: 'concrete', source: 'polyhaven', id: 'concrete_panels', use: '办公楼石材/混凝土板 · office stone and concrete panels' },
  { key: 'cladding', source: 'polyhaven', id: 'exterior_wall_cladding', use: '商业楼外墙挂板 · commercial cladding' },
  { key: 'stone', source: 'polyhaven', id: 'sandstone_blocks_08', use: '外滩历史建筑花岗岩/砂岩块石 · Bund ashlar stonework' },
  { key: 'plaster', source: 'polyhaven', id: 'grey_plaster', use: '抹灰墙 · rendered walls' },
  { key: 'metal', source: 'polyhaven', id: 'box_profile_metal_sheet', use: '厂房压型钢板 · industrial metal sheet' },
  { key: 'roof', source: 'polyhaven', id: 'concrete_floor_worn_001', use: '平屋顶 · flat concrete roofs' },
];

export const GROUND_LAYERS = [
  { key: 'asphalt', source: 'polyhaven', id: 'asphalt_02', use: '沥青路面 · asphalt' },
  { key: 'pavers', source: 'polyhaven', id: 'concrete_pavers', use: '人行道砖 · sidewalk pavers' },
  { key: 'grass', source: 'polyhaven', id: 'leafy_grass', use: '草地 · grass' },
  { key: 'pavement', source: 'polyhaven', id: 'concrete_pavement', use: '广场/空地 · plazas and open ground' },
];

// Whole-facade photos with a glass mask (ambientCG's metalness map). Measured in the
// 1024 px image: `grid` is window bays x floors per tile, `offset` shifts the tile so
// that cell (0,0) of the shader's window grid lands on one photo window, `win` is the
// window opening inside a cell (x0, x1, y0, y1, upward), `floor` the storey height in
// metres. The bay width follows from the cell aspect.
export const FACADE_LAYERS = [
  { key: 'glass_panels', source: 'ambientcg', id: 'Facade001', grid: [16, 10], offset: [0, 0], win: [0, 1, 0, 1], floor: 3.9, aspect: 64 / 102.4, use: '玻璃幕墙（整块） · flush glass curtain wall' },
  { key: 'glass_bands', source: 'ambientcg', id: 'Facade006', grid: [14, 8], offset: [0, -15 / 128], win: [0, 1, 0.235, 1], floor: 3.9, aspect: (1024 / 14) / 128, use: '带窗间墙玻璃幕墙 · banded curtain wall' },
  { key: 'brick_windows', source: 'ambientcg', id: 'Facade018A', grid: [6, 6], offset: [0.5, -0.5], win: [0.135, 0.86, 0.14, 0.86], floor: 3.3, aspect: 1, use: '砖墙方窗 · brick wall, punched windows' },
  { key: 'concrete_windows', source: 'ambientcg', id: 'Facade019A', grid: [6, 6], offset: [0.5, -0.5], win: [0.135, 0.86, 0.14, 0.86], floor: 3.6, aspect: 1, use: '混凝土方窗 · concrete frame, punched windows' },
];

export const TEXTURE_SIZE = { albedo: 1024, normal: 512, facade: 1024 };

export const textureFiles = {
  manifest: 'manifest.json',
  wallAlbedo: 'wall_albedo.ktx2',
  wallNormal: 'wall_normal.ktx2',
  groundAlbedo: 'ground_albedo.ktx2',
  groundNormal: 'ground_normal.ktx2',
  facade: 'facade.ktx2',
};

export const layerIndex = (layers, key) => layers.findIndex((l) => l.key === key);

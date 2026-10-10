// Numeric ids stored in tiles. The facade and road shaders branch on these values.

export const KIND = {
  OTHER: 0,
  RESIDENTIAL: 1,
  OFFICE: 2,
  COMMERCIAL: 3,
  INDUSTRIAL: 4,
  LANDMARK: 5,
  HISTORIC: 6,
};

export const LAND = {
  PARK: 0,
  WOOD: 1,
  WATER: 2,
  PLAZA: 3,
  PITCH: 4,
  PIER: 5,
};

export const PROP = {
  TREE: 0,
  LAMP: 1,
  AC: 2,
  TANK: 3,
  PENTHOUSE: 4,
  SIGN: 5,
  PIER: 6,
};

export const ROAD = {
  MOTORWAY: 0,
  PRIMARY: 1,
  SECONDARY: 2,
  TERTIARY: 3,
  RESIDENTIAL: 4,
  SERVICE: 5,
  LINK: 6,
  CROSSWALK: 7,
  SIDEWALK: 8,
  RAIL: 9,
};

export const BFLAG = {
  FLOATING: 1,
  GLASS: 2,
};

export const ROOF = {
  FLAT: 0,
  DOME: 1,
  PYRAMID: 2,
  ONION: 3,
};

export const KIND_NAME = {
  [KIND.OTHER]: '建筑',
  [KIND.RESIDENTIAL]: '住宅',
  [KIND.OFFICE]: '办公',
  [KIND.COMMERCIAL]: '商业',
  [KIND.INDUSTRIAL]: '厂房',
  [KIND.LANDMARK]: '地标',
  [KIND.HISTORIC]: '历史建筑',
};

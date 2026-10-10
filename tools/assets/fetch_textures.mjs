// Downloads the CC0 photo textures listed in src/shared/textures.js and packs them into
// GPU-compressed KTX2 texture arrays (Basis UASTC + Zstandard, full mip chains) under
// public/textures/. Raw downloads are cached in data/textures/. Nothing here is committed.
// Usage: node tools/assets/fetch_textures.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import jpeg from 'jpeg-js';
import { unzipSync } from 'fflate';
import {
  FACADE_LAYERS, GROUND_LAYERS, LICENSE_URL, SOURCES, TEXTURE_SIZE, WALL_LAYERS, textureFiles,
} from '../../src/shared/textures.js';
import { srgbToLinear, resizeWrap, linearMean, packFacade } from './image.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CACHE = path.join(ROOT, 'data/textures');
const OUT = path.join(ROOT, 'public/textures');
const force = process.argv.includes('--force');
const USER_AGENT = 'shanghai-3d-city/0.3 (texture fetch)';

async function download(url, file) {
  if (!force && fs.existsSync(file)) return fs.readFileSync(file);
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      console.log(`  ${path.relative(ROOT, file)}  ${(buf.length / 1024).toFixed(0)} KB`);
      return buf;
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

const json = async (url, file) => JSON.parse((await download(url, file)).toString('utf8'));
const decode = (buf) => jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });

async function polyHaven(id) {
  const dir = path.join(CACHE, 'polyhaven', id);
  const info = await json(`https://api.polyhaven.com/info/${id}`, path.join(dir, 'info.json'));
  const files = await json(`https://api.polyhaven.com/files/${id}`, path.join(dir, 'files.json'));
  const diff = files.Diffuse?.['1k']?.jpg?.url;
  const nor = files.nor_gl?.['1k']?.jpg?.url;
  if (!diff || !nor) throw new Error(`${id}: Poly Haven has no 1k diffuse/normal`);
  const [w, h] = info.dimensions || [2000, 2000];
  return {
    albedo: decode(await download(diff, path.join(dir, 'diff_1k.jpg'))),
    normal: decode(await download(nor, path.join(dir, 'nor_gl_1k.jpg'))),
    metres: [w / 1000, h / 1000],
    authors: Object.keys(info.authors || {}),
    name: info.name || id,
  };
}

async function ambientCg(id) {
  const dir = path.join(CACHE, 'ambientcg', id);
  const zip = await download(`https://ambientcg.com/get?file=${id}_1K-JPG.zip`, path.join(dir, `${id}_1K-JPG.zip`));
  const files = unzipSync(new Uint8Array(zip), { filter: (f) => /_(Color|Metalness)\.jpg$/.test(f.name) });
  const pick = (suffix) => {
    const name = Object.keys(files).find((n) => n.endsWith(`_${suffix}.jpg`));
    if (!name) throw new Error(`${id}: no ${suffix} map in the zip`);
    return decode(files[name]);
  };
  return { color: pick('Color'), mask: pick('Metalness'), authors: ['ambientCG (Lennart Demes)'], name: id };
}

let basisModule = null;
async function basis() {
  if (!basisModule) {
    const file = path.join(ROOT, 'node_modules/ktx2-encoder/dist/basis/basis_encoder.js');
    const BASIS = (await import(pathToFileURL(file).href)).default;
    basisModule = await BASIS();
    basisModule.initializeBasis();
  }
  return basisModule;
}

// One KTX2 2D array, UASTC LDR 4x4 with RDO and Zstandard, mips wrap like the tiling.
async function encodeArray(images, { srgb, normal }) {
  const B = await basis();
  const enc = new B.BasisEncoder();
  try {
    enc.setDebug(false);
    enc.setStatusOutput(false);
    enc.setCreateKTX2File(true);
    enc.setTexType(1);
    enc.setUASTC(true);
    enc.setPackUASTCFlags(2);
    enc.setRDOUASTC(true);
    enc.setRDOUASTCQualityScalar(normal ? 0.5 : 1.0);
    enc.setKTX2UASTCSupercompression(true);
    enc.setMipGen(true);
    enc.setMipWrapping(true);
    enc.setMipSRGB(srgb);
    enc.setPerceptual(srgb);
    enc.setKTX2AndBasisSRGBTransferFunc(srgb);
    if (normal) { enc.setNormalMapPreset(); enc.setMipRenormalize(true); }
    images.forEach((img, i) => enc.setSliceSourceImage(i, img.data, img.width, img.height, 0));
    const texels = images.reduce((n, img) => n + img.width * img.height, 0);
    const out = new Uint8Array(texels * 6 + 65536);
    const bytes = enc.encode(out);
    if (!bytes) throw new Error('basis encode failed');
    return out.slice(0, bytes);
  } finally {
    enc.delete();
  }
}

async function write(name, images, opts) {
  const t = performance.now();
  const data = await encodeArray(images, opts);
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`${name}: ${images.length} layers ${images[0].width}px  ${(data.length / 1048576).toFixed(2)} MB  ${((performance.now() - t) / 1000).toFixed(1)} s`);
}

async function detailSet(layers) {
  const albedo = [];
  const normal = [];
  const info = [];
  for (const layer of layers) {
    console.log(`${layer.key}: ${layer.source} ${layer.id}`);
    const tex = await polyHaven(layer.id);
    const a = resizeWrap(tex.albedo, TEXTURE_SIZE.albedo);
    albedo.push(a);
    normal.push(resizeWrap(tex.normal, TEXTURE_SIZE.normal, { normal: true }));
    info.push({ ...layer, name: tex.name, authors: tex.authors, metres: tex.metres, mean: linearMean(a) });
  }
  return { albedo, normal, info };
}

fs.mkdirSync(OUT, { recursive: true });
const wall = await detailSet(WALL_LAYERS);
const ground = await detailSet(GROUND_LAYERS);
const facade = [];
const facadeInfo = [];
for (const layer of FACADE_LAYERS) {
  console.log(`${layer.key}: ${layer.source} ${layer.id}`);
  const tex = await ambientCg(layer.id);
  const img = packFacade(resizeWrap(tex.color, TEXTURE_SIZE.facade), resizeWrap(tex.mask, TEXTURE_SIZE.facade));
  facade.push(img);
  facadeInfo.push({ ...layer, name: tex.name, authors: tex.authors, mean: linearMean(img) });
}

await write(textureFiles.wallAlbedo, wall.albedo, { srgb: true });
await write(textureFiles.wallNormal, wall.normal, { srgb: false, normal: true });
await write(textureFiles.groundAlbedo, ground.albedo, { srgb: true });
await write(textureFiles.groundNormal, ground.normal, { srgb: false, normal: true });
await write(textureFiles.facade, facade, { srgb: true });

const strip = ({ key, source, id, name, authors, metres, mean, use }) => ({
  key, source, id, name, authors, use, metres, mean: mean.map((v) => +v.toFixed(5)),
  url: SOURCES[source].url(id), license: SOURCES[source].license,
});
fs.writeFileSync(path.join(OUT, textureFiles.manifest), JSON.stringify({
  version: 1, license: 'CC0 1.0', licenseUrl: LICENSE_URL,
  wall: wall.info.map(strip), ground: ground.info.map(strip), facade: facadeInfo.map(strip),
}, null, 1));

const credit = (l) => `- \`${l.key}\`: [${l.name}](${SOURCES[l.source].url(l.id)}) by ${l.authors.join(', ') || SOURCES[l.source].name}, ${SOURCES[l.source].name}, [CC0 1.0](${LICENSE_URL})`;
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), `# Textures\n\nGenerated by tools/assets/fetch_textures.mjs. All sources are CC0 1.0 (public domain).\n\n${[...wall.info, ...ground.info, ...facadeInfo].map(credit).join('\n')}\n`);

// three.js' Basis transcoder (MIT/Apache-2.0), served next to the textures
const basisDir = path.join(OUT, 'basis');
fs.mkdirSync(basisDir, { recursive: true });
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
  fs.copyFileSync(path.join(ROOT, 'node_modules/three/examples/jsm/libs/basis', f), path.join(basisDir, f));
}
console.log(`done: ${path.relative(ROOT, OUT)}`);

import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sunVector, duskHaze } from './shared/sun.js';
import { syncLandmarkNight, syncPearlShow } from './world/landmarks.js';
import { boatPose, createBoats, stepBoats } from './sim/crowd.js';
import { CAR_STRIDE, PERSON_STRIDE } from './sim/poses.js';
import { createTrains, prepareLines, stepTrains, trainPoses } from './sim/trains.js';
import { yawFromHeading } from './sim/path.js';
import { cityUniforms, createSkyMaterial, makeSignAtlas } from './world/materials.js';
import { Environment, installSkyLight } from './world/environment.js';
import { createPost } from './world/post.js';
import { LampLight } from './world/lamplight.js';
import { DETAIL_LAYER, WaterMirror, WATER_LAYER } from './world/mirror.js';
import { createStreamer, loadCity } from './world/streamer.js';
import { syncBridgeNight } from './world/bridges.js';
import { syncEmbankmentNight } from './world/embankment.js';
import { loadPhotoTextures } from './world/textures.js';
import { signMaterial } from './world/props.js';
import {
  WAKE_LAYER, carPaint, createBoatFleet, createCarFleet, createPersonFleet, createTrainMesh, pantsPaint, setVehicleMatrix, shirtPaint,
} from './world/vehicles.js';

const base = import.meta.env.BASE_URL;
const params = new URLSearchParams(location.search);
const stage = document.querySelector('#stage');
const clockEl = document.querySelector('#clock');
const timeInput = document.querySelector('#time');
const statsEl = document.querySelector('#stats');
const subtitle = document.querySelector('#subtitle');
const credit = document.querySelector('#credit');
const gate = document.querySelector('#gate');
const inspect = document.querySelector('#inspect');
const trafficBox = document.querySelector('#traffic');
const trainsBox = document.querySelector('#trains');

installSkyLight();
const renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' });
const idleDpr = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(idleDpr);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.type = THREE.PCFShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 1.5, 22000);
camera.layers.enable(WATER_LAYER);
camera.layers.enable(DETAIL_LAYER);
camera.layers.enable(WAKE_LAYER);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
// up=1 lets a skyline camera look up at the towers. The default stays just above the horizon.
controls.maxPolarAngle = params.get('up') === '1' ? Math.PI * 0.62 : Math.PI * 0.49;
controls.minDistance = 25;
controls.maxDistance = 4500;
controls.screenSpacePanning = false;
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };

if (params.get('photo') !== '0') {
  loadPhotoTextures(renderer, base).then((ok) => {
    if (!ok) console.info('No photo textures: run npm run textures. Using procedural surfaces.');
  }).catch((error) => console.warn('Photo textures failed, using procedural surfaces:', error));
}

const env = new Environment(scene, renderer);
const post = createPost(renderer, scene, camera, { ao: params.get('ao') !== '0' });
const lampLight = new LampLight(renderer);
const mirror = new WaterMirror(renderer);
mirror.enabled = params.get('mirror') !== '0';
let motionHold = 0;
let motionOn = false;
let shadowTiles = -1;
let tilesDirty = false;
let shadowPending = false;
let shadowWait = 0;
let statsTimer = 0;
let frame = 0;
controls.addEventListener('start', () => { motionHold = 0.45; });
function applyResolution() {
  renderer.setPixelRatio(motionOn ? 1 : idleDpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
  post.setInteractive(motionOn);
  mirror.scale = motionOn ? 0.5 : 1;
}
if (params.has('clouds')) cityUniforms.uCloudCover.value = Number(params.get('clouds')) || 0;

const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), createSkyMaterial());
sky.frustumCulled = false;
sky.renderOrder = -1;
scene.add(sky);
// Beyond the area: plain ground in the grey of unbuilt land, out to the horizon haze.
const beyond = new THREE.Mesh(
  new THREE.CircleGeometry(30000, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.95 }),
);
beyond.receiveShadow = true;
scene.add(beyond);
let waterLevel = 0;
const skyPreset = params.get('sky') || '';
const pearlPin = params.get('pearl') || '';
const hazeFog = new THREE.Color(0.86, 0.78, 0.74);

const keys = new Set();
const signAtlas = makeSignAtlas();
const signsMat = signMaterial(signAtlas);
let hour = Number(params.get('time') ?? 10.5);
if (params.get('night') === '1' && !params.has('time')) hour = 21;
let dayOfYear = 172;
let trafficOn = params.get('traffic') !== '0';
let trainsOn = params.get('trains') !== '0';
trafficBox.checked = trafficOn;
trainsBox.checked = trainsOn;
timeInput.value = String(hour);

const streamer = createStreamer({
  scene,
  getView: () => ({ target: controls.target, camera }),
});

let cars = null;
let streetWorker = null;
let streetBusy = false;
let streetFresh = false;
let streetCount = 0;
let streetPoses = { cars: new Float32Array(0), people: new Float32Array(0) };
let streetSpare = { cars: null, people: null };
let people = null;
let boats = null;
let boatMesh = null;
let trains = null;
let trainMesh = null;
let trainList = [];
let running = false;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let press = null;

function formatHour(value) {
  const h = Math.floor(value) % 24;
  const m = Math.floor((value % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function shanghaiNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h + m / 60;
}

function applySun() {
  const sunPos = sunVector(hour, dayOfYear, 31.23);
  env.setSun(new THREE.Vector3(sunPos.x, sunPos.y, sunPos.z));
  const haze = duskHaze(env.elevation, skyPreset);
  cityUniforms.uHaze.value = haze;
  if (haze > 0) env.fogColor.lerp(hazeFog, haze * 0.6);
  syncPearlShow(hour, pearlPin);
  const shadowMoved = env.follow(controls.target, camera);
  cityUniforms.uSkyGain.value = 1 / env.exposure;
  post.apply(env, controls.target.y);
  const night = env.night;
  if (streamer.headMat) streamer.headMat.emissiveIntensity = night * 4;
  syncLandmarkNight(night);
  syncBridgeNight(night);
  syncEmbankmentNight(night);
  signsMat.emissiveIntensity = 0.15 + night * 0.9;
  if (cars) cars.lampMat.emissiveIntensity = 0.05 + night * 5;
  if (boatMesh) boatMesh.lampMat.emissiveIntensity = 0.2 + night * 2.4;
  if (trainMesh) trainMesh.windows.material.emissiveIntensity = night * 1.2;
  clockEl.textContent = formatHour(hour);
  return shadowMoved;
}

const _lastCam = new THREE.Vector3();
const _lastTarget = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _obstacles = [];
let _haveView = false;

function blockCamera() {
  _obstacles.length = 0;
  const picks = streamer.pickables;
  for (let i = 0; i < picks.length; i++) _obstacles.push(picks[i]);
  if (streamer.landmarks) _obstacles.push(streamer.landmarks);
  if (!_haveView || !_obstacles.length) {
    _haveView = true;
    _lastCam.copy(camera.position);
    _lastTarget.copy(controls.target);
    return;
  }
  _moveDir.subVectors(camera.position, _lastCam);
  const dist = _moveDir.length();
  if (dist < 0.05) {
    _lastCam.copy(camera.position);
    _lastTarget.copy(controls.target);
    return;
  }
  _moveDir.multiplyScalar(1 / dist);
  raycaster.set(_lastCam, _moveDir);
  raycaster.near = 0;
  raycaster.far = dist;
  const hit = raycaster.intersectObjects(_obstacles, true).find((item) => item.object.visible && item.distance < dist);
  raycaster.far = Infinity;
  if (hit) {
    const keep = Math.max(0, (hit.distance - 2.8) / dist);
    camera.position.lerpVectors(_lastCam, camera.position, keep);
    if (controls.target.distanceTo(_lastTarget) > 0.02) {
      controls.target.lerpVectors(_lastTarget, controls.target, keep);
    }
  }
  _lastCam.copy(camera.position);
  _lastTarget.copy(controls.target);
}

function moveTarget(dt) {
  if (!keys.size) return;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const speed = (keys.has('shift') ? 280 : 90) * dt;
  const delta = new THREE.Vector3();
  if (keys.has('w')) delta.add(forward);
  if (keys.has('s')) delta.sub(forward);
  if (keys.has('d')) delta.add(right);
  if (keys.has('a')) delta.sub(right);
  if (delta.lengthSq() === 0) return;
  delta.normalize().multiplyScalar(speed);
  controls.target.add(delta);
  camera.position.add(delta);
}

function showBuilding(hit) {
  const list = hit.object.userData.buildings;
  const id = hit.object.geometry.getAttribute('aId')?.getX(hit.face.a);
  const info = list?.[id | 0];
  if (!info) { inspect.hidden = true; return; }
  inspect.hidden = false;
  inspect.innerHTML = `<h2>${info.name || '未命名建筑'}</h2><p>${info.kind} · ${info.storeys} 层 · 约 ${Math.round(info.height)} 米</p>`;
}

// Cars and people a few pixels long are not drawn: the ones near the camera
// are packed into the first instance slots and the meshes draw only those.
// A slot is repainted only when a different agent lands in it.
const CAR_RANGE = 1600;
const PERSON_RANGE = 650;
const _paint = new THREE.Color();
let carSlots = null;
let personSlots = null;

function nearEye(x, y, z, range) {
  const p = camera.position;
  const dx = x - p.x;
  const dy = y - p.y;
  const dz = z - p.z;
  return dx * dx + dy * dy + dz * dz < range * range;
}

// Car and person poses arrive from the traffic worker as flat buffers; only
// the copies near the camera become instances. Colour follows the car index,
// not the instance slot, so a car keeps its paint as others come and go.
function packCars() {
  const poses = streetPoses.cars;
  const total = poses.length / CAR_STRIDE;
  if (!carSlots) carSlots = new Int32Array(total).fill(-1);
  let n = 0;
  let repaint = false;
  for (let i = 0; i < total; i++) {
    const o = i * CAR_STRIDE;
    const x = poses[o];
    if (Number.isNaN(x) || !nearEye(x, poses[o + 1], poses[o + 2], CAR_RANGE)) continue;
    const y = poses[o + 1];
    const z = poses[o + 2];
    setVehicleMatrix(cars.body, n, cars.dummy, x, y, z, poses[o + 3], poses[o + 4]);
    setVehicleMatrix(cars.glass, n, cars.dummy, x, y, z, poses[o + 3], poses[o + 4]);
    setVehicleMatrix(cars.lamps, n, cars.dummy, x, y, z, poses[o + 3], poses[o + 4]);
    if (carSlots[n] !== i) {
      carSlots[n] = i;
      cars.body.setColorAt(n, carPaint(i, _paint));
      repaint = true;
    }
    n += 1;
  }
  cars.body.count = cars.glass.count = cars.lamps.count = cars.beams.count = n;
  cars.body.instanceMatrix.needsUpdate = true;
  cars.glass.instanceMatrix.needsUpdate = true;
  cars.lamps.instanceMatrix.needsUpdate = true;
  if (repaint) cars.body.instanceColor.needsUpdate = true;
}

function packPeople() {
  const poses = streetPoses.people;
  const total = poses.length / PERSON_STRIDE;
  if (!personSlots) personSlots = new Int32Array(total).fill(-1);
  let n = 0;
  let repaint = false;
  for (let i = 0; i < total; i++) {
    const o = i * PERSON_STRIDE;
    if (!nearEye(poses[o], poses[o + 1], poses[o + 2], PERSON_RANGE)) continue;
    const x = poses[o];
    const y = poses[o + 1] + poses[o + 5];
    const z = poses[o + 2];
    setVehicleMatrix(people.mesh, n, people.dummy, x, y, z, poses[o + 3], poses[o + 4]);
    setVehicleMatrix(people.legs, n, people.dummy, x, y, z, poses[o + 3], poses[o + 4]);
    setVehicleMatrix(people.heads, n, people.dummy, x, y, z, poses[o + 3], poses[o + 4]);
    if (personSlots[n] !== i) {
      personSlots[n] = i;
      people.mesh.setColorAt(n, shirtPaint(i, _paint));
      people.legs.setColorAt(n, pantsPaint(i, _paint));
      repaint = true;
    }
    n += 1;
  }
  people.mesh.count = people.legs.count = people.heads.count = n;
  people.mesh.instanceMatrix.needsUpdate = true;
  people.legs.instanceMatrix.needsUpdate = true;
  people.heads.instanceMatrix.needsUpdate = true;
  if (repaint) {
    people.mesh.instanceColor.needsUpdate = true;
    people.legs.instanceColor.needsUpdate = true;
  }
}

// Ask the worker for the next step unless one is still in flight.
function requestStreets(dt) {
  if (!streetWorker || streetBusy) return;
  streetBusy = true;
  const { cars: c, people: p } = streetSpare;
  streetSpare = { cars: null, people: null };
  const transfer = [c, p].filter(Boolean).map((b) => b.buffer);
  streetWorker.postMessage({ type: 'step', dt, cars: c, people: p }, transfer);
}

function presetsFor(bounds) {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  return [
    ['overview', '俯瞰', [cx, Math.max(700, (bounds.maxX - bounds.minX) * 0.55), cz + 420], [cx, 12, cz]],
    ['bund', '外滩', [-180, 150, 220], [80, 30, -40]],
    ['lujiazui', '陆家嘴', [420, 220, 280], [180, 80, -30]],
  ];
}

function flyTo(position, target) {
  camera.position.set(position[0], position[1], position[2]);
  controls.target.set(target[0], target[1], target[2]);
  controls.update();
  // A jump is not a walk: the collision check starts again from here.
  _haveView = false;
}

async function boot() {
  let index;
  try {
    const res = await fetch(`${base}tiles/index.json`);
    if (!res.ok) throw new Error('missing index');
    index = await res.json();
    if (!index.areas?.length) throw new Error('empty index');
  } catch {
    gate.hidden = false;
    statsEl.textContent = '尚未编译城市数据';
    applySun();
    renderer.setAnimationLoop(() => post.render());
    return;
  }
  const areaId = params.get('area') || index.areas[0].id;
  const city = await loadCity(areaId, base);
  subtitle.textContent = city.manifest.name;
  document.title = `${city.manifest.name} · 上海三维`;
  credit.innerHTML = `${city.manifest.attribution.osm}<br>${city.manifest.attribution.dem}<br>照片纹理 Poly Haven · ambientCG (CC0)<br>做法来自 <a href="https://github.com/jeantimex/tokyo">jeantimex/tokyo</a>`;

  // Place the camera first, so the first tiles requested are the ones in view.
  const presetHost = document.querySelector('#presets');
  const presets = (city.manifest.presets?.length ? city.manifest.presets : presetsFor(city.manifest.bounds).map(([id, name, position, target]) => ({
    id, name, position, target,
  })));
  const wanted = params.get('view');
  const initial = presets.find((item) => item.id === wanted) || presets[0] || city.manifest.view;
  const triple = (key) => {
    const v = (params.get(key) || '').split(',').map(Number);
    return v.length === 3 && v.every(Number.isFinite) ? v : null;
  };
  const cam = triple('cam');
  if (cam) flyTo(cam, triple('look') || initial.target);
  else if (initial?.position) flyTo(initial.position, initial.target);
  for (const preset of presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = preset.name;
    button.addEventListener('click', () => flyTo(preset.position, preset.target));
    presetHost.appendChild(button);
  }

  await streamer.start(city, signAtlas);
  waterLevel = city.manifest.waterLevel ?? streamer.heightAt(0, 0);
  let lowest = Infinity;
  for (const h of city.terrain.heights) if (h < lowest) lowest = h;
  beyond.position.y = Math.min(waterLevel, lowest) - 1.5;

  boats = createBoats(waterLevel, city.manifest.riverCenter);
  boatMesh = createBoatFleet(boats.length);
  scene.add(boatMesh.body, boatMesh.glass, boatMesh.lamps, boatMesh.wake);
  const lines = prepareLines(city.rails);
  trainList = createTrains(lines);
  if (trainList.length) {
    const carriageCount = trainList.reduce((s, t) => s + t.line.carriages, 0);
    trainMesh = createTrainMesh(carriageCount);
    const color = new THREE.Color();
    let cursor = 0;
    for (const train of trainList) {
      for (let i = 0; i < train.line.carriages; i++) {
        color.setHex(train.line.color);
        trainMesh.mesh.setColorAt(cursor, color);
        cursor += 1;
      }
    }
    trainMesh.mesh.instanceColor.needsUpdate = true;
    scene.add(trainMesh.mesh, trainMesh.windows);
  }
  running = true;
  applySun();

  // Street traffic waits for the road graph, which the worker fetches and
  // parses itself behind the first frames.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  streetWorker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
  streetWorker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'error') {
      console.warn('No road graph, the city runs without street traffic:', msg.message);
      streetWorker.terminate();
      streetWorker = null;
    } else if (msg.type === 'ready') {
      streamer.paintRoads({ segments: msg.segments });
      streetCount = msg.cars;
      if (msg.cars) {
        cars = createCarFleet(msg.cars);
        scene.add(cars.body, cars.glass, cars.lamps);
      }
      if (msg.people) {
        people = createPersonFleet(msg.people);
        scene.add(people.mesh, people.legs, people.heads);
      }
      applySun();
      // One zero-length step so parked traffic shows even with ?traffic=0.
      requestStreets(0);
    } else if (msg.type === 'poses') {
      // The previous buffers go back to the worker on the next request.
      streetSpare = { cars: streetPoses.cars.length ? streetPoses.cars : null, people: streetPoses.people.length ? streetPoses.people : null };
      streetPoses = { cars: msg.cars, people: msg.people };
      streetBusy = false;
      streetFresh = true;
    }
  };
  streetWorker.postMessage({ type: 'init', url: new URL(`${city.root}roads.json`, location.href).href });
  applySun();
}

timeInput.addEventListener('input', () => { hour = Number(timeInput.value); applySun(); });
document.querySelector('#now').addEventListener('click', () => {
  hour = shanghaiNow();
  timeInput.value = String(hour);
  applySun();
});
document.querySelector('#night').addEventListener('click', () => {
  hour = hour > 16 || hour < 6 ? 10.5 : 21;
  timeInput.value = String(hour);
  applySun();
});
trafficBox.addEventListener('change', () => { trafficOn = trafficBox.checked; });
trainsBox.addEventListener('change', () => { trainsOn = trainsBox.checked; });

window.addEventListener('keydown', (event) => {
  keys.add(event.key.toLowerCase());
  if (event.key.toLowerCase() === 'n') document.querySelector('#night').click();
  if ([' ', 'arrowup', 'arrowdown'].includes(event.key.toLowerCase())) event.preventDefault();
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyResolution();
});
renderer.domElement.addEventListener('pointerdown', (event) => { press = [event.clientX, event.clientY]; });
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!press) return;
  const dx = event.clientX - press[0];
  const dy = event.clientY - press[1];
  press = null;
  if (dx * dx + dy * dy > 16) return;
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(streamer.pickables, false)[0];
  if (hit) showBuilding(hit);
  else inspect.hidden = true;
});

const clock = new THREE.Timer();
let streamTimer = 0;
applySun();
boot().catch((error) => {
  console.error(error);
  gate.hidden = false;
  statsEl.textContent = error.message;
});

renderer.setAnimationLoop(() => {
  clock.update();
  const dt = Math.min(0.05, clock.getDelta());
  cityUniforms.uTime.value += dt;
  const moved = controls.update();
  moveTarget(dt);
  blockCamera();
  if (keys.size || moved) motionHold = 0.35;
  else motionHold = Math.max(0, motionHold - dt);
  const interactive = motionHold > 0;
  const wasMotion = motionOn;
  if (interactive !== motionOn) {
    motionOn = interactive;
    applyResolution();
  }
  if (running) {
    streamTimer += dt;
    if (streamTimer > 0.25) {
      streamer.update();
      streamTimer = 0;
    }
    const simDt = motionOn ? dt * 2 : dt;
    const simStep = !motionOn || (frame & 1) === 0;
    if (trafficOn && simStep) requestStreets(simDt);
    if (boats && trafficOn) stepBoats(boats, dt);
    if (trainsOn) stepTrains(trainList, dt);
    // Repack only when the worker has delivered new poses.
    if (streetFresh) {
      if (cars) packCars();
      if (people) packPeople();
      streetFresh = false;
    }
    if (boatMesh && boats) {
      boats.forEach((boat, i) => {
        const pose = boatPose(boat);
        const boatScale = 0.78 + (i % 5) * 0.11;
        setVehicleMatrix(boatMesh.body, i, boatMesh.dummy, pose.x, pose.y, pose.z, pose.dx, pose.dz, boatScale);
        setVehicleMatrix(boatMesh.glass, i, boatMesh.dummy, pose.x, pose.y, pose.z, pose.dx, pose.dz, boatScale);
        setVehicleMatrix(boatMesh.lamps, i, boatMesh.dummy, pose.x, pose.y, pose.z, pose.dx, pose.dz, boatScale);
        setVehicleMatrix(boatMesh.wake, i, boatMesh.dummy, pose.x, pose.y, pose.z, pose.dx, pose.dz, boatScale);
      });
      boatMesh.body.instanceMatrix.needsUpdate = true;
      boatMesh.glass.instanceMatrix.needsUpdate = true;
      boatMesh.lamps.instanceMatrix.needsUpdate = true;
      boatMesh.wake.instanceMatrix.needsUpdate = true;
    }
    if (trainMesh) {
      let cursor = 0;
      for (const train of trainList) {
        for (const pose of trainPoses(train)) {
          const yaw = yawFromHeading(pose.dx, pose.dz);
          trainMesh.mesh.dummy = trainMesh.mesh.dummy || new THREE.Object3D();
          const dummy = cars?.dummy || trainMesh.mesh.dummy;
          dummy.position.set(pose.x, pose.y, pose.z);
          dummy.rotation.set(0, yaw, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          trainMesh.mesh.setMatrixAt(cursor, dummy.matrix);
          trainMesh.windows.setMatrixAt(cursor, dummy.matrix);
          cursor += 1;
        }
      }
      trainMesh.mesh.instanceMatrix.needsUpdate = true;
      trainMesh.windows.instanceMatrix.needsUpdate = true;
    }
    statsTimer += dt;
    if (statsTimer > 0.5) {
      statsTimer = 0;
      const phase = env.night < 0.35 ? '白天' : env.dark < 0.75 ? '黄昏' : '夜晚';
      statsEl.textContent = `${phase} · 街区 ${streamer.loadedCount} / ${streamer.total} · 车辆 ${streetCount} · 列车 ${trainList.length}`;
    }
    if (streamer.loadedCount !== shadowTiles) {
      shadowTiles = streamer.loadedCount;
      tilesDirty = true;
    }
  }
  if (applySun() || tilesDirty) shadowPending = true;
  shadowWait = Math.max(0, shadowWait - dt);
  if (!interactive && (wasMotion || (shadowWait <= 0 && shadowPending))) {
    renderer.shadowMap.needsUpdate = true;
    tilesDirty = false;
    shadowPending = false;
    shadowWait = 0.35;
  }
  if (!motionOn || (frame & 1) === 0) lampLight.update(controls.target, camera.position, env.night);
  mirror.update(scene, camera, running && streamer.hasWater ? waterLevel : null);
  post.render(dt);
  frame += 1;
});

window.__app = { scene, camera, controls, renderer, env, post, streamer, lampLight, mirror, cityUniforms, flyTo };

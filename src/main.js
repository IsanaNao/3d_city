import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { skyColors, sunVector } from './shared/sun.js';
import { createSim, prepareGraph, stepSim, carPose } from './sim/traffic.js';
import { createTrains, prepareLines, stepTrains, trainPoses } from './sim/trains.js';
import { yawFromHeading } from './sim/path.js';
import { cityUniforms, createSkyMaterial, makeCircleTexture, makeSignAtlas } from './world/materials.js';
import { createStreamer, loadCity } from './world/streamer.js';
import { signMaterial } from './world/props.js';
import { createCarFleet, createTrainMesh, setVehicleMatrix } from './world/vehicles.js';

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

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd7e8f4, 500, 4200);
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 1.5, 14000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 25;
controls.maxDistance = 4500;
controls.screenSpacePanning = false;
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };

const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 2600;
sun.shadow.bias = -0.00018;
sun.shadow.normalBias = 0.04;
scene.add(sun);
scene.add(sun.target);
const ambient = new THREE.AmbientLight(0xfff6ea, 0.4);
const hemi = new THREE.HemisphereLight(0x8ec6ee, 0x3a332c, 0.35);
scene.add(ambient, hemi);

const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), createSkyMaterial());
sky.frustumCulled = false;
sky.renderOrder = -1;
scene.add(sky);

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
let trains = null;
let trainMesh = null;
let sim = null;
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
  const sky = skyColors(sunPos.altitude);
  cityUniforms.uNight.value = sky.night;
  cityUniforms.uDay.value = sky.day;
  cityUniforms.uSunDir.value.set(sunPos.x, Math.max(sunPos.y, -0.2), sunPos.z);
  cityUniforms.uSky.value.setRGB(sky.zenith[0], sky.zenith[1], sky.zenith[2]);
  cityUniforms.uHorizon.value.setRGB(sky.horizon[0], sky.horizon[1], sky.horizon[2]);
  const target = controls.target;
  const lift = sunPos.y > 0 ? sunPos : { x: -sunPos.x, y: 0.35, z: -sunPos.z };
  sun.position.set(target.x + lift.x * 900, target.y + lift.y * 900, target.z + lift.z * 900);
  sun.target.position.copy(target);
  sun.intensity = sunPos.y > 0 ? 0.15 + 2.5 * sky.day : 0.12;
  sun.color.setRGB(sky.sun[0], sky.sun[1], sky.sun[2]);
  ambient.intensity = 0.1 + 0.38 * sky.day;
  ambient.color.set(sky.night > 0.6 ? 0x1a2744 : 0xfff6ea);
  hemi.intensity = 0.12 + 0.32 * sky.day;
  hemi.color.copy(cityUniforms.uSky.value);
  scene.fog.color.copy(cityUniforms.uHorizon.value);
  scene.fog.near = 900 + 80 * sky.day;
  scene.fog.far = 4800 - 400 * sky.day;
  renderer.toneMappingExposure = 0.62 + 0.55 * sky.day;
  if (streamer.headMat) streamer.headMat.emissiveIntensity = sky.night * 2.2;
  if (streamer.poolMat) streamer.poolMat.opacity = sky.night * 0.45;
  signsMat.emissiveIntensity = 0.15 + sky.night * 0.9;
  if (cars) cars.lampMat.emissiveIntensity = 0.05 + sky.night * 1.6;
  if (trainMesh) trainMesh.windows.material.emissiveIntensity = sky.night * 0.7;
  clockEl.textContent = formatHour(hour);
  const span = sun.shadow.camera;
  const size = Math.min(900, Math.max(180, camera.position.distanceTo(target) * 0.75));
  if (Math.abs(span.right - size) > 8) {
    span.left = -size; span.right = size; span.top = size; span.bottom = -size;
    span.updateProjectionMatrix();
  }
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
    renderer.setAnimationLoop(() => renderer.render(scene, camera));
    return;
  }
  const areaId = params.get('area') || index.areas[0].id;
  const city = await loadCity(areaId, base);
  subtitle.textContent = city.manifest.name;
  document.title = `${city.manifest.name} · 上海三维`;
  credit.innerHTML = `${city.manifest.attribution.osm}<br>${city.manifest.attribution.dem}<br>做法来自 <a href="https://github.com/jeantimex/tokyo">jeantimex/tokyo</a>`;
  streamer.poolMat.map = makeCircleTexture();
  await streamer.start(city, signAtlas);

  const graph = prepareGraph(city.roads);
  const count = Math.min(180, Math.max(12, Math.round(graph.edges.reduce((s, e) => s + e.length, 0) / 45)));
  sim = graph.edges.length ? createSim(graph, { count, seed: 7 }) : null;
  if (sim) {
    cars = createCarFleet(sim.cars.length);
    scene.add(cars.body, cars.glass, cars.lamps);
  }
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
  running = true;
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
  renderer.setSize(window.innerWidth, window.innerHeight);
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

const clock = new THREE.Clock();
let streamTimer = 0;
applySun();
boot().catch((error) => {
  console.error(error);
  gate.hidden = false;
  statsEl.textContent = error.message;
});

renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  cityUniforms.uTime.value += dt;
  controls.update();
  moveTarget(dt);
  if (running) {
    streamTimer += dt;
    if (streamTimer > 0.25) {
      streamer.update();
      streamTimer = 0;
    }
    if (sim && trafficOn) stepSim(sim, dt);
    if (trainsOn) stepTrains(trainList, dt);
    if (cars && sim) {
      sim.cars.forEach((car, i) => {
        const pose = carPose(sim, car);
        if (!pose) return;
        setVehicleMatrix(cars.body, i, cars.dummy, pose.x, pose.y, pose.z, pose.dx, pose.dz);
        setVehicleMatrix(cars.glass, i, cars.dummy, pose.x, pose.y, pose.z, pose.dx, pose.dz);
        setVehicleMatrix(cars.lamps, i, cars.dummy, pose.x, pose.y, pose.z, pose.dx, pose.dz);
      });
      cars.body.instanceMatrix.needsUpdate = true;
      cars.glass.instanceMatrix.needsUpdate = true;
      cars.lamps.instanceMatrix.needsUpdate = true;
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
    const phase = cityUniforms.uNight.value < 0.35 ? '白天' : cityUniforms.uNight.value < 0.75 ? '黄昏' : '夜晚';
    statsEl.textContent = `${phase} · 街区 ${streamer.loadedCount} / ${streamer.total} · 车辆 ${sim ? sim.cars.length : 0} · 列车 ${trainList.length}`;
  }
  applySun();
  renderer.render(scene, camera);
});

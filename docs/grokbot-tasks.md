# 交给 grokbot 的任务

每个任务都可以单独交出去，彼此不改同一个文件（第 2、3 条都在 `src/world/landmarks.js`，但改的是不同函数，**请先后做，不要同时做**）。下面「公共说明」每个任务都要带上。

## 公共说明（每个任务都附上）

- 仓库：`F:\3d-city`（GitHub `IsanaNao/3d_city`），浏览器里的上海三维城市，Three.js + Vite。项目说明在 `README.md`，和东京项目的差距与进度在 `docs/与东京的差距.md`。
- 坐标：局部米制，X 向东、Y 向上、Z 向南，原点在区域中心。
- 运行：`npm install`，`npm run dev`，打开 `http://127.0.0.1:4317`。数据已编译在 `public/tiles/`（不入库）；改了 `tools/pipeline/` 下的代码要跑 `npm run compile`（约 1 分钟，用本地缓存，不联网）。
- 固定机位截图：地址栏 `?cam=x,y,z&look=x,y,z&time=21&traffic=0&up=1`。`time` 是小时（21 = 夜，19.45 = 蓝调，11 = 白天），`up=1` 允许仰视。改前改后用同一个机位各截一张对比。
- 测试：`npm test`（Node 20 或 24 都行），提交前必须全过；新行为要加测试，测试在 `tools/tests/*.test.mjs`。
- 代码风格：和周围代码一致。注释用英文、写「为什么」，不写「做了什么」；改着色器要把对应的 `customProgramCacheKey` 版本号加一，否则浏览器用旧缓存。
- 地标是手写程序模型，不要引入外部模型或贴图；不能用 Google/百度/Esri/Mapbox 的影像或街景（许可不允许再分发）。照片纹理只能用 CC0。
- 做完在 `docs/与东京的差距.md` 末尾「已经做了的」里加一小段说明（中文），并说明怎么验证。不要推送，不要改 git 历史。

---

## 任务 1：扩充「名楼外观表」

**背景**：`src/shared/towers.js` 给陆家嘴一批有名的楼指定白天玻璃色调和夜景样式（`NIGHT.MEDIA` 整面 LED 屏、`WHITE`/`BLUE` 轮廓灯、`GOLD` 金色楼冠）。目前只有十来栋。

**要做**：
1. 列出数据里高于 120 米、有名字的楼（可以参考下面的脚本，跑在仓库根目录），对照公开照片，补全陆家嘴、北外滩、浦西外滩后排的知名塔楼：白天大致玻璃颜色（十六进制）、夜里是轮廓灯、媒体墙还是金冠。
2. 只改 `src/shared/towers.js` 的表；如需新的夜景样式，先在这里提出，不要直接改着色器。
3. 在 `tools/tests/format.test.mjs` 里加一条：表里每条正则至少能匹配到瓦片里的一栋楼（读 `public/tiles/bund/t_*.bin`，用 `decodeTile`；瓦片不在时跳过该测试）。

```js
// node --input-type=module -e "..."：列出有名字的高楼
import fs from 'fs'; import { decodeTile } from './src/shared/tileformat.js';
const m = JSON.parse(fs.readFileSync('public/tiles/bund/manifest.json'));
const seen = new Map();
for (const k of m.tiles) { const b = fs.readFileSync(`public/tiles/bund/t_${k}.bin`);
  for (const x of decodeTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).buildings)
    if (x.name && x.topY - x.baseY > 120) seen.set(x.name, Math.round(x.topY - x.baseY)); }
console.log([...seen].sort((a, b) => b[1] - a[1]));
```

**验收**：外滩望陆家嘴夜景 `?cam=-1095,22,-40&look=0,170,40&time=21&up=1&traffic=0` 和白天 `time=11` 两张，名楼颜色和夜景与照片大体一致；测试全过。

---

## 任务 2：白玉兰广场（金光中心）塔楼外形

**背景**：`src/world/landmarks.js` 里的 `magnolia(h)` 是北外滩白玉兰广场办公塔（约 320 米）。现在顶部是一个水平挑出的圆盘平台，和实楼不像。测试 `tools/tests/landmarks.test.mjs` 里有一条 `white magnolia has an open observation crown`。

**要做**：
1. 查公开资料确认实楼的平面形状、立面分格和顶部造型（顶部是否有观景层、花瓣状收头等）。
2. 改 `magnolia()`，形体尽量贴近实楼，构件数量克制（项目方针：不要堆很多细圆柱），并处理好夜景（参考 `syncLandmarkNight`、`glassMaterial` 的做法）。
3. 如果顶部形式变了，相应更新那条测试的断言，并在测试注释里写明依据。

**验收**：近景 `?cam=-150,170,-1250&look=-398,170,-1361&time=14&up=1&traffic=0` 和同机位 `time=21`；北外滩远景 `?cam=-1000,60,-700&look=-398,150,-1361&time=11&up=1`。

---

## 任务 3：东方明珠灯光秀图案（在任务 2 之后做）

**背景**：明珠夜景由 `src/shared/show.js` 的 `pearlShow()` 按时刻选配色（约二十分钟一换），`landmarks.js` 里 `pearlMat` 的着色器把球面画成均匀的 LED 点阵、赤道一圈亮带；立柱上是灯带和接缝灯环（`pearlMemberShader`）。现在只有「整球一种颜色」。

**要做**：
1. 参考明珠夜景视频，在现有七种配色之外加 3–4 种图案：例如从下往上的颜色波、经线方向旋转的条纹、上下球交替闪烁、球面上的大块渐变。图案要慢，不要频闪。
2. 图案由 `uShowPhase` / `uShowScheme` 驱动（都在 `cityUniforms` 里），保持「同一时刻总是同一种状态」，`?pearl=blue` 等固定参数仍然有效。
3. 给 `pearlShow()` 补测试（`tools/tests/format.test.mjs` 里已有相关断言，可以参照）。

**验收**：明珠近景 `?cam=-160,8,-170&look=-242,180,-321&time=21&up=1` 和外滩望陆家嘴夜景，各截几个不同时刻（`time=21`、`21.3`、`21.6`）。

---

## 任务 4：南浦大桥、杨浦大桥白天细节与夜景

**背景**：`src/world/bridges.js` 的 `cableBridge()` 生成两座斜拉桥的塔和拉索（南浦是 H 形塔，杨浦是倒 Y 形塔），桥面是 OSM 道路。夜里只有整体微弱的发光。

**要做**：
1. 夜景：拉索沿索亮一串灯（真实夜景里两座桥的拉索都有成串的灯），塔身泛光，塔顶亮；颜色参考夜景照片。
2. 白天：核对塔的比例和横梁位置、拉索数量与锚点分布，必要时调整；拉索不要用太多高分段圆柱（性能和观感都不好），可以用细的扁平带或低分段。
3. 保持现有测试（`named crossings become a truss and two cable-stayed bridges` 等）通过；如改了结构，在测试里补对应断言。

**验收**：南浦 `?cam=-600,120,3000&look=300,60,3500&time=21&up=1`、杨浦 `?cam=3500,150,-1500&look=4100,60,-2050&time=21&up=1`，白天各一张（`time=11`）。

---

## 任务 5：交通模拟移到 Web Worker

**背景**：`src/sim/traffic.js`（车，约 2800 辆）和 `src/sim/crowd.js`（行人，最多约 1600）每帧在主线程步进；`src/main.js` 的 `packCars()`/`packPeople()` 只把相机附近的写进实例矩阵。拖动相机时脚本和渲染抢主线程。

**要做**：
1. 新建一个 Worker，持有路网（`prepareGraph` 的结果）和模拟状态，按固定步长步进，每帧（或每两帧）把「车/人的位置与朝向」用 `Float32Array` 可转移对象发回主线程。
2. 主线程只负责按相机距离挑选并写实例矩阵，逻辑保持和现在的 `packCars()` 一样（颜色跟车走，不跟槽位走）。
3. 路网目前由主线程 `fetch` 的 `roads.json` 得到；可以让 Worker 自己 fetch 和解析，避免主线程解析 15MB JSON。
4. 保留 `?traffic=0` 关闭交通的行为；`tools/tests/` 里的交通测试（右侧通行、跟车不超车、信号灯）必须继续通过——模拟逻辑本身不要改，只换运行位置。

**验收**：俯瞰和外滩机位下，打开开发者工具 Performance 录 5 秒拖动相机，主线程脚本时间明显下降；车辆仍然右侧通行、遇红灯停。

---

## 任务 6：用 OSM 的真实颜色和材质

**背景**：建筑颜色现在由 `tools/pipeline/osm.mjs` 的 `wallColor()` 按用途和种子随机生成。OSM 有些建筑标了 `building:colour`、`roof:colour`、`building:material`、`roof:material`。

**要做**：
1. 在 `osm.mjs` 里读取这些标签：有 `building:colour` 时用它（支持颜色名和 `#rrggbb`），没有时保持现在的随机逻辑；`building:material`（glass、brick、stone、concrete、metal 等）映射到现有的 `BFLAG.GLASS` 或用途风格。
2. `roof:colour` 目前没有通道：先评估是否值得在瓦片格式里加一个字段（`src/shared/tileformat.js`，格式版本号要加一，旧瓦片要能报清楚的错误），如果加，就同步改 `src/shared/meshbuild.js` 的屋顶颜色。
3. 跑 `npm run compile`，统计有多少栋楼用上了真实颜色，写进文档。
4. 在 `tools/tests/` 加解析颜色名和十六进制的测试。

**验收**：统计数字；外滩和陆家嘴各一张白天截图，标了颜色的楼和照片一致。

---

## 任务 7：蓝调时刻与城市光污染的天空

**背景**：日落后约 20–40 分钟（`time=19.45` 左右）的天空现在偏紫灰。天空颜色在 `src/world/environment.js` 的 `SKY`、`FOG`、`GLOW`，天空着色器在 `src/world/materials.js` 的 `createSkyMaterial()`。宣传片里这段时间天空是深蓝，地平线附近有一点城市灯光的暖色。

**要做**：
1. 调整日落后几度到入夜之间的天空和雾颜色，让天顶偏深蓝、地平线一圈淡暖，入夜后再过渡到现在的夜空。
2. 不要影响正午和深夜的观感（改前改后各截 `time=11` 和 `time=23` 对比）。
3. 如果改了 `src/shared/sun.js` 里的曲线，`tools/tests/format.test.mjs` 里的昼夜测试要相应更新。

**验收**：外滩望陆家嘴 `?cam=-1095,22,-40&look=0,170,40&up=1&traffic=0`，`time=19.2`、`19.45`、`19.8`、`11`、`23` 五张。

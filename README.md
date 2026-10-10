# 上海 · 三维城市

浏览器里的上海实时三维模型。建筑轮廓、道路、地铁和水面来自 OpenStreetMap，地面高程来自公开 DEM。数据先编译成 256 米一块的二进制瓦片，页面只拉取视野附近的块，再用 Three.js 加上窗户、招牌、屋顶设备和随时间变化的灯光，以及按中国右侧通行规则行驶的车辆和列车。

默认范围是外滩到陆家嘴：大约南北 1.4 公里、东西 2.1 公里。当前这份编译结果里有 469 栋建筑、756 条行车边、10 条轨道和 60 块瓦片。边界可以改，范围可以加大。

## 致谢

做法来自 [jeantimex/tokyo](https://github.com/jeantimex/tokyo)（[MIT](https://github.com/jeantimex/tokyo/blob/master/LICENSE)）。东京那个项目用 PLATEAU 的建筑和地形、程序化立面、昼夜灯光、沿路行驶的车辆，以及分块加载。本仓库是按同样的四条思路为上海写的独立实现，没有复制 tokyo 的源代码。PLATEAU 只覆盖日本，所以这里改用 OpenStreetMap 和公开高程。

地图数据 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 贡献者，许可为 ODbL。高程来自 [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) 上的 Mapzen Terrarium（含 SRTM 等公开 DEM）；Terrarium 下载失败时会改用 [Open-Meteo](https://open-meteo.com/) 的 Copernicus DEM 采样。

## 准备数据

原始下载和编译结果都不进 git。`data/` 和 `public/tiles/` 已在 `.gitignore` 里。在本机生成：

```bash
npm install
npm run pipeline
```

`pipeline` 会先下载、再编译。也可以分开跑：

```bash
npm run fetch
npm run compile
```

默认区域是 `bund`（外滩 · 陆家嘴）。换一块矩形：

```bash
npm run pipeline -- --bbox=31.22,121.47,31.25,121.51
```

四个数依次是南、西、北、东（纬度、经度）。要重新下载已缓存的原始数据，加上 `--force`。

另一个固定区域可以写进 `tools/pipeline/config.mjs` 的 `AREAS`，然后：

```bash
npm run pipeline -- --area=bund
```

市中心建筑密集，范围加大后 Overpass 查询和编译都会更慢，瓦片也会变多。先用默认小范围确认浏览正常，再往外扩。

### 管线在做什么

1. 用 Overpass 拉取建筑（含 `height` / `building:levels` / `building:part`）、道路、信号灯、铁路与地铁、水面、公园和广场。
2. 下载 Terrarium 高程瓦片，采样成米制格网。上海是冲积平原，SRTM 会把塔楼当成地形，编译时会把建筑占地和偏离下四分位超过 8 米的格子，用周围地面填回去，避免陆家嘴站在小山上。黄浦江会再向下挖一截。
3. 把经纬度投影到以区域中心为原点的局部米制坐标：X 向东，Y 向上，Z 向南。
4. 按 256 米网格切开建筑、地面和道路，写成 `SHG1` 瓦片。缺高度时按层数或用途给一个默认值；上海中心、上海环球金融中心、金茂大厦、东方明珠等有公开高度的地标会用表内数值。`roof:shape` 为 dome / round / pyramidal / hipped / onion 的建筑会生成穹顶或尖顶（高度取 `roof:height`，没有时按占地估算）；`building:material=glass|mirror` 会画成玻璃幕墙。
   高程格网默认按 8 米重采样，河岸切得更干净。
5. 另外写出整网地形 `terrain.bin`、行车图 `roads.json` 和轨道 `rails.json`。

## 本地运行

```bash
npm run dev
```

浏览器打开 [http://127.0.0.1:4317](http://127.0.0.1:4317)。

- 拖拽平移，右键旋转，滚轮缩放，触屏双指缩放旋转。
- WASD 或方向键移动观察目标。
- 滑杆改时刻，或按「夜晚」/ 键盘 `N` 在日夜之间切换。
- 点一栋建筑可以看名称、用途和大致高度。
- 「俯瞰 / 外滩 / 陆家嘴」是三个固定机位。地址栏也可以直接指定：`?view=overview`、`?view=bund`、`?view=lujiazui`，以及 `?time=21` 或 `?night=1`。
- 任意机位：`?cam=x,y,z&look=x,y,z`（局部米制坐标，X 向东、Y 向上、Z 向南），方便截图和多角度录屏复现同一个画面。

还没有瓦片时，页面会停在说明，而不是黑屏。

测试：

```bash
npm test
```

## 静态部署

```bash
npm run build
npm run preview
```

`vite.config.js` 使用相对路径 `base: './'`，同一份 `dist/` 可以放在域名根目录，也可以放在 GitHub Pages 的项目路径下（例如以后的 `IsanaNao/3d-city`）。构建时 `public/tiles/` 会原样拷进 `dist/`。瓦片不要提交到 git；若要公开站点，在发布用的构建里带上编译结果，或在 CI 里跑 `npm run pipeline`。

## 项目结构

```
index.html              页面骨架
src/main.js             Three.js 场景、昼夜、交通循环
src/world/              瓦片流式加载、立面与水面着色器、树木路灯、车辆
src/sim/                右侧通行、信号灯、跟车、地铁
src/shared/             投影、二进制瓦片、建筑高度、网格生成（浏览器和 Node 共用）
tools/pipeline/         下载、几何裁剪、路网、编译
tools/tests/            格式、几何、交通和编译测试
public/tiles/           编译输出（不入库）
data/raw/               OSM 与高程缓存（不入库）
```

瓦片头是 `SHG1`（格式版本 2，含屋顶形状与屋顶高度），地形头是 `DEM1`，都是小端二进制。一块瓦片里有裁好的建筑环（边上的共享边不生成内墙）、地面、道路三角带，以及树木、路灯、空调、水箱和招牌的实例点。旧版瓦片需要重新 `npm run compile`。

### 建筑网格与立面

- OSM 常把一座塔楼拆成十几段 `building:part`，相邻或嵌套的段会有重合的墙面。浏览器建网格时会找出共线重合的墙，只保留可见的那一段高度，避免 z-fighting（夜里表现为窗格里的黑白噪点）。
- 相邻边转角小于约 25° 的顶点共享法线，圆柱形塔楼会被平滑着色，而不是一条条棱面。
- 窗户按每面墙的长度排成整数列，转角处不会切开窗户；窗户边缘用屏幕空间导数抗锯齿，窗户小到一两个像素时淡出为平均亮度，远处不会出现闪烁的颗粒。
- 夜里亮灯的窗户随天色逐步增加，并按楼层成组明暗；暖白和冷白两种灯色，亮度逐窗不同。

## 和 tokyo 相比简化了什么

已经有的：公开数据骨架、程序化窗户和夜窗、屋顶设备、招牌、树木和路灯、昼夜太阳、按道路行驶并遵守信号与跟车的车辆、地铁/列车、256 米分块流式加载。

还比较粗的地方：

- 没有 PLATEAU 那种带 LOD 的实测建筑模型，形体是 OSM 脚印和 `building:part` 拉高，只支持穹顶、尖顶和洋葱顶几种屋顶；上海中心的扭转、环球金融中心的开口要靠 OSM 分段近似。窗户和招牌是着色器和实例，不是逐栋贴图。
- 交通是单车道的右侧偏移，没有真实车道数展开、变道和行人。
- 地铁在地面或略高于地面的路径上移动；隧道不会真正进入地下空间。
- 高程被压成平原上的缓坡，用来避免雷达楼体，不是厘米级地形。
- 没有 tokyo 那套更完整的资产管线、后处理和城市级范围。

## 许可

本仓库代码使用 [MIT License](LICENSE)。OpenStreetMap 数据另行适用 ODbL，不能把数据的许可说成 MIT。

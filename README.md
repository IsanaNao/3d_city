# 上海 · 三维城市

浏览器里的上海实时三维模型。建筑轮廓、道路、地铁和水面来自 OpenStreetMap，地面高程来自公开 DEM。数据先编译成 256 米一块的二进制瓦片，页面只拉取视野附近的块，再用 Three.js 加上窗户、招牌、屋顶设备和随时间变化的灯光，以及按中国右侧通行规则行驶的车辆和列车。

默认范围覆盖黄浦江两岸：南到南浦大桥一带，北到杨浦大桥和北外滩白玉兰广场，西到外滩万国建筑与延安高架路东端，东到陆家嘴。大约南北 7.5 公里、东西 8.4 公里。当前这份编译结果里有 11846 栋建筑、10793 条行车边、131 条轨道和 989 块瓦片。页面仍按视野流式加载，不会一次把全市拉进内存。

## 致谢

做法来自 [jeantimex/tokyo](https://github.com/jeantimex/tokyo)（[MIT](https://github.com/jeantimex/tokyo/blob/master/LICENSE)）。东京那个项目用 PLATEAU 的建筑和地形、程序化立面、昼夜灯光、沿路行驶的车辆，以及分块加载。本仓库是按同样的四条思路为上海写的独立实现，没有复制 tokyo 的源代码。PLATEAU 只覆盖日本，所以这里改用 OpenStreetMap 和公开高程。

地图数据 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 贡献者，许可为 ODbL。高程来自 [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) 上的 Mapzen Terrarium（含 SRTM 等公开 DEM）；Terrarium 下载失败时会改用 [Open-Meteo](https://open-meteo.com/) 的 Copernicus DEM 采样。墙面、屋顶、路面和地面的照片纹理来自 [Poly Haven](https://polyhaven.com) 和 [ambientCG](https://ambientcg.com)，全部是 [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)（公有领域），清单见下文。

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

照片纹理同样不进 git（`public/textures/` 和下载缓存 `data/textures/`）。安装依赖后执行一次：

```bash
npm run textures
```

脚本按 `src/shared/textures.js` 里的清单下载 1K JPG，收成带完整 mip 链的 KTX2 纹理数组（Basis UASTC，显卡上转成 BC7 / ASTC 等压缩格式）。没有这些文件时，立面和地面退回程序化表面，页面照常打开。加 `--force` 会重新下载。

### 管线在做什么

1. 用 Overpass 拉取建筑（含 `height` / `building:levels` / `building:part`）、道路、信号灯、铁路与地铁、水面、公园和广场。
2. 下载 Terrarium 高程瓦片，采样成米制格网。上海是冲积平原，SRTM 会把塔楼当成地形，编译时会把建筑占地和偏离下四分位超过 8 米的格子，用周围地面填回去，避免陆家嘴站在小山上。黄浦江在 DEM 里是一条几百米宽的缓坡，编译时把水面多边形压成统一的河床，并把坡岸抬回街面，形成防汛墙。苏州河这类没有河岸多边形的 `waterway=river` 会按河宽缓冲成连续水面；名为黄浦江的中心线不再缓冲，避免盖住已经有的河面。外滩西岸和陆家嘴滨江是垂直防汛墙加高出的铺装步道（栏杆和路灯）。滨江公园、陆家嘴绿地这类标到水边的公园，墙和步道仍沿水线走，草地留在步道内侧；不在这两段岸线上的公园仍是缓坡。
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
- 「俯瞰 / 外滩 / 陆家嘴」是三个固定机位。地址栏也可以直接指定：`?view=overview`、`?view=bund`、`?view=lujiazui`，以及 `?time=21` 或 `?night=1`。`?sky=dusk` 固定傍晚的暖霾，`?sky=clear` 保持晴空。`?pearl=red|magenta|blue|purple|gold|green|rainbow` 把明珠夜景灯光钉在一种颜色上，方便截图；不写则按时刻循环。
- 任意机位：`?cam=x,y,z&look=x,y,z`（局部米制坐标，X 向东、Y 向上、Z 向南），方便截图和多角度录屏复现同一个画面。
- 画质开关：`?ao=0` 关闭环境光遮蔽，`?mirror=0` 关闭江面实时倒影（这两项最耗 GPU），`?clouds=0.5` 打开程序化云层，`?photo=0` 关闭照片纹理。

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
src/world/              瓦片流式加载、立面/地面/水面/天空着色器、光照环境、后处理、路灯光照贴图、江面镜像、车辆
src/sim/                右侧通行、信号灯、跟车、地铁
src/shared/             投影、二进制瓦片、建筑高度、网格生成（浏览器和 Node 共用）
tools/pipeline/         下载、几何裁剪、路网、编译
tools/assets/           CC0 照片纹理的下载与 KTX2 打包
tools/tests/            格式、几何、交通、纹理和编译测试
public/tiles/           编译输出（不入库）
public/textures/        打包后的纹理数组（不入库）
data/raw/               OSM 与高程缓存（不入库）
data/textures/          纹理原图缓存（不入库）
```

瓦片头是 `SHG1`（格式版本 2，含屋顶形状与屋顶高度），地形头是 `DEM1`，都是小端二进制。一块瓦片里有裁好的建筑环（边上的共享边不生成内墙）、地面、道路三角带，以及树木、路灯、空调、水箱和招牌的实例点。旧版瓦片需要重新 `npm run compile`。

### 建筑网格与立面

- OSM 常把一座塔楼拆成十几段 `building:part`，相邻或嵌套的段会有重合的墙面。浏览器建网格时会找出共线重合的墙，只保留可见的那一段高度，避免 z-fighting（夜里表现为窗格里的黑白噪点）。
- 相邻边转角小于约 25° 的顶点共享法线，圆柱形塔楼会被平滑着色，而不是一条条棱面。
- 窗户按每面墙的长度排成整数列，转角处不会切开窗户；窗户边缘用屏幕空间导数抗锯齿，窗户小到一两个像素时淡出为平均亮度，远处不会出现闪烁的颗粒。
- 窗户有窗框和竖梃，玻璃后面用 interior mapping 画出房间的进深；夜里亮灯的房间光从房间里某盏灯发出，向窗角衰减，一部分窗拉着窗帘，光会溢到窗框和墙上。高塔夜里按楼层成带亮着暖色窗灯，远处不再是一粒粒随机光点；塔缘和冠部有一条随时刻变色的灯带。外滩的历史建筑夜里只在檐口和屋顶受暖色泛光，窗洞保持暗。
- 白天玻璃是金属度高、粗糙度低的 PBR 面，反射天空环境贴图，并带太阳的镜面高光；墙面有雨痕、墙脚污渍和檐下水渍。
- 照片纹理按用途和高度选层，再乘上建筑自己的颜色：高层住宅用白瓷砖或马赛克，低层住宅用红砖、青红砖或抹灰，办公和商业用混凝土板或挂板，厂房用压型钢板，外滩历史建筑用砂岩块石，平屋顶用旧混凝土。玻璃幕墙和一部分较高的办公楼、住宅改贴整张立面照片（ambientCG），照片自带的玻璃遮罩决定哪些像素是窗户，夜里的房间灯光、窗帘和太阳高光仍落在这些窗格上。沥青、人行道砖、草地和广场铺装铺在道路和地面上。纹理坐标按世界米缩放，法线在屏幕空间重建，不用另存切线。黄浦江仍是实时倒影，没有用水面照片。
- 东方明珠、上海中心、环球金融中心、金茂大厦、北外滩的白玉兰广场（金光中心），以及外滩的上海海关、汇丰银行大楼、和平饭店、中国银行大楼，不用脚印拉高，改用程序生成的形体。明珠的球是连续的玫瑰红色玻璃壳，下面更暗，板块之间深浅不同，朝上映天、朝下映城。赤道和上下各有一圈浅色观光环。柱和斜腿白天是浅灰混凝土。夜里整个球体、纬向色带、观光环和柱身按场景时刻发出同一种光（红、品红、蓝、紫、金、绿、彩虹，约二十分钟一换，末尾交叉淡入），光点只是叠在上面的闪光；同一时刻总是同一种状态，地址栏 `pearl=blue` 可以钉住一种颜色。斜腿跟着该色走。上海中心顶部圆冠夜里随同一时钟换冷色。环球金融中心从约三分之一高度起被两道弧切掉，两面宽墙收到一条平整的长屋脊，两端是尖角。梯形洞口开在这条长边所在的面上，上宽下窄，底边和顶边都是水平直线，两侧是直的斜边；洞口上方是一条大约为洞高三分之一的水平桥，桥身是玻璃，上下各有一道细银边。从江面和四分之三角度看，洞都是上宽下窄的倒梯形，不是三角或拱。金茂最上几段夜里是金色。白玉兰广场顶上是挑出的观景平台。外滩沿街按实楼的轮廓来：海关是退台钟楼，门廊、四面钟和方锥；汇丰是宽柱廊和鼓座上的肋穹顶；和平饭店是窄石塔加绿铜皮方锥；中国银行是装饰艺术派退台和蓝绿琉璃庑殿。OSM 能对上名字的邻居也换成石楼：外滩 1 号（太平洋保险，角上有穹顶）、华尔道夫（两座屋顶亭）、有利大楼、外滩五号、外滩 18 号（中间两根大柱）、和平饭店南楼、总工会（竖向线条）、外汇交易中心（道胜银行旧址，小穹顶）、招商银行、横滨正金银行旧址（名称是中国工商银行的那一栋矮楼）、罗斯福/外滩 27 号、光大银行。白天是浅暖的花岗石，层间檐口压着一条阴影。夜里暖金泛光贴着檐口、柱和穹顶，窗洞是暗的。OSM 没单独命名的沿江楼也是同一套石立面：外滩六号和友邦大厦是屋顶亭，盘谷银行和轮船招商局是小穹顶，清算所是一对端亭，农业银行是中亭，北段无名楼和其余对不上屋顶的楼用新古典檐口。汇丰所在的浦东发展银行脚印保持石立面，穹顶仍用外滩 12 号的模型。汇丰银行大楼在 OSM 里没有名称，穹顶按外滩 12 号的位置放在海关南侧。几何是本仓库自己写的，没有外部模型。
- 外白渡桥是钢桁架，架在苏州河河口。南浦大桥和杨浦大桥是斜拉桥：南浦两座塔都是同样的 H 形（双柱加两道横梁），拉索分别锚在两根柱上，浦西引桥按 OSM 的分层桥面叠成盘道；杨浦是倒 Y 形塔，桥面沿内环高架路的过江段，引桥从桥头缓缓落到普通高架高度。桥面本身仍是 OSM 车行道，塔和索是程序生成的。
- 车行道宽度优先用 OSM 的 `width` 或 `lanes`。世纪大道、陆家嘴环路和中山东路的人行道加宽。人行道在路缘外侧抬高一截，路口处断开，路缘是一条竖向的混凝土。车道线按车道数画，主干道中线是双黄线，路口有斑马线。`bridge` 或 `layer` > 0 的路抬成桥面，带栏板和桥墩；匝道从高架落到地面。延安东路隧道仍在地下，延安高架路在西侧是高架，陆家嘴环形人行天桥是闭合的宽桥面。悬铃木沿适合的街道两侧种（近处是分枝树冠，远处换成简单树冠），公园里另有一批。信号灯放在 OSM 交通信号旁边的人行道上。外滩海关、和平饭店、中国银行，以及 OSM 里能对上的外滩石楼（外滩 1 号、华尔道夫、有利大楼、外滩五号、外滩 18 号、和平饭店南楼、总工会、外汇交易中心、招商银行、工商银行矮楼、罗斯福、光大银行）换成各自的屋顶和柱式；汇丰银行大楼在 OSM 里没有名称，穹顶按外滩 12 号的位置放在海关南侧。没有铺装标注的街坊地面按离道路的远近分成行道铺装、草地和院子，不再是一整片灰。

### 光照与后处理（对齐 tokyo 的做法）

- 太阳颜色按大气质量（air mass）衰减：正午近白，贴地时变橙变弱；天空和城市反射各用一盏半球光；夜里换成偏蓝的月光，加一层城市自己的灯光在雾霾上的反光。
- 曝光随场景亮度自动调整，昼夜过渡沿用 tokyo 的曲线：太阳离地 9° 开始亮灯，落到 -13° 才完全入夜。
- 后处理链（pmndrs `postprocessing` + `n8ao`）：环境光遮蔽 → 贴地高度雾 → 白平衡、bloom、Neutral 色调映射、tokyo 的 Picture 调色（高光/阴影/色偏）、抖动 → SMAA。
- 路灯和车灯不是逐盏光源，而是从正上方画进一张 2048² 的光照贴图（max 混合，叠加不会过曝），道路和地面按自己的颜色接收这份光。
- 江面是实时平面镜像：城市以半分辨率倒着再画一遍，加上波纹扰动和菲涅尔混合。

## 和 tokyo 相比简化了什么

已经有的：公开数据骨架、程序化窗户和夜窗、屋顶设备、招牌、树木和路灯、昼夜太阳、按道路行驶并遵守信号与跟车的车辆、地铁/列车、256 米分块流式加载。

还比较粗的地方：

- 没有 PLATEAU 那种带 LOD 的实测建筑模型。普通楼是 OSM 脚印和 `building:part` 拉高，只支持穹顶、尖顶和洋葱顶几种屋顶。上面四座地标是单独建的形体，不是脚印挤出。窗户和招牌是着色器和可平铺的立面照片，不是逐栋航拍。
- 交通是单车道的右侧偏移，没有真实车道数展开、变道和行人。
- 地铁在地面或略高于地面的路径上移动；隧道不会真正进入地下空间。
- 高程被压成平原上的缓坡，用来避免雷达楼体，不是厘米级地形。
- 没有 tokyo 用到的 PLATEAU 墙面与屋顶航拍（那些纹理不能再分发）。卫星和街景同样不用：OpenAerialMap 在这一带只有约 1 公里分辨率的影像，单幅许可也不明确；Google、Esri、Mapbox、百度等航拍和街景都不能再分发。墙面和地面改用下面这些 CC0 照片。也没有 takram 体积云、屏幕空间窗户反射和镜头光晕，天空仍是解析模型。范围也不是全市。

## 照片纹理

每张都是 CC0 1.0，可以商用、可以再分发、不要求署名。这里仍记下作者和原地址。

墙面和屋顶是细节纹理：打包时记下线性平均色，着色器用它除掉照片自身的颜色，建筑顶点色才透得出来。立面照片保留原色，金属度图放在 alpha 里当作玻璃遮罩。

| 层 | 用在 | 来源 | 作者 | 许可 |
| --- | --- | --- | --- | --- |
| `tile` | 高层住宅白瓷砖 | [Long White Tiles](https://polyhaven.com/a/long_white_tiles) | Jenelle van Heerden, Sergej Majboroda | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `mosaic` | 八九十年代住宅马赛克 | [Rounded Square Tiled Wall](https://polyhaven.com/a/rounded_square_tiled_wall) | Charlotte Baglioni | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `brick` | 红砖里弄 | [Red Brick 03](https://polyhaven.com/a/red_brick_03) | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `brick_mixed` | 石库门青红砖 | [Mixed Brick Wall](https://polyhaven.com/a/mixed_brick_wall) | Dimitrios Savva | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `concrete` | 办公楼石材 / 混凝土板 | [Concrete Panels](https://polyhaven.com/a/concrete_panels) | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `cladding` | 商业楼外墙挂板 | [Exterior Wall Cladding](https://polyhaven.com/a/exterior_wall_cladding) | Charlotte Baglioni | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `stone` | 外滩历史建筑块石 | [Sandstone Blocks 08](https://polyhaven.com/a/sandstone_blocks_08) | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `plaster` | 抹灰墙 | [Grey Plaster](https://polyhaven.com/a/grey_plaster) | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `metal` | 厂房压型钢板 | [Box Profile Metal Sheet](https://polyhaven.com/a/box_profile_metal_sheet) | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `roof` | 平屋顶 | [Concrete Floor Worn 001](https://polyhaven.com/a/concrete_floor_worn_001) | Dimitrios Savva, Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `asphalt` | 沥青路面 | [Asphalt 02](https://polyhaven.com/a/asphalt_02) | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `pavers` | 人行道砖 | [Concrete Pavers](https://polyhaven.com/a/concrete_pavers) | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `grass` | 草地 | [Leafy Grass](https://polyhaven.com/a/leafy_grass) | Charlotte Baglioni | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `pavement` | 广场和空地 | [Concrete Pavement](https://polyhaven.com/a/concrete_pavement) | Charlotte Baglioni | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `glass_panels` | 整块玻璃幕墙 | [Facade001](https://ambientcg.com/view?id=Facade001) | ambientCG (Lennart Demes) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `glass_bands` | 带窗间墙的玻璃幕墙 | [Facade006](https://ambientcg.com/view?id=Facade006) | ambientCG (Lennart Demes) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `brick_windows` | 砖墙方窗 | [Facade018A](https://ambientcg.com/view?id=Facade018A) | ambientCG (Lennart Demes) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `concrete_windows` | 混凝土方窗 | [Facade019A](https://ambientcg.com/view?id=Facade019A) | ambientCG (Lennart Demes) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

Poly Haven 的条目在 [polyhaven.com](https://polyhaven.com/license)，ambientCG 的在 [ambientcg.com/about](https://ambientcg.com/about)；两处都声明材质为 CC0。`npm run textures` 还会在 `public/textures/CREDITS.md` 再写一份同样的清单。

## 许可

本仓库代码使用 [MIT License](LICENSE)。OpenStreetMap 数据另行适用 ODbL，不能把数据的许可说成 MIT。照片纹理另行适用 CC0 1.0，不能把它们的许可说成 MIT。

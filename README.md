# 足迹点亮地图 · 双端实现方案（H5 + 微信小程序）

[![在线演示](https://img.shields.io/badge/demo-live-C0503C)](https://codedogqby.github.io/footprint-map/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![core size](https://img.shields.io/badge/core-26KB%20zero--dep-success.svg)](./src/map-core.js)
[![geo data](https://img.shields.io/badge/主数据-381KB%20%2F%20gzip%20118KB-informational.svg)](./dist/mapdata.json)
[![city blocks](https://img.shields.io/badge/市级区块-475个%20%2F%20gzip%20224KB-informational.svg)](./dist/cities.json)

> 一个 26KB 的纯 JS 内核（零依赖）+ 两份抽稀 GeoJSON，同时喂饱 H5 与小程序。
> 不用任何地图 SDK —— 因为这类"点亮图"的本质是**画多边形**，不是**看地图**。

**▶ [在线演示](https://codedogqby.github.io/footprint-map/)** —— 手机浏览器打开可直接点，数据全部在本地，无网络请求。

需求：一套代码同时跑在 **H5** 和 **微信小程序**；能切换 **世界地图 / 中国地图**；中国地图可 **下钻到省**，
省内以 **区块** 表示地级市并支持点亮；**默认中国地图**。

---

## 效果

| 中国地图（默认） | 选中省份 | 下钻到省 · 市级区块 | 点亮多个市 |
|:---:|:---:|:---:|:---:|
| ![中国](shots/1-china.png) | ![选中](shots/2-select-guangdong.png) | ![下钻](shots/3-guangdong-cities.png) | ![点亮](shots/4-guangdong-lit.png) |

| 世界地图 | 选中国家 | 点台北归属中国 |
|:---:|:---:|:---:|
| ![世界](shots/6-world.png) | ![选中日本](shots/7-world-select-japan.png) | ![台湾归属](shots/8-world-taiwan.png) |

> 以上截图由 `npm run shots` 自动生成。

---

## 1. 结论先行：不要用地图 SDK，用矢量轮廓自绘

这类"点亮图"的本质是 **画多边形**，不是 **看地图**。

| | 用地图 SDK（腾讯/高德/百度） | 矢量轮廓自绘（本方案） |
|---|---|---|
| 小程序 + H5 复用 | 两端 API 完全不同，要写两套 | 内核 100% 复用 |
| 世界地图 | 各家 SDK 都不做"世界国家轮廓" | GeoJSON 直接支持 |
| 视觉 | 真实瓦片底图会干扰"点亮"的对比度 | 纯色对比，点亮效果最干净 |
| 体积 / 首屏 | 引入 SDK 数百 KB ~ 数 MB | 内核 26KB，首屏数据 381KB（市级区块 858KB 按需加载） |
| 省市下钻 | 需要额外图层逻辑 | 换一份 GeoJSON 换个 bbox 而已 |

**唯一需要 SDK 的场景**：要做 POI 搜索、真实路线导航、实时定位地图、卫星影像。
这些需求本方案不覆盖，那时再单独用腾讯位置服务（小程序 `map` 组件 / GL JS）做旁路。

---

## 2. 目录结构

```
map-demo/
├── src/map-core.js            ★ 双端共用内核（纯 JS，26KB，零依赖）
├── dist/mapdata.json          ★ 主地图数据（381KB / gzip 118KB）
├── dist/cities.json           ★ 市级区块几何（858KB / gzip 224KB，按需加载）
├── web/index.html             ★ H5 容器（引用上面三个文件，用于真实部署）
├── preview.html               单文件自包含预览（数据已内联，双击即开）
├── index.html                 GitHub Pages 入口（跳转到 preview.html）
├── miniprogram/               ★ 微信小程序容器
│   ├── pages/map/map.{js,wxml,wxss,json}
│   └── utils/                 以下三个文件由 build_preview.py 生成，勿手改
│       ├── map-core.js        从 src/ 复制
│       ├── mapdata.js         从 dist/mapdata.json 转成 CommonJS
│       └── cities.js          从 dist/cities.json 转成 CommonJS（下钻时才 require）
├── data/                      原始数据（保留以便离线复现）
│   ├── china_provinces.json       阿里云 DataV 省级轮廓
│   ├── china_city_points.json     各省下级地级市中心点（城市顺序的唯一真源）
│   ├── city_geom_cache/           各省 `_full.json` 原始市界（33 个，4.1MB）
│   └── world_countries_raw.geojson Natural Earth 110m 国家
├── build_data.py              原始数据 → 基础数据
├── simplify.py                Douglas-Peucker 抽稀 + 精度压缩（省级 / 世界）
├── build_cities.py            ★ 市级区块：自适应抽稀 + 小岛过滤 → dist/cities.json
├── build_preview.py           ★ 同步内核与数据到小程序 + 打包单文件预览
├── shots.js                   Playwright 自动截图验证（8 个场景）
├── shots/                     截图产物（README 引用）
├── test_kernel.js             Node 冒烟测试（无需浏览器，含区块命中逐市校验）
├── package.json               仅声明 devDependency playwright
└── LICENSE                     MIT
```

改完 `src/map-core.js` 后跑一次 `python3 build_preview.py`，小程序端和预览页会一起更新。

---

## 3. 双端复用是怎么做到的

内核 `map-core.js` 守住三条硬约束，所以同一份代码能在两端跑：

1. **不碰任何宿主环境** —— 没有 `window` / `document` / `wx`，只接收一个标准 `CanvasRenderingContext2D`。
2. **不用 Path2D** —— 小程序的 canvas 2d 不支持 `Path2D`、`ctx.isPointInPath`。
   命中检测用自研 **射线法**（`pointInRings`），两端行为完全一致。
3. **不依赖网络** —— 数据由容器注入。主数据随包加载，市级区块几何按需注入。

容器的差异只有三处（各写约 20 行），加上「市级区块几何从哪来」这第四处：

| 环节 | H5 | 微信小程序 |
|---|---|---|
| 取 ctx | `canvas.getContext('2d')` | `createSelectorQuery().fields({node:true})` → `node.getContext('2d')` |
| 高清屏 | `window.devicePixelRatio` | `wx.getWindowInfo().pixelRatio` |
| 触摸 | `pointerup` + `getBoundingClientRect()` | `bindtouchend`，`e.changedTouches[0].x / y` |
| 持久化 | `localStorage` | `wx.setStorageSync` |
| **市级区块数据** | 下钻时 `fetch('../dist/cities.json')` | 下钻时 `require('../../utils/cities.js')` |

---

## 4. 数据方案

### 4.1 四层数据，各管一段

| 层级 | 内容 | 来源 | 体积 | 加载时机 |
|---|---|---|---|---|
| 世界 | 175 个国家轮廓 + 中文名 | Natural Earth 110m | 约 110KB | 随包 |
| 中国 | 35 个省级行政区轮廓 | 阿里云 DataV GeoAtlas | 约 230KB | 随包 |
| 省内锚点 | 34 省 × 475 个下级中心点 | DataV `_full.json` 的 `properties.center` | 34KB | 随包 |
| 省内区块 | 33 省 × 475 个下级行政区轮廓 | 同上 `_full.json` 的 `geometry` | 858KB | **下钻时才加载** |

市级几何占了总量的 2/3，所以它不进首屏：H5 下钻时 `fetch`，小程序下钻时 `require`。
拿不到也不影响使用 —— 内核发现没有区块几何会自动退回圆点画法（台湾省就是这条路，见 4.3）。


### 4.2 抽稀：25k 点 → 12k 点

用 Douglas-Peucker（`simplify.py`）：

| 图层 | 阈值 | 点数变化 | 说明 |
|---|---|---|---|
| 中国省级 | `eps=0.02°`（≈2.2km） | 25240 → 12555（50%） | 省级放大约 1px 误差，肉眼无感 |
| 世界国家 | `eps=0.05°` | 9993 → 9220 | 110m 本身就是粗数据 |

再叠加坐标精度压缩（中国 3 位小数、世界 2 位小数）：

```
原始        ≈ 1400 KB
抽稀+压缩   =   381 KB  ← dist/mapdata.json
gzip 后     =   118 KB
```

**小程序包体提醒**：主包上限 2MB。主数据 380KB + 市级区块 858KB ≈ 1.2MB 可以放主包，
但若项目还有别的资源，建议把「省内区块」或「世界国家数据」拆到 **分包**（见 4.4）。

### 4.3 市级区块：抽稀阈值必须跟着省走

把 475 个地级市做成区块，原始 16.4 万点。这里有两个反直觉的点。

**① 全局统一的 eps 会毁掉小区域。** 省级用 `eps=0.02°`（约 2.2km）够用，但澳门只有 0.1° 宽：
同一个 eps 下去，澳门会被压成一个点。反过来，若为照顾澳门把 eps 调到极小，新疆的轮廓数据量会爆炸。

解法是让 eps 跟省包围盒宽度成正比：

```
eps = 0.002 × 省宽(度)
```

这样「进省后占满屏幕」时的屏幕误差恒为 `0.002 × 366px ≈ 0.73px`，与省的绝对大小无关。
澳门拿到 `eps=0.0002`，新疆拿到 `eps=0.03`（触顶），各自都不变形也不浪费。

**② 亚像素小岛可以直接丢，但要留最大的那块。** 沿海市常带几十个亚像素小岛（舟山、深圳、防城港尤其多）。
按「最大的岛永远保留、其余小于 1px 的丢掉」处理后省了 16KB —— 收益不大，但顺手做了，而且避免了
小岛被抽稀成 2 个点后变成一条线。

**③ 城市顺序不能变。** 点亮记录用的是 `省adcode:序号` 作 key，所以 `dist/cities.json` 里每个省的城市顺序
必须与 `dist/mapdata.json` 的 `cities[adcode].cities` 逐项一致。`build_cities.py` 以
`china_city_points.json` 的顺序为准、按 adcode 去匹配几何；没有几何的项存 `null` 而**不是过滤掉**，
否则后面的市会集体错位、用户已点亮的市全部串号。

抽稀结果：

```
原始              163,720 点
自适应抽稀后       49,581 点  →  dist/cities.json = 858 KB
gzip 后                        =  224 KB
```

覆盖 33 个省 / 475 个下级行政区，逐市点选自测 **125/125 全部命中自己，零错指零漏判**
（见 `test_kernel.js` 的 `checkProvince`）。

### 4.4 市级数据为什么放在主包而不是分包

小程序官方给了两条路，实测都不完全省心：

| 方案 | 下载量 | 风险 |
|---|---|---|
| 主包直放（本仓库采用） | 随主包下载 858KB | 无。构建一定成功 |
| **分包 + 分包异步化** | 下钻时才下载 | 需基础库 **2.11.2+**；且分包必须带至少一个页面，纯数据分包不好组织 |

本仓库选了主包直放：**页面里是「下钻时才 require」**，所以 858KB 的下载代价提前付了，
但 JS 解析与执行仍然是懒的（`module.exports = {...}` 只有被 require 时才展开）。
用构建稳定性换那点下载量不划算 —— 何况这个仓库没法在真机上验证分包配置。

要改成分包，三处：
1. `build_preview.py` 把 `MP_UTILS` 换成 `miniprogram/packageCities/utils`
2. `app.json` 加 `subPackages: [{ "root": "packageCities", "pages": [...] }]`（需一个占位页）
3. `map.js` 的 `loadCityGeom` 改成 `require.async('../../packageCities/utils/cities.js').then(...)`

### 4.5 合规处理（必须做，已在数据里落地）

- 中国版图用 **DataV GeoAtlas**，天然含 **台湾省（710000）** 与 **南海诸岛（100000_JD）**。
- 世界地图数据把 Natural Earth 里独立的 "Taiwan" 要素 **合并进中国**，并改名为「中国」。
  验证方式：在世界视图点击台北坐标，返回的是「中国」而不是单独的国家。
- **南海诸岛附图**：中国视图右下角固定绘制一个带边框的小图（`drawSouthSeaInset`）。
  主图按纬度 ≥ 17.5° 裁掉岛礁点，避免主图被南海拉长变形 —— 这也是横版中国标准地图的画法。
- **台湾省的下级没有区块**：DataV 对 `710000_full.json` 返回 404，所以台湾省下钻后退回圆点画法
  （18 个市县中心点是手工补的）。这不是缺陷而是设计：内核发现没有区块几何就自动降级。
- 上线前建议再走一道：以 **自然资源部标准地图服务** 的审图号版本 / 天地图数据为准，
  世界图层尤其注意 藏南、阿克赛钦 等区域的表达。本仓库的世界数据仅用于交互原型。

---

## 5. 交互设计

```
        ┌─ 中国地图（默认）──────────────┐      ┌─ 世界地图 ─────┐
        │ 35 省级轮廓，点击选中          │      │ 175 国家轮廓    │
        │  · 再点同一个省 → 下钻         │ ←→   │ 点击选中        │
        │  · 底部面板 → 点亮 / 进入省内  │      │ 底部面板 → 点亮 │
        └───────────────────────────────┘      └────────────────┘
                     ↓ 下钻
        ┌─ 省内视图 ─────────────────────┐
        │ 省轮廓 + 地级市「区块」        │
        │ 点击区块 → 立即点亮/取消       │
        │ 面包屑 / 返回 → 回到中国       │
        └───────────────────────────────┘
```

- **区块的填充与描边分两遍走**：先铺满所有区块的填充，再统一描白缝。
  反过来（逐个填充+描边）会让后画的块把相邻块的白缝盖掉，边界糊成一片。
- **已点亮 = 整块主色**（`#D85A30`）+ 深色描边；未点亮 = 浅灰块 + 白缝。比圆点的辨识度高得多，
  尤其像重庆 38 个区县这种密集场景。
- **点选容差**：省内优先用射线法精确命中区块（区块铺满全省，点哪块算哪块）。
  只有**没有区块几何的市**（如台湾省）才退化到"距中心点 22px 内也算命中"。
- **label 防遮挡**：省级视图只画 34 个名字；省内视图城市数 ≤ 18 时才画全部标签，
  超过（如重庆 38 个区县）只画已点亮的，避免糊成一团。多岛市的标签用官方 `center`，
  而不是市界质心 —— 否则舟山这类城市的名字会落到海里。
- **悬停**：H5 端支持鼠标悬停高亮描边，小程序端自动跳过。

---

## 6. 怎么跑

### H5
```bash
cd map-demo
python3 -m http.server 8080
# 打开 http://localhost:8080/web/index.html
```
> 直接双击 `web/index.html` 走 `file://` 时，`fetch('../dist/mapdata.json')` 会被浏览器拦截 ——
> 这种情况请打开 `preview.html`（数据已内联，无网络请求）。

### 微信小程序
1. 微信开发者工具 → 导入项目 → 选择 `map-demo/miniprogram` 目录
2. 编译即可（AppID 可用测试号）
3. 真机预览：`canvas type="2d"` 在真机上的 `pixelRatio` 与开发者工具不同，内核已按运行时取值

### 内核自测（无浏览器，零依赖）
```bash
npm test          # 等价于 node test_kernel.js
```
会校验：北京/广州/乌鲁木齐/台北/香港/拉萨 的省份命中、世界视图 5 国命中、
**广东/重庆/香港/澳门/新疆/上海 六个省 125 个市逐市中心回点全部命中自己**、
区块键序与 `visibleCities()` 逐项对齐、圆点降级路径、三种视图的绘制不抛异常、数据导入导出往返。

### 自动截图回归（需要浏览器）
```bash
npm install
npx playwright install chromium
npm run shots        # 跑 8 个场景，写入 shots/，有 console error 则退出码非 0
npm run test:http    # 另起一个内存 http 服务，验真实部署路径（fetch cities.json）
npm run test:live    # 打开线上 Pages，下钻广东并点亮几个市（需联网）
```
> 若本机已有 Chrome 内核，可用 `CHROME_PATH=/path/to/chrome npm run shots` 跳过下载。
>
> `shots.js` 跑的是 `preview.html`（数据已内联），**覆盖不到 `fetch` 那条路径**。
> `test_http.js` 专门补这一段：起本地服务 → 下钻广东省 → 断言 `cities.json` 只请求一次、
> 区块数 = 城市数、点区块能点亮、再下钻另一个省走内存缓存不重复请求。

### 只改了地图数据
```bash
python3 build_data.py       # 原始 → 基础数据（省级 + 城市锚点）
python3 simplify.py         # 省级 / 世界抽稀 → dist/mapdata.json
python3 build_cities.py     # 市级区块自适应抽稀 → dist/cities.json
python3 build_preview.py    # 同步到小程序 + 重新打包 preview.html
```
首次跑 `build_cities.py` 会从 DataV 抓 33 个省的 `_full.json` 到 `data/city_geom_cache/`
（已入库，所以离线也能重建）。

---

## 7. 踩过的坑（都已修，复刻时注意）

| 现象 | 原因 | 解法 |
|---|---|---|
| 点第一下弹出面板后，**再点同一个省点不中** | 面板用 `display:none → flex` 切换，出现时把地图顶上去，第二次点击落点已经错位 | 面板与进度卡都改成 **绝对定位贴底**，用 `visibility` 切换，永不参与文档流 |
| 北京/天津/上海、福建/台湾 标签糊成一团，台湾省标签被挤掉 | 朴素做法"撞上就跳过"，谁先画谁赢 | 每个标签按 `[居中, 上, 下, 左, 右, 四个斜角…]` 依次试位；已点亮/面积大的优先占位 |
| 南海诸岛附图压住了台湾省和福建省 | 附图覆盖在画布右下角，但地图是**纵向居中**的，右下角正好是陆地 | 内核加 `insetHeight()`，主图只在「画布高度 − 附图高度」的区域里做 fit |
| 竖屏里地图只有 200px 高，下面一大片留白 | 世界 2.6:1、中国 1.7:1，手机屏是 0.5:1，等比缩放必然宽度受限 | 内核暴露 `preferredHeight(w)`，容器按地图比例决定画布高度；世界视图允许 ≤1.75 倍纵向拉伸换取可点面积 |
| 纽约这种海岸线上的点在世界视图点不中 | Natural Earth 110m 海岸线本来就是粗的，再抽稀还会外移 | 精确命中失败后，退化到"距要素中心 10px 内也算"（对小国、港澳尤其有用） |
| **澳门被抽成一个点、新疆数据量爆炸** | 全局固定 `eps` 对 0.1° 宽的澳门和 20° 宽的新疆意味着完全不同的屏幕误差 | 改成 `eps = 0.002 × 省宽`，屏幕误差恒为约 0.73px |
| **用户已点亮的市集体串号** | 市级几何按 adcode 匹配后若把「缺几何」的项过滤掉，数组长度就与 `cities[adcode].cities` 不一致，`省adcode:序号` 的 key 全部错位 | 缺几何的项存 `null` 占位，**绝不 filter**；并在 `test_kernel.js` 里逐项断言名字一致 |
| 市级区块边界糊成一片 | 逐个「填充+描边」时，后画的块会盖掉相邻块的白缝 | 填充与描边**分两遍**：先铺满所有填充，再统一描白缝 |
| 舟山这类多岛市的标签落到海里 | 用市界质心定位标签 | 用 DataV 的 `properties.center`（官方中心点），而不是几何质心 |

## 8. 性能

- **绘制**：每帧投影 12k 点（中国）/ 9k 点（世界），实测在 60fps 无压力。
  填充与描边分两遍、投影结果缓存复用，避免重复计算。
- **命中**：射线法遍历所有环。中国视图约 12k 边，单次点击 < 3ms。
  省内视图命中区块更快 —— 每次只对一个省（几百到 2000 条边）做检测，且命中即返回。
- **首帧**：数据解析 380KB JSON 约 30–60ms，可接受；若嫌慢可换成 TopoJSON 量化。
  市级区块的 858KB 不进首帧（下钻时才加载），首次下钻会有一次加载，之后走内存缓存。

---

## 9. 可以继续加的东西

| 需求 | 做法 |
|---|---|
| 城市搜索定位 | 用 475 个市名 + 33 省区块建一张索引，前端模糊匹配后 `project()` 定位 |
| 点亮进度排行榜 | 点亮数据上行到后端，按省/市聚合 |
| 分享海报 | H5 用 `canvas.toDataURL()`；小程序用 `wx.canvasToTempFilePath` + 分享封面 |
| 区县下钻 | DataV 再下一级 `{adcode}_full.json`；内核不用动（`setCityGeom` 是通用的），换数据即可 |
| 导入高德/微信运动足迹 | 解析轨迹点，用已有的 `projectFeatureHit` 做 point-in-polygon 反查省/市 |
| 世界城市级点亮 | 加 Natural Earth 10m populated places（7342 个点，**自带中文名**、公有领域）作为世界视图的点层。真正的难点是**内核目前没有缩放** —— 世界全图视图下 3.4 万点间距只有 0.02px，手指点不准 |
| 省内区块的平滑过渡 | 下钻时从上一帧的省轮廓做一个短过渡动画（内核已有投影收口，做插值不难） |

---

## 10. 一句话总结

**一个 26KB 的纯 JS 内核 + 两份按需加载的抽稀 GeoJSON，就能同时喂饱 H5 和小程序。**
难点不在渲染，在数据：抽稀阈值要跟着行政区的绝对大小走、点亮 key 依赖数组下标所以顺序不能变、
以及中国版图那几个必须画对的地方。

---

## 11. 数据来源与许可

| 数据 | 来源 | 许可 |
|---|---|---|
| 中国省级轮廓、地级市中心点与市界 | [阿里云 DataV GeoAtlas](https://geo.datav.aliyun.com/areas_v3/bound/) | 阿里云数据源，免费用于可视化 |
| 世界各国轮廓 | [Natural Earth](https://www.naturalearthdata.com/) 110m Admin 0 | Public Domain |
| 中文国名 | Natural Earth `NAME_ZH` 字段 | Public Domain |

代码以 [MIT](./LICENSE) 许可发布。

> **免责声明**：本仓库的世界图层为交互原型用途，中国版图数据未经**自然资源部标准地图**审核。
> 若要上线面向公众的产品，请以[标准地图服务](http://bzdt.ch.mnr.gov.cn/)或天地图数据自行校验并替换，
> 世界图层尤其注意藏南、阿克赛钦等区域的表达。详见 [4.5 合规处理](#45-合规处理必须做已在数据里落地)。

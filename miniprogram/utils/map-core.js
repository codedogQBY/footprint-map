/**
 * map-core.js —— 地图点亮内核
 *
 * 设计目标：一份代码同时跑在「浏览器 H5」和「微信小程序 canvas 2d」。
 * 因此本文件遵守两条硬约束：
 *   1. 不访问任何 DOM / window / wx / document，只接受一个标准 CanvasRenderingContext2D。
 *   2. 不使用 Path2D、OffscreenCanvas 等小程序不支持的能力；命中检测用自研射线法。
 *
 * 投影：等距圆柱（经纬度线性映射）。
 *   - 世界视图允许 x/y 独立缩放（手机竖屏可铺满）
 *   - 中国 / 省份视图强制等比缩放（保证形状不变形）
 *
 * 合规：中国版图数据来自阿里云 DataV GeoAtlas（含台湾省、南海诸岛），
 *      世界数据已将台湾并入中国，并单独绘制南海诸岛附图。
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MapCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var T = {
    land: '#E9E7E1',
    landStroke: '#D5D2C9',
    visited: '#D85A30',
    visitedStroke: '#993C1D',
    visitedFillSoft: '#F5C4B3',
    hoverStroke: '#5F5E5A',
    label: '#6B6961',
    labelVisited: '#993C1D',
    labelHalo: 'rgba(255,255,255,0.85)',
    dot: '#C6C3BA',
    dotVisited: '#D85A30',
    dotStroke: '#FFFFFF',
    // 市级「区块」：未点亮是浅灰块，点亮是一整块主色，块间用白缝切开
    block: '#E4E1D9',
    blockStroke: '#FFFFFF',
    blockOn: '#D85A30',
    blockOnStroke: '#993C1D',
    insetBg: 'rgba(255,255,255,0.78)',
    insetStroke: '#D5D2C9',
    ocean: 'transparent'
  };

  // 中国主图：低于此纬度的岛礁不进主图，改由右下角「南海诸岛」附图呈现
  var MAIN_LAT_MIN = 17.5;
  var SOUTH_SEA_BBOX = [105.5, 3.0, 123.5, 24.0];
  var DEFAULT_CHINA_BBOX = [73.4, 17.4, 135.2, 53.8];
  var WORLD_BBOX = [-180, -56, 180, 84];

  function eachRing(geom, fn) {
    var i, j, k, poly;
    if (geom.type === 'Polygon') {
      for (i = 0; i < geom.coordinates.length; i++) fn(geom.coordinates[i]);
    } else {
      for (j = 0; j < geom.coordinates.length; j++) {
        poly = geom.coordinates[j];
        for (k = 0; k < poly.length; k++) fn(poly[k]);
      }
    }
  }

  /** 把 GeoJSON 几何预处理成内核内部结构，避免每帧做类型判断 */
  function prepareFeature(key, name, geom, center) {
    var rings = [];
    eachRing(geom, function (ring) {
      if (ring.length < 2) return;
      var maxLat = -1e9, minLng = 1e9, maxLng = -1e9, minLat = 1e9;
      for (var i = 0; i < ring.length; i++) {
        var p = ring[i];
        if (p[1] > maxLat) maxLat = p[1];
        if (p[1] < minLat) minLat = p[1];
        if (p[0] < minLng) minLng = p[0];
        if (p[0] > maxLng) maxLng = p[0];
      }
      rings.push({ pts: ring, maxLat: maxLat, minLat: minLat, minLng: minLng, maxLng: maxLng });
    });
    // 没有官方中心点时，用包围盒中心兜底（用于小面积区域的点选容差）
    if (!center && rings.length) {
      var a = 1e9, b = 1e9, c = -1e9, d = -1e9;
      for (var m = 0; m < rings.length; m++) {
        var rr = rings[m];
        if (rr.minLng < a) a = rr.minLng;
        if (rr.minLat < b) b = rr.minLat;
        if (rr.maxLng > c) c = rr.maxLng;
        if (rr.maxLat > d) d = rr.maxLat;
      }
      center = [(a + c) / 2, (b + d) / 2];
    }
    return { key: key, name: name, center: center, rings: rings };
  }

  function featureBBox(f, latMin) {
    var minLng = 1e9, minLat = 1e9, maxLng = -1e9, maxLat = -1e9;
    for (var i = 0; i < f.rings.length; i++) {
      var r = f.rings[i];
      if (latMin != null && r.maxLat < latMin) continue;
      if (r.minLng < minLng) minLng = r.minLng;
      if (r.minLat < minLat) minLat = r.minLat;
      if (r.maxLng > maxLng) maxLng = r.maxLng;
      if (r.maxLat > maxLat) maxLat = r.maxLat;
    }
    return [minLng, minLat, maxLng, maxLat];
  }

  function unionBBox(list, latMin) {
    var b = [1e9, 1e9, -1e9, -1e9];
    for (var i = 0; i < list.length; i++) {
      var o = featureBBox(list[i], latMin);
      if (o[0] > o[2]) continue;
      if (o[0] < b[0]) b[0] = o[0];
      if (o[1] < b[1]) b[1] = o[1];
      if (o[2] > b[2]) b[2] = o[2];
      if (o[3] > b[3]) b[3] = o[3];
    }
    return b;
  }

  function makeTransform(bbox, w, h, pad, uniform) {
    var bw = Math.max(bbox[2] - bbox[0], 1e-6);
    var bh = Math.max(bbox[3] - bbox[1], 1e-6);
    var aw = Math.max(w - pad * 2, 1);
    var ah = Math.max(h - pad * 2, 1);
    var sx = aw / bw, sy = ah / bh;
    if (uniform) {
      var s = Math.min(sx, sy);
      sx = sy = s;
    }
    var cx = (bbox[0] + bbox[2]) / 2;
    var cy = (bbox[1] + bbox[3]) / 2;
    return { sx: sx, sy: sy, ox: cx - (w / 2) / sx, oy: cy + (h / 2) / sy };
  }

  /** 射线法：跨所有环统计交点数的奇偶性（等价 even-odd 填充规则） */
  function pointInRings(rings, x, y) {
    var inside = false;
    for (var i = 0; i < rings.length; i++) {
      var pts = rings[i].pts, n = pts.length;
      for (var a = 0, b = n - 1; a < n; b = a++) {
        var xi = pts[a][0], yi = pts[a][1];
        var xj = pts[b][0], yj = pts[b][1];
        if ((yi > y) !== (yj > y)) {
          var xHit = (xj - xi) * (y - yi) / (yj - yi) + xi;
          if (x < xHit) inside = !inside;
        }
      }
    }
    return inside;
  }

  function MapKernel(data, options) {
    options = options || {};
    this.theme = Object.assign({}, T, options.theme || {});
    this.data = data;
    this.mode = 'china';          // 'china' | 'world'
    this.focus = null;            // 下钻中的省 adcode
    this.selected = null;         // { kind, key } 当前选中
    this.hover = null;
    this.width = 0;
    this.height = 0;
    this.visited = { provinces: {}, countries: {}, cities: {} };
    this.onChange = options.onChange || function () {};

    var i;
    this.provinces = [];
    for (i = 0; i < data.provinces.length; i++) {
      var p = data.provinces[i];
      this.provinces.push(prepareFeature(p.ad, p.n, p.g, p.c));
    }
    this.provinceByKey = {};
    for (i = 0; i < this.provinces.length; i++) this.provinceByKey[this.provinces[i].key] = this.provinces[i];

    this.countries = [];
    for (i = 0; i < data.world.length; i++) {
      var c = data.world[i];
      this.countries.push(prepareFeature('c' + i, c.n, c.g, null));
    }
    this.countryByKey = {};
    for (i = 0; i < this.countries.length; i++) this.countryByKey[this.countries[i].key] = this.countries[i];

    this.cities = data.cities || {};
    // 市级区块几何，由容器按需注入（体积大，不跟着主数据一起加载）
    // 结构：{ 省adcode: [preparedFeature | null, ...] }，顺序与 cities[adcode].cities 严格一致，
    // 这样才能继续用「省adcode:序号」作点亮 key，老数据不会错位。
    this.cityGeom = {};
    this.chinaBBox = unionBBox(this.provinces, MAIN_LAT_MIN);
    if (!isFinite(this.chinaBBox[0])) this.chinaBBox = DEFAULT_CHINA_BBOX;
    this.view = null;
  }

  MapKernel.prototype.setSize = function (w, h) {
    this.width = w;
    this.height = h;
    this.recomputeView();
  };

  MapKernel.prototype.currentBBox = function () {
    if (this.mode === 'world') return WORLD_BBOX;
    if (this.focus) {
      var f = this.provinceByKey[this.focus];
      var b = f ? featureBBox(f, null) : this.chinaBBox;
      if (b[0] <= b[2]) return b;
    }
    return this.chinaBBox;
  };

  /**
   * 地图是"扁"的（中国约 1.7:1，世界约 2.6:1），手机屏是"长"的。
   * 容器用这个值决定画布该给多高，把空白挤掉，而不是让地图浮在一片留白里。
   */
  MapKernel.prototype.preferredHeight = function (w) {
    var b = this.currentBBox();
    var aspect = Math.max((b[2] - b[0]) / Math.max(b[3] - b[1], 1e-6), 0.6);
    var h = w / aspect;
    return this.mode === 'world' ? h * 1.7 : h;    // 世界视图容忍纵向拉伸，换取可点面积
  };

  /** 南海诸岛附图需要占掉一条底边，这块高度不能再用来画主图 */
  MapKernel.prototype.hasInset = function () {
    return this.mode === 'china' && !this.focus;
  };

  MapKernel.prototype.recomputeView = function () {
    if (!this.width || !this.height) return;
    var pad = this.mode === 'world' ? 10 : 12;
    if (this.mode === 'world') {
      var t = makeTransform(WORLD_BBOX, this.width, this.height, pad, false);
      // 纵向最多拉伸 60%，再多就明显失真了
      var cap = t.sx * 1.75;
      if (t.sy > cap) {
        t.sy = cap;
        t.oy = (WORLD_BBOX[1] + WORLD_BBOX[3]) / 2 + (this.height / 2) / t.sy;
      }
      this.view = t;
      return;
    }
    var usable = this.height - (this.hasInset() ? this.insetHeight() : 0);
    this.view = makeTransform(this.currentBBox(), this.width, usable, pad, true);
  };

  MapKernel.prototype.insetSize = function () {
    var bw = Math.max(52, Math.min(64, this.width * 0.16));
    return [bw, bw * 1.18];
  };

  MapKernel.prototype.insetHeight = function () {
    return this.insetSize()[1] + 14;
  };

  MapKernel.prototype.project = function (lng, lat) {
    var v = this.view;
    return [(lng - v.ox) * v.sx, (v.oy - lat) * v.sy];
  };

  MapKernel.prototype.setMode = function (mode) {
    this.mode = mode;
    this.focus = null;
    this.selected = null;
    this.recomputeView();
    this.onChange();
  };

  MapKernel.prototype.drill = function (adcode) {
    this.focus = adcode;
    this.selected = null;
    this.recomputeView();
    this.onChange();
  };

  MapKernel.prototype.back = function () {
    this.focus = null;
    this.selected = null;
    this.recomputeView();
    this.onChange();
  };

  MapKernel.prototype.isVisited = function (kind, key) {
    if (kind === 'city') return !!this.visited.cities[key];
    if (kind === 'country') return !!this.visited.countries[key];
    return !!this.visited.provinces[key];
  };

  MapKernel.prototype.setVisited = function (kind, key, on) {
    var bag = kind === 'city' ? this.visited.cities : kind === 'country' ? this.visited.countries : this.visited.provinces;
    if (on) bag[key] = 1; else delete bag[key];
    this.onChange();
  };

  MapKernel.prototype.toggle = function (kind, key) {
    this.setVisited(kind, key, !this.isVisited(kind, key));
  };

  MapKernel.prototype.exportVisited = function () {
    return { provinces: Object.keys(this.visited.provinces), countries: Object.keys(this.visited.countries), cities: Object.keys(this.visited.cities) };
  };

  MapKernel.prototype.importVisited = function (v) {
    if (!v) return;
    var self = this;
    ['provinces', 'countries', 'cities'].forEach(function (k) {
      self.visited[k] = {};
      (v[k] || []).forEach(function (it) { self.visited[k][it] = 1; });
    });
    this.onChange();
  };

  MapKernel.prototype.cityKey = function (adcode, idx) {
    return adcode + ':' + idx;
  };

  MapKernel.prototype.visibleCities = function () {
    var bag = this.cities[this.focus];
    return bag && bag.cities ? bag.cities : [];
  };

  /**
   * 注入某个省的市级区块几何。容器按需加载后调用（H5 用 fetch，小程序用分包 require）。
   *
   * list 顺序必须与 visibleCities() 一致；没有几何的项直接给 null，
   * **不要过滤掉**，否则后面的市全部错位、已点亮的市会集体串号。
   */
  MapKernel.prototype.setCityGeom = function (adcode, list) {
    var out = new Array(list.length);
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      out[i] = (c && c.g) ? prepareFeature(String(c.ad || i), c.n, c.g, c.c || null) : null;
    }
    this.cityGeom[adcode] = out;
    this.onChange();
  };

  /** 当前省的市级区块；没注入过就返回 null（此时退回圆点绘制） */
  MapKernel.prototype.visibleCityGeom = function () {
    return this.cityGeom[this.focus] || null;
  };

  MapKernel.prototype.hasCityGeom = function () {
    var g = this.visibleCityGeom();
    if (!g) return false;
    for (var i = 0; i < g.length; i++) if (g[i]) return true;
    return false;
  };

  /** 小面积区域（港澳、新加坡…）手指很难点中，退化为找最近的中心点 */
  MapKernel.prototype.nearestByCenter = function (list, kind, x, y, maxDist, skip) {
    var best = null, bestD = maxDist;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!f.center || (skip && skip(f))) continue;
      var pt = this.project(f.center[0], f.center[1]);
      var d = Math.hypot(pt[0] - x, pt[1] - y);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best ? { kind: kind, key: best.key, name: best.name } : null;
  };

  /** 命中检测：返回当前视图下的要素。点是逻辑像素坐标 */
  MapKernel.prototype.hitTest = function (x, y) {
    var i, f;
    if (this.mode === 'world') {
      for (i = 0; i < this.countries.length; i++) {
        f = this.countries[i];
        if (this.projectFeatureHit(f, x, y, null)) return { kind: 'country', key: f.key, name: f.name };
      }
      return this.nearestByCenter(this.countries, 'country', x, y, 8, null);
    }
    if (this.focus) {
      var list = this.visibleCities();
      var geom = this.visibleCityGeom();
      var gi, gf;
      // 有区块几何：精确命中（区块铺满全省，点哪块算哪块）
      if (geom) {
        for (gi = 0; gi < geom.length; gi++) {
          gf = geom[gi];
          if (!gf) continue;
          if (this.projectFeatureHit(gf, x, y, null)) {
            return {
              kind: 'city', key: this.cityKey(this.focus, gi), index: gi,
              name: (list[gi] && list[gi].name) || gf.name
            };
          }
        }
      }
      // 兜底只给「没有区块」的市（如台湾省 / 单个缺几何的市），容差按圆点时的 22px
      var best = null, bestD = 1e9;
      for (i = 0; i < list.length; i++) {
        if (geom && geom[i]) continue;
        var pt = this.project(list[i].lng, list[i].lat);
        var d = Math.hypot(pt[0] - x, pt[1] - y);
        if (d < 22 && d < bestD) { bestD = d; best = i; }
      }
      if (best !== null) {
        return { kind: 'city', key: this.cityKey(this.focus, best), name: list[best].name, index: best };
      }
      return null;
    }
    for (i = 0; i < this.provinces.length; i++) {
      f = this.provinces[i];
      if (f.key === '100000_JD') continue;
      if (this.projectFeatureHit(f, x, y, MAIN_LAT_MIN)) return { kind: 'province', key: f.key, name: f.name };
    }
    // 香港 / 澳门这类区域太小，允许落在中心点 10px 内也算命中
    return this.nearestByCenter(this.provinces, 'province', x, y, 10, function (p) {
      return p.key === '100000_JD';
    });
  };

  MapKernel.prototype.projectFeatureHit = function (f, x, y, latMin) {
    var rings = [];
    for (var i = 0; i < f.rings.length; i++) {
      var r = f.rings[i];
      if (latMin != null && r.maxLat < latMin) continue;
      var pts = r.pts, out = new Array(pts.length);
      for (var j = 0; j < pts.length; j++) out[j] = this.project(pts[j][0], pts[j][1]);
      rings.push({ pts: out });
    }
    if (!rings.length) return false;
    return pointInRings(rings, x, y);
  };

  /** 把要素的环投影成屏幕坐标（主图 / 附图共用） */
  MapKernel.prototype.projectRings = function (f, latMin, transform) {
    var t = transform || this.view;
    var out = [];
    for (var i = 0; i < f.rings.length; i++) {
      var r = f.rings[i];
      if (latMin != null && r.maxLat < latMin) continue;
      var pts = r.pts, ring = new Array(pts.length);
      for (var j = 0; j < pts.length; j++) {
        ring[j] = [(pts[j][0] - t.ox) * t.sx, (t.oy - pts[j][1]) * t.sy];
      }
      out.push(ring);
    }
    return out;
  };

  MapKernel.prototype.draw = function (ctx) {
    var w = this.width, h = this.height;
    ctx.clearRect(0, 0, w, h);
    if (this.mode === 'world') this.drawWorld(ctx);
    else if (this.focus) this.drawProvinceDetail(ctx);
    else this.drawChina(ctx);
  };

  MapKernel.prototype.pathRings = function (ctx, rings) {
    ctx.beginPath();
    for (var i = 0; i < rings.length; i++) {
      var ring = rings[i];
      if (ring.length < 2) continue;
      ctx.moveTo(ring[0][0], ring[0][1]);
      for (var j = 1; j < ring.length; j++) ctx.lineTo(ring[j][0], ring[j][1]);
      ctx.closePath();
    }
  };

  MapKernel.prototype.fillFeature = function (ctx, rings, fill, stroke, lineWidth) {
    if (!rings.length) return;
    this.pathRings(ctx, rings);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth || 0.5; ctx.stroke(); }
  };

  // ---------- 中国总览 ----------
  MapKernel.prototype.drawChina = function (ctx) {
    var th = this.theme, i, f;
    var hoverKey = this.hover && this.hover.kind === 'province' ? this.hover.key : null;
    var selKey = this.selected && this.selected.kind === 'province' ? this.selected.key : null;

    // 投影一次缓存，填充与描边复用
    var cache = [];
    for (i = 0; i < this.provinces.length; i++) {
      f = this.provinces[i];
      if (f.key === '100000_JD') continue;         // 南海诸岛只出现在附图
      var rings = this.projectRings(f, MAIN_LAT_MIN);
      if (rings.length) cache.push({ f: f, rings: rings });
    }
    for (i = 0; i < cache.length; i++) {
      var on = this.isVisited('province', cache[i].f.key);
      this.fillFeature(ctx, cache[i].rings, on ? th.visited : th.land, null, 0);
    }
    // 描边单独一遍，避免相邻省界被后画的填充盖住
    for (i = 0; i < cache.length; i++) {
      var key = cache[i].f.key;
      var on2 = this.isVisited('province', key);
      var stroke = on2 ? th.visitedStroke : th.landStroke;
      var lw = 0.5;
      if (key === selKey) { stroke = th.hoverStroke; lw = 1.6; }
      else if (key === hoverKey) { stroke = th.hoverStroke; lw = 1.2; }
      this.pathRings(ctx, cache[i].rings);
      ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();
    }
    this.drawLabels(ctx, this.provinces, 'province', MAIN_LAT_MIN);
    this.drawSouthSeaInset(ctx);
  };

  // ---------- 省内视图：省轮廓 + 市级点 ----------
  MapKernel.prototype.drawProvinceDetail = function (ctx) {
    var th = this.theme, i, gf, k;
    var f = this.provinceByKey[this.focus];
    if (f) {
      var prings = this.projectRings(f, null);
      this.fillFeature(ctx, prings, th.land, th.landStroke, 0.7);
    }

    var list = this.visibleCities();
    var geom = this.visibleCityGeom();
    var labelAll = list.length <= 18;
    var selKey = this.selected && this.selected.kind === 'city' ? this.selected.key : null;
    var hovKey = this.hover && this.hover.kind === 'city' ? this.hover.key : null;

    if (this.hasCityGeom()) {
      // 投影一次缓存，填充与描边分两遍走 —— 否则白缝会被相邻块的填充盖掉
      var cache = [];
      for (i = 0; i < geom.length; i++) {
        gf = geom[i];
        if (!gf) continue;
        var rs = this.projectRings(gf, null);
        if (rs.length) {
          cache.push({ i: i, rings: rs, on: this.isVisited('city', this.cityKey(this.focus, i)) });
        }
      }
      for (i = 0; i < cache.length; i++) {
        this.fillFeature(ctx, cache[i].rings, cache[i].on ? th.blockOn : th.block, null, 0);
      }
      for (i = 0; i < cache.length; i++) {
        var c = cache[i];
        k = this.cityKey(this.focus, c.i);
        var stroke = c.on ? th.blockOnStroke : th.blockStroke;
        var lw = c.on ? 0.9 : 0.7;
        if (k === selKey) { stroke = th.hoverStroke; lw = 1.8; }
        else if (k === hovKey) { stroke = th.hoverStroke; lw = 1.4; }
        this.pathRings(ctx, c.rings);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    }

    // 没有区块几何的市（如台湾省整省、或个别缺数据）→ 保留原来的圆点画法
    for (i = 0; i < list.length; i++) {
      if (geom && geom[i]) continue;
      var pt = this.project(list[i].lng, list[i].lat);
      var on = this.isVisited('city', this.cityKey(this.focus, i));
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], on ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = on ? th.dotVisited : th.dot;
      ctx.fill();
      ctx.strokeStyle = th.dotStroke;
      ctx.lineWidth = on ? 1.6 : 1;
      ctx.stroke();
    }

    var items = [];
    for (i = 0; i < list.length; i++) {
      var on2 = this.isVisited('city', this.cityKey(this.focus, i));
      if (!labelAll && !on2) continue;
      // 有区块就用官方中心点（多岛市如舟山，用市界质心会落到海里）
      var cen = (geom && geom[i] && geom[i].center) || [list[i].lng, list[i].lat];
      var pt2 = this.project(cen[0], cen[1]);
      items.push({
        text: list[i].name, x: pt2[0], y: pt2[1],
        color: on2 ? th.labelVisited : th.label,
        weight: on2 ? 1e6 : 0          // 已点亮的优先占位
      });
    }
    this.placeLabels(ctx, items, '11px -apple-system, "PingFang SC", sans-serif');
  };

  // ---------- 世界视图 ----------
  MapKernel.prototype.drawWorld = function (ctx) {
    var th = this.theme, i;
    var hoverKey = this.hover && this.hover.kind === 'country' ? this.hover.key : null;
    var selKey = this.selected && this.selected.kind === 'country' ? this.selected.key : null;
    var cache = [];
    for (i = 0; i < this.countries.length; i++) {
      var rings = this.projectRings(this.countries[i], null);
      if (rings.length) cache.push({ f: this.countries[i], rings: rings });
    }
    for (i = 0; i < cache.length; i++) {
      this.fillFeature(ctx, cache[i].rings, this.isVisited('country', cache[i].f.key) ? th.visited : th.land, null, 0);
    }
    for (i = 0; i < cache.length; i++) {
      var on = this.isVisited('country', cache[i].f.key);
      var stroke = on ? th.visitedStroke : th.landStroke;
      var lw = 0.4;
      if (cache[i].f.key === selKey) { stroke = th.hoverStroke; lw = 1.4; }
      else if (cache[i].f.key === hoverKey) { stroke = th.hoverStroke; lw = 1; }
      this.pathRings(ctx, cache[i].rings);
      ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();
    }
    var pt = this.project(116.4, 39.9);
    if (this.isVisited('country', 'c0') && pt[0] > 0 && pt[0] < this.width) {
      ctx.font = '10px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = th.labelHalo;
      ctx.strokeText('中国', pt[0], pt[1]);
      ctx.fillStyle = th.labelVisited;
      ctx.fillText('中国', pt[0], pt[1]);
    }
  };

  /**
   * 统一入口：按"屏幕上谁大谁优先"排序，逐个试放，压到已有标签就跳过。
   * 这样北京/天津/上海那一堆挤在一起的短名会自然退让，不会糊成一团。
   */
  MapKernel.prototype.placeLabels = function (ctx, items, font) {
    var th = this.theme;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var placed = [];
    var self = this;

    items.sort(function (a, b) { return b.weight - a.weight; });

    // 一个位置放不下就换个方位再试，别一撞就放弃（台湾这类贴边的省全靠这一步）
    var OFFSETS = [[0, 0], [0, -14], [0, 14], [18, 0], [-18, 0],
                   [18, -13], [18, 13], [-18, -13], [-18, 13], [0, -26], [0, 26]];
    var h = 12;

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var w = ctx.measureText(it.text).width;
      var slot = null;

      for (var o = 0; o < OFFSETS.length; o++) {
        var cx = it.x + OFFSETS[o][0], cy = it.y + OFFSETS[o][1];
        if (cx - w / 2 < 6 || cx + w / 2 > self.width - 6) continue;
        if (cy - h / 2 < 6 || cy + h / 2 > self.height - 6) continue;
        var x0 = cx - w / 2 - 1, x1 = cx + w / 2 + 1;
        var y0 = cy - h / 2 - 1, y1 = cy + h / 2 + 1;
        var clash = false;
        for (var j = 0; j < placed.length; j++) {
          var p = placed[j];
          if (x0 < p[2] && x1 > p[0] && y0 < p[3] && y1 > p[1]) { clash = true; break; }
        }
        if (!clash) { slot = [cx, cy, x0, y0, x1, y1]; break; }
      }
      if (!slot) continue;

      placed.push([slot[2], slot[3], slot[4], slot[5]]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = th.labelHalo;
      ctx.strokeText(it.text, slot[0], slot[1]);
      ctx.fillStyle = it.color;
      ctx.fillText(it.text, slot[0], slot[1]);
    }
  };

  MapKernel.prototype.drawLabels = function (ctx, features, kind, latMin) {
    var th = this.theme;
    var skip = { '香港特别行政区': 1, '澳门特别行政区': 1, '南海诸岛': 1 };
    var items = [];
    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      if (!f.center || skip[f.name]) continue;
      var b = featureBBox(f, latMin);
      if (b[0] > b[2]) continue;
      var pt = this.project(f.center[0], f.center[1]);
      // 尺寸太小的区域（如港澳）不参与标签竞争
      if ((b[2] - b[0]) * this.view.sx < 16) continue;
      items.push({
        text: f.name, x: pt[0], y: pt[1],
        color: this.isVisited(kind, f.key) ? th.labelVisited : th.label,
        weight: (b[2] - b[0]) * (b[3] - b[1])
      });
    }
    this.placeLabels(ctx, items, '11px -apple-system, "PingFang SC", sans-serif');
  };

  // ---------- 南海诸岛附图（合规要求：必须出现）----------
  MapKernel.prototype.drawSouthSeaInset = function (ctx) {
    var th = this.theme;
    var size = this.insetSize();
    var bw = size[0], bh = size[1];
    var bx = this.width - bw - 8;
    var by = this.height - bh - 6;
    var t = makeTransform(SOUTH_SEA_BBOX, bw, bh, 0, true);

    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.fillStyle = th.insetBg;
    ctx.fill();
    ctx.strokeStyle = th.insetStroke;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.clip();
    ctx.translate(bx, by);
    var i, f, rings, j, k, ring, pts;
    for (i = 0; i < this.provinces.length; i++) {
      f = this.provinces[i];
      rings = [];
      for (j = 0; j < f.rings.length; j++) {
        pts = f.rings[j].pts;
        ring = new Array(pts.length);
        for (k = 0; k < pts.length; k++) ring[k] = [(pts[k][0] - t.ox) * t.sx, (t.oy - pts[k][1]) * t.sy];
        rings.push(ring);
      }
      if (!rings.length) continue;
      var on = this.isVisited('province', f.key);
      this.fillFeature(ctx, rings, on ? th.visited : th.land, on ? th.visitedStroke : th.landStroke, 0.4);
    }
    ctx.restore();
    ctx.font = '10px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = th.labelHalo;
    ctx.strokeText('南海诸岛', bx + 4, by + 3);
    ctx.fillStyle = th.label;
    ctx.fillText('南海诸岛', bx + 4, by + 3);
  };

  return { create: function (data, opts) { return new MapKernel(data, opts); }, THEME: T };
});

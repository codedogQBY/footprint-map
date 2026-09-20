// pages/map/map.js —— 微信小程序容器
// 与 H5 容器共用同一份内核 utils/map-core.js，页面层只负责：
// 拿 canvas 2d 节点、换算 dpr、转发触摸事件、持久化点亮数据。
const MapCore = require('../../utils/map-core.js');
const MAP_DATA = require('../../utils/mapdata.js');

const STORE_KEY = 'footprint_visited_v1';
const DEMO_SEED = {
  provinces: ['440000', '330000', '310000', '110000', '510000', '350000'],
  countries: [],
  cities: ['440000:0', '440000:1', '330000:0', '710000:0', '810000:0']
};

Page({
  data: {
    mode: 'china',
    focusName: '',
    statText: '',
    sheetShow: false,
    sheetName: '',
    sheetSub: '',
    sheetVisited: false,
    canDrill: false
  },

  onLoad() {
    this.kernel = null;
    this.hitCache = null;
  },

  onReady() {
    this.initCanvas();
  },

  initCanvas() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#map').fields({ node: true, size: true }).exec((res) => {
      const info = res && res[0];
      if (!info || !info.node) return;
      const canvas = info.node;
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;

      canvas.width = Math.round(info.width * dpr);
      canvas.height = Math.round(info.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      this.canvas = canvas;
      this.ctx = ctx;
      this.cssWidth = info.width;
      this.cssHeight = info.height;

      const kernel = MapCore.create(MAP_DATA, {
        onChange: () => { /* 由页面主动触发重绘 */ }
      });
      kernel.setSize(info.width, info.height);
      kernel.importVisited(wx.getStorageSync(STORE_KEY) || DEMO_SEED);
      this.kernel = kernel;
      this.render();
    });
  },

  render() {
    const k = this.kernel;
    if (!k) return;
    k.draw(this.ctx);

    const v = k.exportVisited();
    let statText;
    if (k.mode === 'world') {
      statText = `已点亮 ${v.countries.length} 个国家 / 地区`;
    } else if (k.focus) {
      statText = `本省已点亮 ${this.countFocusCities()} 个市`;
    } else {
      statText = `已点亮 ${v.provinces.length} 个省级行政区`;
    }
    const f = k.focus ? k.provinceByKey[k.focus] : null;
    this.setData({
      mode: k.mode,
      focusName: f ? f.name : '',
      statText
    });
    this.syncSheet();
  },

  countFocusCities() {
    const k = this.kernel;
    const list = k.visibleCities();
    let n = 0;
    for (let i = 0; i < list.length; i++) if (k.isVisited('city', k.cityKey(k.focus, i))) n++;
    return n;
  },

  persist() {
    wx.setStorageSync(STORE_KEY, this.kernel.exportVisited());
  },

  // ---------- 交互 ----------
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!this.kernel) return;
    this.kernel.setMode(mode);
    this.hitCache = null;
    this.hideSheet();
    this.render();
  },

  backToChina() {
    this.kernel.back();
    this.hideSheet();
    this.render();
  },

  onTouchEnd(e) {
    const k = this.kernel;
    if (!k) return;
    const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
    if (!t) return;
    const x = t.x;
    const y = t.y;
    const hit = k.hitTest(x, y);

    if (k.focus) {
      // 省内：点中的市直接切换点亮状态
      if (hit && hit.kind === 'city') {
        k.toggle('city', hit.key);
        this.persist();
        this.render();
        wx.vibrateShort && wx.vibrateShort({ type: 'light' });
      }
      return;
    }

    if (!hit) { this.hideSheet(); this.render(); return; }

    // 中国 / 世界总览：第一次点选中并弹面板，点同一个再进省内
    if (this.hitCache && this.hitCache.key === hit.key &&
        hit.kind === 'province' && this.hasChildren(hit.key)) {
      k.drill(hit.key);
      this.hideSheet();
      this.render();
      return;
    }
    this.hitCache = hit;
    k.selected = { kind: hit.kind, key: hit.key };
    this.render();
  },

  hasChildren(ad) {
    const bag = this.kernel.cities[ad];
    return !!(bag && bag.cities && bag.cities.length);
  },

  syncSheet() {
    const k = this.kernel;
    const sel = k.selected;
    if (!sel) {
      if (this.data.sheetShow) this.setData({ sheetShow: false });
      return;
    }
    let name;
    if (sel.kind === 'city') return;      // 省内点击即时生效，不弹面板
    if (sel.kind === 'country') name = k.countryByKey[sel.key].name;
    else name = k.provinceByKey[sel.key].name;
    const visited = k.isVisited(sel.kind, sel.key);
    this.setData({
      sheetShow: true,
      sheetName: name,
      sheetSub: (sel.kind === 'country' ? '国家 / 地区' : '省级行政区') + (visited ? ' · 已点亮' : ''),
      sheetVisited: visited,
      canDrill: sel.kind === 'province' && this.hasChildren(sel.key)
    });
  },

  hideSheet() {
    if (this.kernel) this.kernel.selected = null;
    this.hitCache = null;
    this.setData({ sheetShow: false });
  },

  onSheetToggle() {
    const sel = this.kernel && this.kernel.selected;
    if (!sel) return;
    this.kernel.toggle(sel.kind, sel.key);
    this.persist();
    this.render();
  },

  onSheetDrill() {
    const sel = this.kernel && this.kernel.selected;
    if (!sel || sel.kind !== 'province') return;
    this.kernel.drill(sel.key);
    this.hideSheet();
    this.render();
  },

  onReset() {
    wx.showModal({
      title: '清空点亮记录',
      content: '将删除本机保存的全部足迹数据，确认吗？',
      success: (r) => {
        if (!r.confirm) return;
        this.kernel.importVisited({ provinces: [], countries: [], cities: [] });
        this.persist();
        this.hideSheet();
        this.render();
      }
    });
  },

  onShareAppMessage() {
    return { title: '我的足迹点亮地图', path: '/pages/map/map' };
  }
});

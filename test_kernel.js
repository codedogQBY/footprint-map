const MapCore = require('./src/map-core.js');
const data = require('./dist/mapdata.json');

const k = MapCore.create(data, {});
k.setSize(375, 620);

function pad(s, n) { return (s + ' '.repeat(n)).slice(0, n); }

function hitAt(lng, lat, label) {
  const p = k.project(lng, lat);
  const h = k.hitTest(p[0], p[1]);
  console.log(pad(label, 16) + ' -> ' + (h ? h.kind + ' ' + h.name : 'MISS') +
    '   (' + p[0].toFixed(0) + ',' + p[1].toFixed(0) + ')');
  return h;
}

console.log('== 中国视图命中 ==');
hitAt(116.405, 39.905, '北京');
hitAt(113.28, 23.125, '广州');
hitAt(87.62, 43.79, '乌鲁木齐');
hitAt(121.51, 25.04, '台北');
hitAt(114.17, 22.32, '香港');
hitAt(91.13, 29.66, '拉萨');
hitAt(0, 0, '几内亚湾miss');

console.log('');
console.log('== 切换世界视图 ==');
k.setMode('world');
hitAt(116.405, 39.905, '中国');
hitAt(-3.7, 40.4, '西班牙');
hitAt(139.7, 35.7, '日本');
hitAt(-60, -20, '巴西');
hitAt(121.51, 25.04, '台湾归中国');

console.log('');
console.log('== 下钻广东省 ==');
k.setMode('china');
k.drill('440000');
console.log('本省城市数:', k.visibleCities().length);
const first = k.visibleCities()[0];
const p = k.project(first.lng, first.lat);
const h = k.hitTest(p[0], p[1]);
console.log('命中首市:', h && h.name, '| key =', h && h.key);
k.toggle('city', h.key);
console.log('点亮后 isVisited:', k.isVisited('city', h.key));

console.log('');
console.log('== 画布调用冒烟 ==');
const mock = new Proxy({}, {
  get(t, prop) {
    if (prop === 'canvas') return {};
    if (prop === 'measureText') return () => ({ width: 30 });
    return () => {};
  },
  set() { return true; }
});
function smoke(mode, focus, tag) {
  k.setMode(mode);
  if (focus) k.drill(focus);
  let ok = true;
  try { k.draw(mock); } catch (e) { ok = false; console.log(tag + ' 抛错: ' + e.message); }
  console.log(pad(tag, 10) + ' draw -> ' + (ok ? 'OK' : 'FAIL'));
}
smoke('china', null, '中国总览');
smoke('world', null, '世界总览');
smoke('china', '110000', '北京下钻');
smoke('china', '460000', '海南下钻');
smoke('china', '100000_JD', '南海诸岛下钻');

console.log('');
console.log('== 导出 / 导入 ==');
k.importVisited({ provinces: ['440000'], countries: ['c0'], cities: [] });
console.log(JSON.stringify(k.exportVisited()));
console.log('中国省数:', k.provinces.length, '| 国家数:', k.countries.length,
  '| 城市分组:', Object.keys(k.cities).length);
console.log('中国主图 bbox:', k.chinaBBox.map(v => v.toFixed(1)).join(', '));

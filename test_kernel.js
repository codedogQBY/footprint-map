const MapCore = require('./src/map-core.js');
const data = require('./dist/mapdata.json');
const cities = require('./dist/cities.json');

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
console.log('== 无区块几何时 → 退回圆点 ==');
k.setMode('china');
k.drill('440000');
console.log('hasCityGeom:', k.hasCityGeom(), '(应为 false)');
let p0 = k.project(k.visibleCities()[0].lng, k.visibleCities()[0].lat);
let h0 = k.hitTest(p0[0], p0[1]);
console.log('圆点命中首市:', h0 && h0.name, '| index =', h0 && h0.index);

console.log('');
console.log('== 注入区块几何后：逐市用中心点回点，看是否仍命中自己 ==');
function checkProvince(ad, label) {
  if (!cities[ad]) { console.log(pad(label, 14) + ' 无区块数据，跳过'); return; }
  k.setMode('china');
  k.drill(ad);
  k.setCityGeom(ad, cities[ad]);
  const list = k.visibleCities();
  let hitSelf = 0, miss = 0, wrong = 0;
  const wrongNames = [];
  for (let i = 0; i < list.length; i++) {
    const cen = (cities[ad][i] && cities[ad][i].c) || [list[i].lng, list[i].lat];
    const pt = k.project(cen[0], cen[1]);
    const h = k.hitTest(pt[0], pt[1]);
    if (!h) { miss++; continue; }
    if (h.index === i && h.name === list[i].name) hitSelf++;
    else { wrong++; if (wrongNames.length < 3) wrongNames.push(list[i].name + '→' + h.name + '#' + h.index); }
  }
  console.log(pad(label, 14) + ' 市数 ' + pad(String(list.length), 3) +
    ' 命中自己 ' + pad(String(hitSelf), 3) +
    ' 错指 ' + pad(String(wrong), 3) + ' 未命中 ' + pad(String(miss), 3) +
    (wrongNames.length ? '  | ' + wrongNames.join(', ') : ''));
}
checkProvince('440000', '广东');
checkProvince('500000', '重庆');
checkProvince('810000', '香港');
checkProvince('820000', '澳门');
checkProvince('650000', '新疆');
checkProvince('310000', '上海');
checkProvince('710000', '台湾(无)');

console.log('');
console.log('== 区块键序必须与 visibleCities 对齐 ==');
const ad = '440000';
k.setMode('china'); k.drill(ad); k.setCityGeom(ad, cities[ad]);
const g = k.visibleCityGeom();
const lst = k.visibleCities();
let align = true;
for (let i = 0; i < lst.length; i++) {
  if (!g[i]) { align = false; console.log('  第 ' + i + ' 项无几何: ' + lst[i].name); }
  else if (g[i].name !== lst[i].name) { align = false; console.log('  第 ' + i + ' 项名字不一致: ' + lst[i].name + ' vs ' + g[i].name); }
}
console.log('长度', g.length, '=== 城市数', lst.length, '| 逐项对齐:', align);

console.log('');
console.log('== 点亮后按 adcode 维度统计 ==');
k.toggle('city', k.cityKey('440000', 0));
k.toggle('city', k.cityKey('440000', 5));
console.log('已点亮:', k.exportVisited().cities.join(', '));

console.log('');
console.log('== 画布调用冒烟 ==');
let blockFills = 0;
const mock = new Proxy({}, {
  get(t, prop) {
    if (prop === 'canvas') return {};
    if (prop === 'measureText') return () => ({ width: 30 });
    return () => {};
  },
  set(t, prop, v) {
    if (prop === 'fillStyle' && (v === '#D85A30' || v === '#E4E1D9')) blockFills++;
    return true;
  }
});
function smoke(mode, focus, tag, geom) {
  k.setMode(mode);
  if (focus) {
    k.drill(focus);
    if (geom !== false && cities[focus]) k.setCityGeom(focus, cities[focus]);
  }
  const before = blockFills;
  let ok = true;
  try { k.draw(mock); } catch (e) { ok = false; console.log(tag + ' 抛错: ' + e.message); }
  console.log(pad(tag, 14) + ' draw -> ' + pad(ok ? 'OK' : 'FAIL', 6) +
    ' 区块填充调用 ' + (blockFills - before));
}
smoke('china', null, '中国总览');
smoke('world', null, '世界总览');
smoke('china', '440000', '广东区块');
smoke('china', '500000', '重庆区块');
smoke('china', '110000', '北京(圆点)');
smoke('china', '460000', '海南区块');
smoke('china', '710000', '台湾(圆点)');
smoke('china', '100000_JD', '南海诸岛');

console.log('');
console.log('== 导出 / 导入 ==');
k.importVisited({ provinces: ['440000'], countries: ['c0'], cities: [] });
console.log(JSON.stringify(k.exportVisited()));
console.log('中国省数:', k.provinces.length, '| 国家数:', k.countries.length,
  '| 城市分组:', Object.keys(k.cities).length);
console.log('中国主图 bbox:', k.chinaBBox.map(v => v.toFixed(1)).join(', '));

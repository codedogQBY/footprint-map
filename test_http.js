// 验证真实 H5 部署路径：web/index.html + fetch('../dist/cities.json')
// 截图回归跑的是 preview.html（数据已内联），这条路径必须单独验。
const { chromium } = require('/Users/bealqiu/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EXEC = '/Users/bealqiu/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port + '/web/index.html';
  console.log('服务:', url);

  const b = await chromium.launch({ executablePath: EXEC });
  const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 })).newPage();
  const errs = [], reqs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('response', r => { if (r.url().includes('dist/')) reqs.push(r.status() + ' ' + r.url().split('/').pop()); });

  await page.goto(url);
  await page.waitForFunction(() => !!window.__kernel, null, { timeout: 20000 });

  // 等后台预取（1.2s 后触发）把 cities.json 拉下来
  await page.waitForTimeout(2600);
  console.log('数据请求:', reqs.length ? reqs.join(' | ') : '(无)');

  // 下钻广东省：双击同一个省
  const pt = await page.evaluate(() => {
    const k = window.__kernel, p = k.project(113.28, 23.125);
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: p[0] + r.left, y: p[1] + r.top };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const k = window.__kernel;
    return {
      focus: k.focus,
      hasGeom: k.hasCityGeom(),
      geomLen: (k.visibleCityGeom() || []).length,
      cityLen: k.visibleCities().length,
      text: document.querySelector('.tip').textContent.trim()
    };
  });
  console.log('下钻后: focus=' + info.focus + ' hasCityGeom=' + info.hasGeom +
    ' 区块数=' + info.geomLen + ' 城市数=' + info.cityLen);

  // 点一个区块内部（佛山），确认命中并点亮
  const f = await page.evaluate(() => {
    const k = window.__kernel, list = k.visibleCities();
    let idx = -1;
    for (let i = 0; i < list.length; i++) if (list[i].name === '佛山市') idx = i;
    const g = k.visibleCityGeom()[idx];
    const p = k.project(g.center[0], g.center[1]);
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: p[0] + r.left, y: p[1] + r.top, idx: idx };
  });
  await page.mouse.click(f.x, f.y);
  await page.waitForTimeout(300);
  const state = await page.evaluate((idx) => {
    const k = window.__kernel;
    return k.isVisited('city', k.cityKey(k.focus, idx));
  }, f.idx);
  console.log('点佛山区块 -> 已点亮:', state);
  await page.screenshot({ path: path.join(ROOT, 'shots/9-http-guangdong-blocks.png') });

  // 未下钻过的省也点一下（验证按需加载 + 内存缓存）
  await page.click('#crumbBack');            // 走容器自己的返回，保持布局与选中态一致
  await page.waitForTimeout(400);
  const p2 = await page.evaluate(() => {
    const k = window.__kernel, p = k.project(104.07, 30.67);
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: p[0] + r.left, y: p[1] + r.top };
  });
  await page.mouse.click(p2.x, p2.y);
  await page.waitForTimeout(300);
  await page.mouse.click(p2.x, p2.y);
  await page.waitForTimeout(700);
  const info2 = await page.evaluate(() => {
    const k = window.__kernel;
    return { focus: k.focus, hasGeom: k.hasCityGeom(), n: (k.visibleCityGeom() || []).length };
  });
  console.log('再下钻四川: focus=' + info2.focus + ' hasCityGeom=' + info2.hasGeom + ' 区块数=' + info2.n + '（应走内存缓存，无新请求）');
  console.log('数据请求总计:', reqs.join(' | '));
  console.log('console errors =', errs.length ? errs : 'none');

  await b.close();
  server.close();
  if (errs.length) process.exit(1);
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });

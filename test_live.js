// 线上验证：打开 GitHub Pages 上的演示，下钻广东省，确认渲染的是区块而非圆点
const { chromium } = require('/Users/bealqiu/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const EXEC = '/Users/bealqiu/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const LIVE = 'https://codedogqby.github.io/footprint-map/';

(async () => {
  const b = await chromium.launch({ executablePath: EXEC });
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));

  await page.goto(LIVE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__kernel, null, { timeout: 25000 });
  await page.waitForTimeout(900);
  console.log('落地 URL :', page.url());

  // 下钻广东省
  const at = async (lng, lat) => page.evaluate(([a, c]) => {
    const k = window.__kernel, p = k.project(a, c);
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: p[0] + r.left, y: p[1] + r.top };
  }, [lng, lat]);

  let p = await at(113.28, 23.125);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(350);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(700);

  const s = await page.evaluate(() => {
    const k = window.__kernel;
    const g = k.visibleCityGeom() || [];
    return { focus: k.focus, geom: g.length, cities: k.visibleCities().length,
             text: document.querySelector('#stats').textContent.trim() };
  });
  console.log('下钻结果 : focus=' + s.focus + ' 区块数=' + s.geom + ' 城市数=' + s.cities + ' | ' + s.text);

  // 点亮三个市，取一个好看的状态截图
  for (const [lng, lat] of [[113.05, 22.93], [113.28, 23.125], [110.35, 21.27]]) {
    const q = await at(lng, lat);
    await page.mouse.click(q.x, q.y);
    await page.waitForTimeout(220);
  }
  await page.waitForTimeout(500);
  console.log('点亮后   :', (await page.textContent('#stats')).trim());
  await page.screenshot({ path: __dirname + '/shots/10-live-blocks.png' });

  console.log('console errors =', errs.length ? errs : 'none');
  await b.close();
  if (errs.length) process.exit(1);
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });

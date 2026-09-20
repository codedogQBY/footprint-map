/**
 * 用无头浏览器跑 8 个场景并自动截图，同时把关键状态打印出来做断言。
 *
 * 依赖：npm install && npx playwright install chromium
 * 也可用 CHROME_PATH 指定已有的 Chrome 内核，跳过下载。
 */
const path = require('path');
const fs = require('fs');

function loadPlaywright() {
  const candidates = [
    'playwright-core',
    'playwright',
    process.env.PW_CORE,                       // 自定义路径
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* 继续找 */ }
  }
  console.error('找不到 playwright，请先执行：npm install && npx playwright install chromium');
  process.exit(1);
}

const { chromium } = loadPlaywright();
const FILE = 'file://' + path.resolve(__dirname, 'preview.html');
const OUT = path.resolve(__dirname, 'shots');
const EXEC = process.env.CHROME_PATH || undefined;   // 留空则用 playwright 自带的 chromium

async function pt(page, lng, lat) {
  return page.evaluate(([a, b]) => {
    const k = window.__kernel;
    const p = k.project(a, b);
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: p[0] + r.left, y: p[1] + r.top };
  }, [lng, lat]);
}

(async () => {
  if (!fs.existsSync(path.resolve(__dirname, 'preview.html'))) {
    console.error('缺少 preview.html，请先执行：python3 build_preview.py');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: EXEC });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));

  await page.goto(FILE);
  await page.waitForFunction(() => !!window.__kernel, null, { timeout: 15000 });
  await page.waitForTimeout(500);

  await page.screenshot({ path: OUT + '/1-china.png' });
  console.log('1 中国默认视图 OK');

  // 点击广东省 -> 弹出面板
  let p = await pt(page, 113.28, 23.125);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(350);
  await page.screenshot({ path: OUT + '/2-select-guangdong.png' });
  const sheet1 = await page.textContent('#sheetName');
  console.log('2 选中省份 =', sheet1);

  // 再点一次 -> 下钻
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(350);
  await page.screenshot({ path: OUT + '/3-guangdong-cities.png' });
  const stat3 = await page.textContent('#stats');
  console.log('3 下钻后统计 =', stat3.trim());

  // 点亮两个城市
  for (const [lng, lat] of [[110.35, 21.27], [113.05, 22.93], [116.68, 23.35]]) {
    const q = await pt(page, lng, lat);
    await page.mouse.click(q.x, q.y);
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/4-guangdong-lit.png' });
  console.log('4 点亮三市后统计 =', (await page.textContent('#stats')).trim());

  // 返回中国
  await page.click('#crumbBack');
  await page.waitForTimeout(350);
  await page.screenshot({ path: OUT + '/5-back-china.png' });
  console.log('5 返回中国统计 =', (await page.textContent('#stats')).trim());

  // 切世界
  await page.click('#seg button[data-mode="world"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/6-world.png' });
  const pj = await pt(page, 139.7, 35.7);
  await page.mouse.click(pj.x, pj.y);
  await page.waitForTimeout(350);
  await page.screenshot({ path: OUT + '/7-world-select-japan.png' });
  console.log('6-7 世界视图，选中 =', await page.textContent('#sheetName'));

  // 台湾应归属中国
  await page.mouse.click(10, 10);
  const tw = await pt(page, 121.0, 23.7);
  await page.mouse.click(tw.x, tw.y);
  await page.waitForTimeout(300);
  console.log('8 点台北返回 =', await page.textContent('#sheetName'));
  await page.screenshot({ path: OUT + '/8-world-taiwan.png' });

  const visited = await page.evaluate(() => window.__kernel.exportVisited());
  console.log('visited =', JSON.stringify(visited));
  console.log('console errors =', errs.length ? errs : 'none');

  await browser.close();
  if (errs.length) process.exit(1);
})().catch(e => { console.error('FAILED', e); process.exit(1); });

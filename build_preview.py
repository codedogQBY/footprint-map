#!/usr/bin/env python3
"""构建脚本：
1. 把 src/map-core.js 同步到 miniprogram/utils/（小程序端不能引用仓库外文件）
2. 用 dist/mapdata.json 生成 miniprogram/utils/mapdata.js（小程序不能直接 require .json）
3. 用 dist/cities.json 生成 miniprogram/utils/cities.js
   —— 放主包而不是分包：分包异步化需要基础库 2.11.2+ 且分包必须带页面，
      没条件在真机上验证，就不拿构建稳定性去换那点下载量。
      页面里是「下钻时才 require」，所以执行开销仍然是懒的。见 README 第 4.4 节。
4. 把内核 + 数据内联进 preview.html（file:// 双击即开，绕开 fetch 同源限制）

真实 H5 部署用 web/index.html，数据与内核保持分离。
"""
import json
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.join(HERE, 'src/map-core.js')
DATA = os.path.join(HERE, 'dist/mapdata.json')
CITY = os.path.join(HERE, 'dist/cities.json')
MP_UTILS = os.path.join(HERE, 'miniprogram/utils')

# ---- 1) 同步内核到小程序 ----
os.makedirs(MP_UTILS, exist_ok=True)
shutil.copyfile(CORE, os.path.join(MP_UTILS, 'map-core.js'))

# ---- 2) 主数据转成 CommonJS 模块 ----
raw = open(DATA, encoding='utf-8').read()
with open(os.path.join(MP_UTILS, 'mapdata.js'), 'w', encoding='utf-8') as fh:
    fh.write('module.exports = ' + raw + ';\n')

# ---- 3) 市级区块数据 ----
city_raw = open(CITY, encoding='utf-8').read()
with open(os.path.join(MP_UTILS, 'cities.js'), 'w', encoding='utf-8') as fh:
    fh.write('module.exports = ' + city_raw + ';\n')


# ---- 4) 打包单文件预览 ----
html = open(os.path.join(HERE, 'web/index.html'), encoding='utf-8').read()
core = open(CORE, encoding='utf-8').read()

html = html.replace('<script src="../src/map-core.js"></script>',
                    '<script>\n' + core + '\n</script>')

MAPDATA_EXPR = ("Promise.resolve(window.__MAP_DATA__ || "
                "fetch('../dist/mapdata.json').then(function (r) { return r.json(); }))")
CITY_EXPR = ("Promise.resolve(window.__CITY_DATA__ || "
             "fetch('../dist/cities.json').then(function (r) { return r.json(); }))")
assert MAPDATA_EXPR in html, '未找到 mapdata 加载表达式，web/index.html 改过了？'
assert CITY_EXPR in html, '未找到 cities 加载表达式，web/index.html 改过了？'
html = html.replace(MAPDATA_EXPR, "Promise.resolve(window.__MAP_DATA__)")
html = html.replace(CITY_EXPR, "Promise.resolve(window.__CITY_DATA__)")
html = html.replace('<script>\n(function () {\n  var STORE_KEY',
                    '<script>window.__MAP_DATA__ = ' + raw + ';\n'
                    'window.__CITY_DATA__ = ' + city_raw + ';</script>\n'
                    '<script>\n(function () {\n  var STORE_KEY')

out = os.path.join(HERE, 'preview.html')
open(out, 'w', encoding='utf-8').write(html)

print('内核  -> miniprogram/utils/map-core.js            (%6.0f KB)' % (os.path.getsize(CORE) / 1024))
print('数据  -> miniprogram/utils/mapdata.js             (%6.0f KB)' % (os.path.getsize(DATA) / 1024))
print('区块  -> miniprogram/utils/cities.js              (%6.0f KB)' % (os.path.getsize(CITY) / 1024))
print('预览  -> preview.html                             (%6.0f KB)' % (os.path.getsize(out) / 1024))
print('无网络请求：', 'fetch(' not in html)

mp_total = (os.path.getsize(os.path.join(MP_UTILS, 'map-core.js')) +
            os.path.getsize(os.path.join(MP_UTILS, 'mapdata.js')) +
            os.path.getsize(os.path.join(MP_UTILS, 'cities.js')))
print('小程序 utils/ 合计 %.0f KB（主包上限 2048 KB）' % (mp_total / 1024))
# 清掉旧版放进分包的文件，别留垃圾
stale = os.path.join(HERE, 'miniprogram/packageCities')
if os.path.isdir(stale):
    shutil.rmtree(stale)
    print('已清理旧的 miniprogram/packageCities/')



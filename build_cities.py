"""把中国地级市做成「区块」（多边形）数据。

产物：dist/cities.json
  { "440000": [ {ad, n, c, g}, ... ], ... }

两条硬约束：
1. **城市顺序必须与 dist/mapdata.json 的 cities[adcode].cities 完全一致** ——
   点亮记录用的是 `省adcode:序号` 作 key，顺序一变用户已点亮的市就集体错位。
   所以这里以 china_city_points.json 的顺序为准，按 adcode 去匹配几何。
2. **抽稀阈值按省自适应** —— 澳门只有 0.1° 宽、新疆有 20° 宽，
   用同一个 eps 要么澳门被压成一个点，要么新疆大得没边。
   取 eps = 0.002 × 省包围盒宽度，正好让「进省后占满屏幕时」的误差恒为约 0.7px。
"""
import json, os, math, gzip

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'data/city_geom_cache')
PREC = 3                 # 经纬度保留 3 位小数，约 100m
K = 0.002                # 相对抽稀系数
EPS_MIN, EPS_MAX = 0.0002, 0.03


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    def d(p, a, b):
        (x, y), (x1, y1), (x2, y2) = p, a, b
        dx, dy = x2 - x1, y2 - y1
        if dx == 0 and dy == 0:
            return math.hypot(x - x1, y - y1)
        t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        return math.hypot(x - x1 - t * dx, y - y1 - t * dy)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        mx, mi = -1, -1
        for k in range(i + 1, j):
            dd = d(pts[k], pts[i], pts[j])
            if dd > mx:
                mx, mi = dd, k
        if mx > eps:
            keep[mi] = True
            stack.append((i, mi)); stack.append((mi, j))
    return [p for p, k in zip(pts, keep) if k]


def simp_ring(ring, eps):
    closed = ring[0] == ring[-1]
    pts = ring[:-1] if closed else ring
    if len(pts) < 3:
        return ring
    out = rdp(pts, eps)
    if len(out) < 3:                       # 抽过头了，退回原环
        return ring
    return out + [out[0]] if closed else out


def simp_geom(g, eps):
    """逐「岛」处理：最大的那块一定保留，其余小块小于 1px 的直接丢掉。

    沿海市常带几十个亚像素小岛（舟山、深圳、防城港尤其多），
    在省视图下它们连一个像素都占不到，留着只是白占体积。
    最大的那块永远保留，避免整市被误删。
    """
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']

    def outer_size(poly):
        ring = poly[0]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return max(max(xs) - min(xs), max(ys) - min(ys))

    sizes = [outer_size(p) for p in polys]
    biggest = sizes.index(max(sizes)) if sizes else -1

    kept = []
    for i, poly in enumerate(polys):
        if i != biggest and sizes[i] < eps:
            continue
        kept.append([simp_ring(r, eps) for r in poly])
    if not kept:
        kept = [[simp_ring(r, eps) for r in polys[0]]]

    def rnd(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], PREC), round(c[1], PREC)]
        return [rnd(x) for x in c]
    if len(kept) == 1:
        return {'type': 'Polygon', 'coordinates': rnd(kept[0])}
    return {'type': 'MultiPolygon', 'coordinates': rnd(kept)}



def count(g):
    c = g['coordinates']
    if g['type'] == 'Polygon':
        return sum(len(r) for r in c)
    return sum(len(r) for p in c for r in p)


def bbox_of(feats):
    xs, ys = [], []

    def walk(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0]); ys.append(c[1])
        else:
            for x in c:
                walk(x)
    for f in feats:
        walk(f['geometry']['coordinates'])
    return min(xs), min(ys), max(xs), max(ys)


# ---------- 载入 ----------
points = json.load(open(os.path.join(HERE, 'data/china_city_points.json')))
provinces = json.load(open(os.path.join(HERE, 'data/china_provinces.json')))
prov_bbox = {}
for f in provinces['features']:
    p = f['properties']
    b = bbox_of([f])
    prov_bbox[str(p['adcode'])] = b

out = {}
stat = []
tot_pts = 0
fallback = []          # 没有几何数据、只能退回圆点的区域

for ad, bag in points.items():
    if ad.endswith('_JD'):
        continue
    cf = os.path.join(CACHE, ad + '.json')
    if not os.path.exists(cf):
        fallback.append((ad, bag.get('name')))
        continue
    raw = json.load(open(cf))

    by_ad = {}
    for f in raw['features']:
        by_ad[str(f['properties']['adcode'])] = f

    # 抽稀阈值：跟着省的宽度走
    b = prov_bbox.get(ad)
    width = (b[2] - b[0]) if b else 5.0
    eps = max(EPS_MIN, min(EPS_MAX, K * width))

    feats = []
    before = after = 0
    miss = 0
    for c in bag['cities']:
        cad = str(c.get('adcode') or '')
        f = by_ad.get(cad)
        if not f:
            feats.append({'ad': cad, 'n': c['name'], 'c': [c['lng'], c['lat']], 'g': None})
            miss += 1
            continue
        before += count(f['geometry'])
        g = simp_geom(f['geometry'], eps)
        after += count(g)
        cen = f['properties'].get('center') or [c['lng'], c['lat']]
        feats.append({'ad': cad, 'n': c['name'], 'c': cen, 'g': g})
    tot_pts += after
    out[ad] = feats
    stat.append((ad, bag.get('name'), len(feats), eps, before, after, miss))

# ---------- 落盘 ----------
os.makedirs(os.path.join(HERE, 'dist'), exist_ok=True)
s = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
open(os.path.join(HERE, 'dist/cities.json'), 'w').write(s)
gz = gzip.compress(s.encode())
open(os.path.join(HERE, 'dist/cities.json.gz'), 'wb').write(gz)

print('%-8s %-12s %4s %8s %8s %8s %5s' % ('省', '名称', '市数', 'eps', '原始点', '抽稀后', '缺几何'))
for ad, nm, n, eps, b, a, miss in sorted(stat, key=lambda x: -x[5])[:12]:
    print('%-8s %-12s %4d %8.5f %8d %8d %5d' % (ad, (nm or '')[:10], n, eps, b, a, miss))
print('... 共 %d 个省' % len(stat))
print()
print('几何点数合计: %d' % tot_pts)
print('dist/cities.json: %.0f KB | gzip: %.0f KB' % (len(s.encode()) / 1024, len(gz) / 1024))
if fallback:
    print('无几何数据（运行时退回圆点）: %s' % ', '.join('%s %s' % (a, n) for a, n in fallback))
miss_total = sum(x[6] for x in stat)
print('单市缺几何: %d 个' % miss_total)

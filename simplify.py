import json, os, math

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
    out = rdp(pts, eps)
    return out + [out[0]] if closed else out

def simp_poly(poly, eps):
    return [simp_ring(r, eps) for r in poly]

def simp_geom(g, eps, r):
    if g["type"] == "Polygon":
        co = simp_poly(g["coordinates"], eps)
    else:
        co = [simp_poly(p, eps) for p in g["coordinates"]]
    def rnd(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], r), round(c[1], r)]
        return [rnd(x) for x in c]
    return {"type": g["type"], "coordinates": rnd(co)}

def count(g):
    c = g["coordinates"]
    if g["type"] == "Polygon":
        return sum(len(r) for r in c)
    return sum(len(r) for p in c for r in p)

d = json.load(open('data/china_provinces.json'))
tot_in = tot_out = 0
provinces = []
for f in d["features"]:
    p = f["properties"]
    g = simp_geom(f["geometry"], 0.02, 3)
    tot_in += count(f["geometry"]); tot_out += count(g)
    provinces.append({"ad": str(p["adcode"]), "n": p.get("name") or "南海诸岛",
                      "c": p.get("center"), "g": g})
print(f"中国省级: 点数 {tot_in} -> {tot_out} ({tot_out/tot_in:.0%})")

ne = json.load(open('data/world_countries_raw.geojson'))
NAME_FIX = {"United States of America": "美国", "Russia": "俄罗斯", "Dem. Rep. Congo": "刚果（金）",
            "Central African Rep.": "中非", "S. Sudan": "南苏丹", "Bosnia and Herz.": "波黑",
            "Dominican Rep.": "多米尼加", "Eq. Guinea": "赤道几内亚", "Solomon Is.": "所罗门群岛",
            "Falkland Is.": "福克兰群岛", "Fr. S. Antarctic Lands": "法属南部领地",
            "N. Cyprus": "北塞浦路斯", "W. Sahara": "西撒哈拉", "Côte d'Ivoire": "科特迪瓦",
            "Czechia": "捷克", "eSwatini": "斯威士兰", "Somaliland": "索马里兰",
            "Greenland": "格陵兰"}
def merge_geom(a, b):
    ca = a["coordinates"] if a["type"] == "MultiPolygon" else [a["coordinates"]]
    cb = b["coordinates"] if b["type"] == "MultiPolygon" else [b["coordinates"]]
    return {"type": "MultiPolygon", "coordinates": ca + cb}

world = []; china = None; tw = None; wi = wo = 0
for f in ne["features"]:
    nm = f["properties"].get("NAME") or ""
    if nm == "Antarctica": continue
    if nm == "Taiwan": tw = f["geometry"]; continue
    if nm == "China":
        china = f["geometry"]; continue
    g = simp_geom(f["geometry"], 0.05, 2)
    wi += count(f["geometry"]); wo += count(g)
    world.append({"n": NAME_FIX.get(nm) or (f["properties"].get("NAME_ZH") or "").strip() or nm, "g": g})
if tw: china = merge_geom(china, tw)
cg = simp_geom(china, 0.05, 2)
wc = count(china)
world.insert(0, {"n": "中国", "g": cg})
print(f"世界国家: 点数 {wi+wc} -> {wo+count(cg)} ({(wo+count(cg))/(wi+wc):.0%})")

cities = json.load(open('data/china_city_points.json'))
cities["710000"] = {"name": "台湾省", "cities": [
    {"name": "台北市", "lng": 121.509, "lat": 25.044}, {"name": "新北市", "lng": 121.465, "lat": 25.012},
    {"name": "桃园市", "lng": 121.301, "lat": 24.994}, {"name": "台中市", "lng": 120.679, "lat": 24.138},
    {"name": "台南市", "lng": 120.212, "lat": 22.999}, {"name": "高雄市", "lng": 120.312, "lat": 22.620},
    {"name": "基隆市", "lng": 121.746, "lat": 25.131}, {"name": "新竹市", "lng": 120.968, "lat": 24.807},
    {"name": "嘉义市", "lng": 120.452, "lat": 23.481}, {"name": "宜兰县", "lng": 121.753, "lat": 24.702},
    {"name": "花莲县", "lng": 121.606, "lat": 23.991}, {"name": "台东县", "lng": 121.150, "lat": 22.755},
    {"name": "屏东县", "lng": 120.488, "lat": 22.669}, {"name": "苗栗县", "lng": 120.821, "lat": 24.560},
    {"name": "彰化县", "lng": 120.541, "lat": 24.075}, {"name": "南投县", "lng": 120.685, "lat": 23.910},
    {"name": "云林县", "lng": 120.432, "lat": 23.709}, {"name": "澎湖县", "lng": 119.566, "lat": 23.571},
]}

os.makedirs('dist', exist_ok=True)
with open('dist/mapdata.json', 'w') as fh:
    json.dump({"world": world, "provinces": provinces, "cities": cities}, fh,
              ensure_ascii=False, separators=(',', ':'))
kb = os.path.getsize('dist/mapdata.json') / 1024
print(f"dist/mapdata.json = {kb:.0f} KB")

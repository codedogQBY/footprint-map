import json, os

R3 = 3
R2 = 2

def rnd(coords, r):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], r), round(coords[1], r)]
    return [rnd(c, r) for c in coords]

def geom(g, r):
    return {"type": g["type"], "coordinates": rnd(g["coordinates"], r)}

def merge_geom(a, b):
    ta, tb = a["type"], b["type"]
    if ta == "Polygon" and tb == "Polygon":
        return {"type": "MultiPolygon", "coordinates": [a["coordinates"], b["coordinates"]]}
    if ta == "MultiPolygon" and tb == "MultiPolygon":
        return {"type": "MultiPolygon", "coordinates": a["coordinates"] + b["coordinates"]}
    if ta == "MultiPolygon":
        return {"type": "MultiPolygon", "coordinates": a["coordinates"] + [b["coordinates"]]}
    if tb == "MultiPolygon":
        return {"type": "MultiPolygon", "coordinates": [a["coordinates"]] + b["coordinates"]}
    return a

# ---------- 世界国家：合并台湾入中国 ----------
ne = json.load(open('data/tmp.json'))
NAME_FIX = {"United States of America": "美国", "Russia": "俄罗斯", "Dem. Rep. Congo": "刚果（金）",
            "Central African Rep.": "中非", "S. Sudan": "南苏丹", "Bosnia and Herz.": "波黑",
            "Dominican Rep.": "多米尼加", "Eq. Guinea": "赤道几内亚", "Solomon Is.": "所罗门群岛",
            "Falkland Is.": "福克兰群岛", "Fr. S. Antarctic Lands": "法属南部领地",
            "N. Cyprus": "北塞浦路斯", "W. Sahara": "西撒哈拉", "Côte d'Ivoire": "科特迪瓦",
            "Czechia": "捷克", "eSwatini": "斯威士兰", "Somaliland": "索马里兰",
            "Greenland": "格陵兰", "Antarctica": "南极洲"}
SKIP = {"Antarctica"}

world = []
china_geom = None
for f in ne["features"]:
    p = f["properties"]
    n_en = p.get("NAME") or ""
    if n_en == "Taiwan":
        continue
    zh = (p.get("NAME_ZH") or "").strip()
    name = NAME_FIX.get(n_en) or zh or n_en
    if n_en == "China":
        name = "中国"
        china_geom = f["geometry"]
        continue
    if n_en in SKIP:
        continue
    world.append({"name": name, "geom": f["geometry"]})

# 台湾并入中国
for f in ne["features"]:
    if (f["properties"].get("NAME") or "") == "Taiwan":
        china_geom = merge_geom(china_geom, f["geometry"])
        break
world.insert(0, {"name": "中国", "geom": china_geom})

world_slim = [{"n": w["name"], "g": geom(w["geom"], R2)} for w in world]
print("world countries:", len(world_slim))

# ---------- 中国省份 ----------
cp = json.load(open('data/china_provinces.json'))
provinces = []
for f in cp["features"]:
    p = f["properties"]
    ad = str(p["adcode"])
    nm = p.get("name") or "南海诸岛"
    provinces.append({"ad": ad, "n": nm, "c": p.get("center"),
                      "g": geom(f["geometry"], R3)})
print("provinces:", len(provinces))

# ---------- 省级下级城市点 ----------
cities = json.load(open('data/china_city_points.json'))
# 台湾省数据源 404，手工补齐主要城市
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
out = {"world": world_slim, "provinces": provinces, "cities": cities}
with open('dist/mapdata.json', 'w') as fh:
    json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
print("mapdata.json size:", round(os.path.getsize('dist/mapdata.json')/1024), "KB")
print("台湾省 city count:", len(cities['710000']['cities']))

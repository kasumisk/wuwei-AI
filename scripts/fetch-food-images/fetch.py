#!/usr/bin/env python3
"""
食物图片补全脚本 —— 抓取 Wikipedia/Commons 图片后转存到 Cloudflare R2
存储路径:
  缩略图:  foods/thumbnails/<uuid>.jpg   → thumbnail_url
  原图:    foods/originals/<uuid>.jpg    → image_url
公开访问: STORAGE_PUBLIC_URL/<path>

用法:
  python3 fetch.py --dry-run --limit 50    # 预览，不写库/不上传
  python3 fetch.py --limit 200             # 处理前 200 条
  python3 fetch.py                          # 全量（~5800条）
  python3 fetch.py --source usda           # 只处理 USDA 食物
  python3 fetch.py --source cn_food_composition  # 只处理中文食物
"""
import argparse, time, urllib.request, urllib.parse, json, re, sys, uuid

try:
    import psycopg2
except ImportError:
    print("请先安装: pip3 install psycopg2-binary"); sys.exit(1)

try:
    import boto3
    from botocore.config import Config as BotoConfig
except ImportError:
    print("请先安装: pip3 install boto3"); sys.exit(1)

# ── 数据库 ──────────────────────────────────────────────────────────────────
DB_URL = "postgresql://xiehaiji@localhost:5432/wuwei"

# ── R2 配置 ─────────────────────────────────────────────────────────────────
R2_ENDPOINT   = "https://1891f4578fc7ceff1a31f110cfa083a1.r2.cloudflarestorage.com"
R2_ACCESS_KEY = "016d634e38e34ef9cda464910b34a2c0"
R2_SECRET_KEY = "6a2d841f622a53a25a08d4984e0f8f94b5d7c0f2483ad4a363982289fb8bedb7"
R2_BUCKET     = "eatcheck"
R2_PUBLIC_URL = "https://pub-8bacc3fb662640419c67afeb809b6c9c.r2.dev"

# ── 抓取参数 ─────────────────────────────────────────────────────────────────
WIKI_THUMB_W = 600
DELAY        = 0.4
BATCH        = 50
HEADERS      = {"User-Agent": "WuweiFoodBot/1.0 (food nutrition app; contact@wuwei.app)"}

# ── R2 客户端 ────────────────────────────────────────────────────────────────
def make_r2():
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        config=BotoConfig(signature_version="s3v4"),
        region_name="auto",
    )

def upload_url_to_r2(r2, remote_url: str, r2_key: str):
    """下载远程图片字节流，上传到 R2，返回公开 URL"""
    req = urllib.request.Request(remote_url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0]
            data = resp.read()
    except Exception:
        return None
    try:
        r2.put_object(Bucket=R2_BUCKET, Key=r2_key, Body=data, ContentType=content_type)
        return f"{R2_PUBLIC_URL}/{r2_key}"
    except Exception as e:
        print(f"    R2上传失败 {r2_key}: {e}")
        return None

def new_key(folder: str, ext: str = "jpg") -> str:
    """生成 foods/<folder>/<uuid>.<ext>"""
    return f"foods/{folder}/{uuid.uuid4().hex}.{ext}"

def guess_ext(url: str) -> str:
    path = url.split("?")[0].lower()
    for ext in ("png", "gif", "webp", "jpeg", "jpg"):
        if path.endswith(ext):
            return "jpg" if ext == "jpeg" else ext
    return "jpg"

# ── Wikipedia / Commons 查询 ─────────────────────────────────────────────────
def is_chinese(text):
    return bool(re.search(r'[\u4e00-\u9fff]', text))

def _get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.load(r)
    except Exception:
        return None

def wiki_pageimage(title, lang="en"):
    url = (f"https://{lang}.wikipedia.org/w/api.php"
           f"?action=query&titles={urllib.parse.quote(title)}"
           f"&prop=pageimages&format=json&pithumbsize={WIKI_THUMB_W}&piprop=thumbnail|original")
    data = _get(url)
    if not data: return None
    for page in data.get("query", {}).get("pages", {}).values():
        if page.get("pageid", -1) == -1: return None
        thumb = page.get("thumbnail", {})
        orig  = page.get("original", {})
        if thumb:
            return {"thumb": thumb.get("source"),
                    "orig":  orig.get("source") or thumb.get("source")}
    return None

def wiki_opensearch_image(query, lang="en"):
    url = (f"https://{lang}.wikipedia.org/w/api.php"
           f"?action=opensearch&search={urllib.parse.quote(query)}&limit=3&format=json")
    data = _get(url)
    if not data: return None
    for title in (data[1] if len(data) > 1 else [])[:3]:
        r = wiki_pageimage(title, lang)
        if r: return r
        time.sleep(DELAY)
    return None

def commons_search(query):
    url = (f"https://commons.wikimedia.org/w/api.php"
           f"?action=query&list=search&srsearch={urllib.parse.quote(query)}"
           f"&srnamespace=6&format=json&srlimit=1")
    data = _get(url)
    if not data: return None
    results = data.get("query", {}).get("search", [])
    if not results: return None
    enc = urllib.parse.quote(results[0]["title"].replace("File:", ""))
    return {"thumb": f"https://commons.wikimedia.org/wiki/Special:FilePath/{enc}?width={WIKI_THUMB_W}",
            "orig":  f"https://commons.wikimedia.org/wiki/Special:FilePath/{enc}"}

_NOISE = {"raw","cooked","frozen","canned","dried","fresh","whole","sliced","diced","minced",
          "ground","roasted","baked","boiled","fried","steamed","grilled","smoked","salted",
          "unsalted","sweetened","unsweetened","low sodium","low fat","fat free","nonfat",
          "unprepared","prepared","microwaved","heated","drained","enriched","unenriched",
          "regular","dry","instant","without salt","with salt"}

def en_term(name):
    parts = [p.strip() for p in name.split(",")]
    base = parts[0].lower()
    if len(base.split()) <= 1 and len(parts) > 1:
        s = parts[1].strip().lower()
        if s not in _NOISE: base = f"{base} {s}"
    return base

def get_remote_urls(food_name):
    """返回 {"thumb": url, "orig": url} 或 None"""
    if is_chinese(food_name):
        r = wiki_pageimage(food_name, "zh"); time.sleep(DELAY)
        if r: return r
        r = commons_search(food_name); time.sleep(DELAY)
        return r
    else:
        term = en_term(food_name)
        r = wiki_pageimage(term); time.sleep(DELAY)
        if r: return r
        r = wiki_opensearch_image(term); time.sleep(DELAY)
        if r: return r
        r = commons_search(term); time.sleep(DELAY)
        return r

# ── 主流程 ───────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run",  action="store_true", help="不上传不写库，只打印")
    ap.add_argument("--limit",    type=int, default=None)
    ap.add_argument("--source",   type=str, default=None,
                    choices=["usda", "cn_food_composition", "official"])
    ap.add_argument("--db",       type=str, default=DB_URL)
    args = ap.parse_args()

    conn = psycopg2.connect(args.db)
    cur  = conn.cursor()
    conds, params = ["image_url IS NULL"], []
    if args.source:
        conds.append("primary_source = %s"); params.append(args.source)
    sql = "SELECT id, name FROM foods WHERE " + " AND ".join(conds) + " ORDER BY name"
    if args.limit: sql += f" LIMIT {args.limit}"
    cur.execute(sql, params)
    foods = cur.fetchall()
    total = len(foods)
    print(f"待处理: {total} 条 | source={args.source or 'all'} | dry-run={args.dry_run}")

    r2 = None if args.dry_run else make_r2()

    hit = miss = 0
    for idx, (fid, fname) in enumerate(foods, 1):
        remote = get_remote_urls(fname)
        if not remote:
            miss += 1
            print(f"[{idx:5d}/{total}] MISS  {fname[:65]}")
            continue

        if args.dry_run:
            hit += 1
            print(f"[{idx:5d}/{total}] OK(dry) {fname[:50]}")
            print(f"         thumb: {remote['thumb'][:80]}")
            continue

        # 上传缩略图
        ext_thumb = guess_ext(remote["thumb"])
        key_thumb = new_key("thumbnails", ext_thumb)
        pub_thumb = upload_url_to_r2(r2, remote["thumb"], key_thumb)

        # 原图与缩略图相同时复用，否则单独上传
        if remote["orig"] == remote["thumb"] or not remote["orig"]:
            pub_orig = pub_thumb
        else:
            ext_orig = guess_ext(remote["orig"])
            key_orig = new_key("originals", ext_orig)
            pub_orig = upload_url_to_r2(r2, remote["orig"], key_orig)
            if not pub_orig:
                pub_orig = pub_thumb   # 原图失败时回退缩略图

        if pub_thumb:
            hit += 1
            print(f"[{idx:5d}/{total}] OK {fname[:50]}")
            print(f"         {pub_thumb}")
            cur.execute(
                "UPDATE foods SET thumbnail_url=%s, image_url=%s WHERE id=%s",
                (pub_thumb, pub_orig, fid),
            )
        else:
            miss += 1
            print(f"[{idx:5d}/{total}] R2失败 {fname[:60]}")

        if idx % BATCH == 0:
            conn.commit()
            print(f"  -- 已提交 {idx}/{total} --")

    conn.commit()
    conn.close()
    rate = hit / total * 100 if total else 0
    print(f"\n完成: OK {hit} | MISS {miss} | 总 {total} | 命中率 {rate:.1f}%")

if __name__ == "__main__":
    main()

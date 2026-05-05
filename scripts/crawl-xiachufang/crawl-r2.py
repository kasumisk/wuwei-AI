#!/usr/bin/env python3
"""
下厨房食物图片爬虫 + Cloudflare R2 CDN 上传版

流程：
  1. 从 food_translations(locale=zh-CN) 取中文名 → 对应 food_id
  2. 在下厨房搜索该中文名，获取第一张食物图片
  3. Pillow 图片处理：
     - 中心裁方形 → 512×512 原图（JPEG q=82，TinyPNG 级别）
     - 中心裁方形 → 150×150 缩略图（JPEG q=80）
  4. 上传到 Cloudflare R2：
     - foods/originals/<uuid>.jpg
     - foods/thumbnails/<uuid>.jpg
  5. 写入 foods.image_url / thumbnail_url

用法：
  python3 crawl-r2.py --dry-run --limit 10
  python3 crawl-r2.py --limit 100
  python3 crawl-r2.py                           # 全量（image_url IS NULL）
  python3 crawl-r2.py --source usda             # 只处理 USDA 来源的食物
  python3 crawl-r2.py --source cn_food_composition
  python3 crawl-r2.py --delay 2.0 --limit 50   # 调慢爬取间隔

依赖：pip install requests beautifulsoup4 lxml Pillow boto3 psycopg2-binary
"""

import io
import os
import sys
import time
import uuid
import random
import argparse
import logging
import requests
import psycopg2
import boto3
from pathlib import Path
from urllib.parse import quote
from bs4 import BeautifulSoup
from PIL import Image

# ── 日志 ─────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── R2 配置 ───────────────────────────────────────────────────────────────────

R2_ENDPOINT   = "https://1891f4578fc7ceff1a31f110cfa083a1.r2.cloudflarestorage.com"
R2_ACCESS_KEY = "016d634e38e34ef9cda464910b34a2c0"
R2_SECRET_KEY = "6a2d841f622a53a25a08d4984e0f8f94b5d7c0f2483ad4a363982289fb8bedb7"
R2_BUCKET     = "eatcheck"
R2_PUBLIC_URL = "https://pub-8bacc3fb662640419c67afeb809b6c9c.r2.dev"

# ── 爬虫配置 ──────────────────────────────────────────────────────────────────

BASE_URL    = "https://www.xiachufang.com"
IMG_HOST    = "https://i2.chuimg.com"
MAX_RETRIES = 3
TIMEOUT     = 20

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.xiachufang.com/",
}

# ── 图片尺寸 ──────────────────────────────────────────────────────────────────

SIZE_ORIGINAL  = 512   # 原图：窄边最大 512px 后裁方形
SIZE_THUMBNAIL = 150   # 缩略图：150×150
JPEG_QUALITY_ORIG  = 82
JPEG_QUALITY_THUMB = 80

# ── DB ────────────────────────────────────────────────────────────────────────

DB_DSN = "postgresql://xiehaiji@localhost:5432/wuwei"

# ── 工具函数 ──────────────────────────────────────────────────────────────────

def hires_url(url: str) -> str:
    """去掉 imageView 参数得到高清原图 URL"""
    return url.split("?")[0]


def make_r2():
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        config=boto3.session.Config(signature_version="s3v4"),
        region_name="auto",
    )


def safe_get(url: str, stream: bool = False) -> requests.Response | None:
    """带重试的 GET，失败返回 None"""
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT, stream=stream)
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            if attempt == MAX_RETRIES - 1:
                log.warning("请求失败 (%s): %s", url, e)
                return None
            time.sleep(2 ** attempt + random.uniform(0, 1))
    return None


def center_crop_square(img: Image.Image) -> Image.Image:
    """中心裁正方形"""
    w, h = img.size
    s = min(w, h)
    left  = (w - s) // 2
    top   = (h - s) // 2
    return img.crop((left, top, left + s, top + s))


def process_image(raw: bytes) -> tuple[bytes, bytes] | None:
    """
    输入原始图片字节，返回 (orig_bytes, thumb_bytes)：
      - orig：中心裁方 → 512×512 → JPEG q=82
      - thumb：中心裁方 → 150×150 → JPEG q=80
    失败返回 None
    """
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        log.warning("Pillow 无法打开图片: %s", e)
        return None

    sq = center_crop_square(img)

    # 原图
    orig = sq.resize((SIZE_ORIGINAL, SIZE_ORIGINAL), Image.LANCZOS)
    buf_orig = io.BytesIO()
    orig.save(buf_orig, format="JPEG", quality=JPEG_QUALITY_ORIG, optimize=True, progressive=True)

    # 缩略图
    thumb = sq.resize((SIZE_THUMBNAIL, SIZE_THUMBNAIL), Image.LANCZOS)
    buf_thumb = io.BytesIO()
    thumb.save(buf_thumb, format="JPEG", quality=JPEG_QUALITY_THUMB, optimize=True)

    return buf_orig.getvalue(), buf_thumb.getvalue()


def upload_to_r2(r2, data: bytes, r2_key: str, content_type: str = "image/jpeg") -> str:
    """上传字节到 R2，返回公开 URL"""
    r2.put_object(
        Bucket=R2_BUCKET,
        Key=r2_key,
        Body=data,
        ContentType=content_type,
    )
    return f"{R2_PUBLIC_URL}/{r2_key}"


def new_uuid_key(folder: str) -> str:
    return f"foods/{folder}/{uuid.uuid4().hex}.jpg"


# ── 下厨房搜索 ────────────────────────────────────────────────────────────────

def fetch_first_image_url(food_name: str) -> str | None:
    """搜索下厨房，返回第一张高清图 URL；未找到返回 None"""
    url = f"{BASE_URL}/search/?keyword={quote(food_name)}"
    resp = safe_get(url)
    if not resp:
        return None

    soup = BeautifulSoup(resp.text, "lxml")

    # 优先从菜谱卡片中取
    recipe_cards = soup.select(".normal-recipe-list .recipe")
    for card in recipe_cards:
        img = card.select_one("img[data-src]")
        if img:
            ds = img.get("data-src", "")
            if "chuimg.com" in ds:
                return hires_url(ds)

    # 备用：页面中任意来自 chuimg.com 的图片
    for img in soup.select("img[data-src]"):
        ds = img.get("data-src", "")
        if "chuimg.com" in ds:
            return hires_url(ds)

    return None


# ── DB 查询 ───────────────────────────────────────────────────────────────────

def get_foods_to_process(conn, source: str | None, limit: int | None) -> list[tuple[str, str]]:
    """
    返回 [(food_id, zh_name), ...] — image_url 为 NULL 的食物，通过翻译表取中文名
    source 为 None 则不过滤来源
    """
    query = """
        SELECT DISTINCT ON (ft.name)
               f.id::text AS food_id,
               ft.name    AS zh_name
        FROM   food_translations ft
        JOIN   foods f ON f.id = ft.food_id
        WHERE  ft.locale = 'zh-CN'
          AND  f.image_url IS NULL
          AND  ft.name IS NOT NULL
          AND  ft.name <> ''
    """
    params: list = []

    if source:
        query += " AND f.primary_source = %s"
        params.append(source)

    query += " ORDER BY ft.name, f.created_at"

    if limit:
        query += " LIMIT %s"
        params.append(limit)

    with conn.cursor() as cur:
        cur.execute(query, params or None)
        return cur.fetchall()


def update_food_images(conn, food_id: str, image_url: str, thumbnail_url: str, dry_run: bool):
    if dry_run:
        log.info("  [dry-run] UPDATE foods SET image_url=... WHERE id=%s", food_id)
        return
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE foods SET image_url=%s, thumbnail_url=%s, updated_at=NOW() WHERE id=%s::uuid",
            (image_url, thumbnail_url, food_id),
        )


# ── 主流程 ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="下厨房图片爬虫 + R2 上传")
    parser.add_argument("--dry-run", action="store_true", help="不写 DB，不上传 R2")
    parser.add_argument("--limit",  type=int, default=None, help="最多处理 N 条")
    parser.add_argument("--source", type=str, default=None,
                        help="过滤来源：usda | cn_food_composition | official")
    parser.add_argument("--delay",  type=float, default=1.2,
                        help="爬取间隔基础秒数（随机 ±50%，默认 1.2）")
    args = parser.parse_args()

    conn = psycopg2.connect(DB_DSN)
    conn.autocommit = False
    r2 = make_r2() if not args.dry_run else None

    log.info("=== 下厨房 → R2 管道 ===")
    log.info("dry_run=%s  limit=%s  source=%s  delay=%.1fs",
             args.dry_run, args.limit, args.source or "全部", args.delay)

    foods = get_foods_to_process(conn, args.source, args.limit)
    log.info("待处理：%d 条", len(foods))

    success = skip = fail = 0
    batch_size = 10  # 每批提交一次事务（减小以避免中断丢失）

    for idx, (food_id, zh_name) in enumerate(foods, start=1):
        log.info("[%d/%d] %s (id=%s...)", idx, len(foods), zh_name, food_id[:8])

        # 1. 搜索下厨房
        image_url_raw = fetch_first_image_url(zh_name)
        if not image_url_raw:
            log.warning("  未找到图片，跳过")
            skip += 1
            # 礼貌等待
            time.sleep(args.delay * random.uniform(0.5, 1.5))
            continue

        log.info("  URL: %s", image_url_raw)

        # 2. 下载图片
        resp = safe_get(image_url_raw)
        if not resp:
            log.warning("  下载失败，跳过")
            skip += 1
            time.sleep(args.delay * random.uniform(0.5, 1.5))
            continue

        raw_bytes = resp.content
        try:
            _raw_img = Image.open(io.BytesIO(raw_bytes))
            log.info("  原始尺寸: %s  大小: %dKB", _raw_img.size, len(raw_bytes) // 1024)
        except Exception:
            pass
        if len(raw_bytes) < 1000:
            log.warning("  图片过小 (%d bytes)，跳过", len(raw_bytes))
            skip += 1
            continue

        # 3. Pillow 处理：裁方 → 压缩
        result = process_image(raw_bytes)
        if not result:
            log.warning("  图片处理失败，跳过")
            skip += 1
            continue

        orig_bytes, thumb_bytes = result
        log.info("  orig=%dKB  thumb=%dKB",
                 len(orig_bytes) // 1024, len(thumb_bytes) // 1024)

        # 4. 上传 R2
        if not args.dry_run:
            try:
                orig_key  = new_uuid_key("originals")
                thumb_key = new_uuid_key("thumbnails")
                pub_orig  = upload_to_r2(r2, orig_bytes,  orig_key)
                pub_thumb = upload_to_r2(r2, thumb_bytes, thumb_key)
            except Exception as e:
                log.error("  R2 上传失败: %s，跳过", e)
                fail += 1
                continue
        else:
            pub_orig  = f"{R2_PUBLIC_URL}/foods/originals/dry-{food_id[:8]}.jpg"
            pub_thumb = f"{R2_PUBLIC_URL}/foods/thumbnails/dry-{food_id[:8]}.jpg"

        # 5. 写 DB
        update_food_images(conn, food_id, pub_orig, pub_thumb, args.dry_run)

        # 批量提交
        if not args.dry_run and idx % batch_size == 0:
            conn.commit()
            log.info("  ✓ 已提交 %d 条", idx)

        success += 1
        log.info("  ✓ %s → %s", zh_name, pub_orig)

        # 礼貌延迟
        time.sleep(args.delay * random.uniform(0.5, 1.5))

    # 最终提交
    if not args.dry_run:
        conn.commit()

    conn.close()
    log.info("=== 完成 ===  成功=%d  跳过=%d  失败=%d  共%d",
             success, skip, fail, len(foods))


if __name__ == "__main__":
    main()

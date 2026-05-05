"""
本地测试：下载一张下厨房图片 → Pillow处理 → 保存本地 → 打印尺寸
"""
import io, sys, importlib.util, requests
from PIL import Image
from pathlib import Path
from urllib.parse import quote

# 动态加载 crawl-r2.py
spec = importlib.util.spec_from_file_location(
    "crawl_r2",
    Path(__file__).parent / "crawl-r2.py"
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

HEADERS = m.HEADERS

def test_food(name: str):
    print(f"\n=== 测试食物：{name} ===")
    url = m.fetch_first_image_url(name)
    if not url:
        print("  未找到图片")
        return

    print(f"  下厨房 URL: {url}")

    resp = requests.get(url, headers=HEADERS, timeout=20)
    raw = resp.content
    print(f"  原始下载: {len(raw)//1024}KB  HTTP {resp.status_code}")

    orig_size = Image.open(io.BytesIO(raw)).size
    print(f"  原始尺寸: {orig_size}")

    result = m.process_image(raw)
    if not result:
        print("  process_image 返回 None！")
        return

    orig_b, thumb_b = result
    orig_img  = Image.open(io.BytesIO(orig_b))
    thumb_img = Image.open(io.BytesIO(thumb_b))

    print(f"  处理后 orig:  {orig_img.size}  {len(orig_b)//1024}KB")
    print(f"  处理后 thumb: {thumb_img.size}  {len(thumb_b)//1024}KB")

    # 保存到本地检查
    out = Path(__file__).parent / "test_out"
    out.mkdir(exist_ok=True)
    safe_name = name.replace(" ", "_").replace("/", "_")
    orig_path  = out / f"{safe_name}_orig.jpg"
    thumb_path = out / f"{safe_name}_thumb.jpg"
    orig_path.write_bytes(orig_b)
    thumb_path.write_bytes(thumb_b)
    print(f"  已保存 → {orig_path}")
    print(f"  已保存 → {thumb_path}")

if __name__ == "__main__":
    foods = sys.argv[1:] or ["三文鱼", "苹果", "红烧肉"]
    for f in foods:
        test_food(f)

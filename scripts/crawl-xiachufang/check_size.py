"""
验证脚本：
1. 用 psycopg2 取已上传的 R2 URL
2. 下载图片
3. 打印实际尺寸和文件大小
"""
import psycopg2, requests, io
from PIL import Image

DB_DSN = 'postgresql://xiehaiji@localhost:5432/wuwei'

conn = psycopg2.connect(DB_DSN)
cur = conn.cursor()
cur.execute('''
    SELECT name, image_url, thumbnail_url
    FROM foods
    WHERE image_url IS NOT NULL
    LIMIT 3
''')
rows = cur.fetchall()
conn.close()

if not rows:
    print("DB 中没有已上传的图片记录")
else:
    for name, img_url, thumb_url in rows:
        print(f"\n食物: {name}")
        for label, url in [("orig", img_url), ("thumb", thumb_url)]:
            if not url:
                print(f"  {label}: URL 为空")
                continue
            try:
                r = requests.get(url, timeout=15)
                if r.status_code == 200:
                    img = Image.open(io.BytesIO(r.content))
                    print(f"  {label}: {img.size}  {len(r.content)//1024}KB  url={url[-40:]}")
                else:
                    print(f"  {label}: HTTP {r.status_code}  url={url[-40:]}")
            except Exception as e:
                print(f"  {label}: ERROR {e}")

import psycopg2
conn = psycopg2.connect('postgresql://xiehaiji@localhost:5432/wuwei')
cur = conn.cursor()
cur.execute('UPDATE foods SET image_url=NULL, thumbnail_url=NULL WHERE image_url IS NOT NULL OR thumbnail_url IS NOT NULL')
print('已清除行数:', cur.rowcount)
conn.commit()
conn.close()

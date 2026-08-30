import os, psycopg2
os.chdir('sync')
from dotenv import load_dotenv
load_dotenv()
conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()
cur.execute("SELECT MIN(snapshot_date)::text, MAX(snapshot_date)::text, COUNT(*) FROM regime_snapshots")
print('regime_snapshots:', cur.fetchone())
cur.execute("SELECT MIN(period_date)::text, MAX(period_date)::text, COUNT(*) FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'T10Y2Y'")
print('T10Y2Y:', cur.fetchone())
cur.execute("SELECT MIN(period_date)::text, MAX(period_date)::text, COUNT(*) FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DGS3MO'")
print('DGS3MO:', cur.fetchone())
conn.close()

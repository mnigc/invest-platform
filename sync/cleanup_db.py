#!/usr/bin/env python3
"""删除全量 A 股日线数据 (cn_daily_prices, cn_symbols)"""

import pymysql

conn = pymysql.connect(host="204.44.121.43", port=3306, user="mnigc", password="woaiyinyue.4", database="invest_platform")
try:
    with conn.cursor() as cur:
        cur.execute("TRUNCATE TABLE cn_daily_prices")
        cur.execute("TRUNCATE TABLE cn_symbols")
    conn.commit()
    print("✅ 已清空 cn_daily_prices 和 cn_symbols")
finally:
    conn.close()

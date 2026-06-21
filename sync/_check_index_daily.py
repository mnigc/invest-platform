#!/usr/bin/env python3
"""临时检查 index_daily 最新数据。"""
import pymysql

conn = pymysql.connect(
    host="204.44.121.43", port=3306, user="mnigc", password="woaiyinyue.4",
    database="invest_platform", charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
)
with conn.cursor() as cur:
    cur.execute("""
        SELECT index_code, index_name, trade_date, close_price, change_pct
        FROM index_daily
        WHERE category = 'main'
          AND trade_date = (SELECT MAX(trade_date) FROM index_daily WHERE category = 'main')
        ORDER BY FIELD(index_code,'000001','399001','399006','000688','899050','000016','000300','000852','000905')
    """)
    for r in cur.fetchall()
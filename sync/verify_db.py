#!/usr/bin/env python3
"""数据库连通性与完整性检查（Supabase）。
用法:
    export DATABASE_URL='postgresql://postgres.xxx:******@aws-0-*.pooler.supabase.com:5432/postgres'
    python3 verify_db.py
输出: 连接状态、期望表清单、每表记录数与最新数据日期。
"""
import os
import sys

from sync_base import get_conn

EXPECTED_TABLES = [
    "indicators", "indicator_data", "assets", "asset_prices",
    "index_daily", "gold_reserve_changes", "gold_price_history",
    "etf_master", "etf_daily", "etf_shares", "data_sync_logs",
]

DATE_COLUMNS = {
    "indicator_data": "MAX(period_date)",
    "index_daily": "MAX(trade_date)",
    "gold_price_history": "MAX(price_date)",
    "etf_daily": "MAX(trade_date)",
    "etf_shares": "MAX(trade_date)",
    "cn_valuation": "MAX(date)",
}


def main():
    if not os.environ.get("DATABASE_URL"):
        print("[verify_db] 未设置环境变量 DATABASE_URL，先在终端执行:")
        print('  export DATABASE_URL=\'postgresql://postgres.xxx:******@aws-0-*.pooler.supabase.com:5432/postgres\'')
        sys.exit(1)

    try:
        conn = get_conn()
    except Exception as e:
        print("[verify_db] 连接失败:", e)
        sys.exit(1)

    ok = 0
    missing = []
    print("=== 已连接到 Supabase ===")
    with conn.cursor() as cur:
        for table in EXPECTED_TABLES:
            cur.execute("SELECT to_regclass(%s) IS NOT NULL AS e", ("public." + table,))
            row = cur.fetchone()
            exists = bool(row["e"]) if row else False
            if not exists:
                missing.append(table)
                print("  [----] %-24s 不存在" % table)
                continue
            ok += 1
            cur.execute("SELECT COUNT(1) AS c FROM " + table)
            cnt = (cur.fetchone() or {}).get("c", 0)
            extra = ""
            if table in DATE_COLUMNS:
                cur.execute("SELECT %s AS d FROM %s" % (DATE_COLUMNS[table], table))
                d = (cur.fetchone() or {}).get("d")
                extra = "  最新: %s" % (str(d)[:10] if d else "--")
            print("  [%4s] %-24s %10s 条%s" % ("OK" if cnt else "EMPTY", table, "{:,}".format(cnt or 0), extra))

    conn.close()
    print("=== %d/%d 表存在 ===" % (ok, len(EXPECTED_TABLES)))
    if missing:
        print("缺失表（请先在 supabase_schema.sql 建表）:", ", ".join(missing))
        sys.exit(2)
    print("[verify_db] 数据表就绪，可以运行: python3 run_sync.py --list")


if __name__ == "__main__":
    main()

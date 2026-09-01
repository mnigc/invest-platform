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
    # 指标层
    "indicators", "indicator_data",
    # 资产层
    "asset_categories", "assets", "asset_prices", "gold_price_history",
    # 预计算回测层
    "regime_snapshots", "regime_backtest_summaries", "regime_index_summaries",
    # 预计算分析结果层（6 个重分析 API 的 JSON payload）
    "analysis_results",
    # 运维
    "data_sync_logs",
]

# 6 个预计算端点。analysis_results 为空会让对应 API 返回 503，
# 因此单独逐项检查，便于定位是「整表未建」还是「某个脚本没跑成功」。
ANALYSIS_ENDPOINTS = [
    "analysis/cross-asset-correlation",
    "analysis/macro-consensus",
    "analysis/credit-stress",
    "analysis/inflation-anchor",
    "analysis/yield-curve-regime",
    "gold/correlation",
]

DATE_COLUMNS = {
    "indicator_data": "MAX(period_date)",
    "gold_price_history": "MAX(price_date)",
    "regime_snapshots": "MAX(snapshot_date)",
    "analysis_results": "MAX(computed_at)",
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

    missing_endpoints = []
    if "analysis_results" not in missing:
        print("--- 预计算端点 (analysis_results) ---")
        with conn.cursor() as cur:
            for ep in ANALYSIS_ENDPOINTS:
                cur.execute(
                    "SELECT valid_from, computed_at FROM analysis_results WHERE endpoint = %s",
                    (ep,),
                )
                row = cur.fetchone()
                if not row:
                    missing_endpoints.append(ep)
                    print("  [MISSING] %-36s 尚未生成" % ep)
                else:
                    print("  [  OK  ] %-36s valid_from=%s  computed_at=%s"
                          % (ep, row["valid_from"], str(row["computed_at"])[:19]))

    conn.close()
    print("=== %d/%d 表存在，%d/%d 端点就绪 ==="
          % (ok, len(EXPECTED_TABLES), len(ANALYSIS_ENDPOINTS) - len(missing_endpoints), len(ANALYSIS_ENDPOINTS)))
    if missing:
        print("缺失表（请先在 supabase_schema.sql 建表）:", ", ".join(missing))
    if missing_endpoints:
        print("缺失端点（请执行对应同步脚本）:", ", ".join(missing_endpoints))
    if missing or missing_endpoints:
        sys.exit(2)
    print("[verify_db] 数据表就绪，可以运行: python3 run_sync.py --list")


if __name__ == "__main__":
    main()

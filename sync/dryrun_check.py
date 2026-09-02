#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dry-run 校验：只验证「能连库 + 指标定义能 UPSERT」，不拉任何历史数据。

用途：改动 indicators.py 注册表后，先跑这个确认定义能正确落库，
再决定是否执行真正的同步（那会拉 2000 年至今的全量历史，很慢）。

**明确不做的事**：不调用 fetch_fred()，不写 indicator_data，不产生任何网络
数据请求。唯一的网络活动是连数据库。

用法:
    python3 dryrun_check.py            # 校验本轮新增的指标
    python3 dryrun_check.py --all      # 校验注册表中全部指标
"""
import sys

from sync_base import _setup_logger, get_conn


log = _setup_logger("dryrun")


# 本轮新增的三组指标：流动性缺口 / 大宗商品 / 领先指标
NEW_KEYS = [
    # A 组：流动性缺口
    ("IORB", "GLOBAL"),
    ("BANK_RESERVES", "GLOBAL"),
    ("M1", "US"),
    ("M2", "US"),
    # B 组：大宗商品
    ("WTI", "GLOBAL"),
    ("BRENT", "GLOBAL"),
    ("NATGAS", "GLOBAL"),
    ("COPPER", "GLOBAL"),
    ("IRON_ORE", "GLOBAL"),
    # C 组：领先指标
    ("NFCI", "US"),
    ("ICSA", "US"),
    ("UNRATE", "US"),
    ("PAYEMS", "US"),
    ("INDPRO", "US"),
    ("CAPACITY_UTIL", "US"),
    ("PERMIT", "US"),
    ("CORE_CAPEX_ORDERS", "US"),
    ("CONSUMER_SENT", "US"),
]


def check_connection():
    """验证能连库，返回 server 信息。"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT version() AS v, current_date AS d")
            row = cur.fetchone()
    return row


def count_indicator_data(keys):
    """统计这些指标当前已有多少条观测值（dry-run 阶段应全部为 0）。"""
    if not keys:
        return {}
    codes = [k[0] for k in keys]
    placeholders = ",".join(["%s"] * len(codes))
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT i.code, i.region, COUNT(d.id) AS n
                FROM indicators i
                LEFT JOIN indicator_data d ON d.indicator_id = i.id
                WHERE i.code IN ({placeholders})
                GROUP BY i.code, i.region
                """,
                codes,
            )
            rows = cur.fetchall()
    return {(r["code"], r["region"]): r["n"] for r in rows}


def fetch_defs(keys):
    """回读刚 UPSERT 的定义，确认字段真的写进去了。"""
    codes = [k[0] for k in keys]
    placeholders = ",".join(["%s"] * len(codes))
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT code, region, name_zh, category, sub_category,
                       unit, frequency, source, is_active
                FROM indicators
                WHERE code IN ({placeholders})
                ORDER BY category, code
                """,
                codes,
            )
            rows = cur.fetchall()
    return {(r["code"], r["region"]): r for r in rows}


def main():
    # 延迟导入：indicators 模块导入时会执行 patch_cn_proxy()，
    # 放在这里可以保证「连库失败」和「注册表问题」两类错误分开报。
    from indicators import INDICATORS, ensure_defs

    all_keys = "--all" in sys.argv
    keys = list(INDICATORS.keys()) if all_keys else NEW_KEYS

    mode = "全部注册表" if all_keys else "本轮新增"
    print("=" * 104)
    print("DRY-RUN 校验（%s，共 %d 个指标）" % (mode, len(keys)))
    print("=" * 104)

    # ── 第 1 步：连库 ──
    try:
        row = check_connection()
    except Exception as e:
        print("\n[FAIL] 数据库连接失败: %s" % e)
        print("       请确认项目根目录 .env 中的 DATABASE_URL 配置正确")
        sys.exit(1)
    print("\n[1/4] 数据库连接 OK")
    print("      server : %s" % row["v"].split(",")[0])
    print("      数据库日期: %s" % row["d"])

    # ── 第 2 步：注册表完整性 ──
    missing = [k for k in keys if k not in INDICATORS]
    if missing:
        print("\n[FAIL] 注册表中缺少以下定义:")
        for k in missing:
            print("       %s / %s" % k)
        sys.exit(1)
    print("\n[2/4] 注册表完整性 OK（%d 个 key 全部有定义）" % len(keys))

    # ── 第 3 步：UPSERT 定义 ──
    try:
        ensure_defs(keys)
    except Exception as e:
        print("\n[FAIL] 指标定义 UPSERT 失败: %s" % e)
        sys.exit(1)
    print("\n[3/4] 指标定义 UPSERT OK（未写入任何观测值）")

    # ── 第 4 步：回读验证 ──
    defs = fetch_defs(keys)
    data_counts = count_indicator_data(keys)

    print("\n[4/4] 回读验证")
    print("-" * 104)
    print("%-18s %-7s %-22s %-12s %-16s %-9s %-5s %s" % (
        "CODE", "REGION", "中文名", "分类", "单位", "频率", "激活", "已有观测"))
    print("-" * 104)

    bad = []
    for key in sorted(keys, key=lambda k: (k[1], k[0])):
        code, region = key
        r = defs.get((code, region))
        if not r:
            bad.append((code, region, "回读不到记录"))
            print("%-18s %-7s %s" % (code, region, "<回读失败>"))
            continue
        n = data_counts.get((code, region), 0)
        print("%-18s %-7s %-22s %-12s %-16s %-9s %-5s %d" % (
            code, region, r["name_zh"][:22], r["category"][:12],
            (r["unit"] or "")[:16], r["frequency"], r["is_active"], n))

    print("-" * 104)

    if bad:
        print("\n[FAIL] %d 个指标回读失败" % len(bad))
        for code, region, err in bad:
            print("       %s / %s : %s" % (code, region, err))
        sys.exit(1)

    total_obs = sum(data_counts.values())
    print("\n[PASS] %d 个指标定义已全部落库" % len(keys))
    print("       indicator_data 现有观测值合计 %d 条（dry-run 不写数据，非 0 即为历史遗留）"
          % total_obs)
    print("\n下一步：确认无误后执行真正的同步，例如")
    print("       python run_sync.py commodities        # 单独同步商品组")
    print("       python run_sync.py leading            # 单独同步领先指标组")
    print("       python run_sync.py global_liquidity   # 单独同步流动性组")
    print("       python run_sync.py --group daily      # 全量日常任务（耗时较长）")


if __name__ == "__main__":
    main()

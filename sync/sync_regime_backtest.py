#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预计算宏观体制回测数据，解决 backtest API 性能问题。

流程:
1. 从 indicator_data 批量加载 9 个指标全量数据（9 次查询）
2. 从 asset_prices 加载 S&P500 全量价格
3. 在内存中按月末计算体制 + 前向收益
4. 批量写入 regime_snapshots + regime_backtest_summaries

用法:
    python sync_regime_backtest.py [--years N]
"""
import sys
from datetime import datetime, timedelta
from decimal import Decimal
from collections import defaultdict

from sync_base import _setup_logger, get_conn, write_sync_log

log = _setup_logger("sync_regime_backtest")

INDICATOR_CODES = [
    "CFNAI", "CPI", "FEDFUNDS", "DGS10", "DGS2",
    "T10YIE", "VIXCLS", "BAMLC0A4CBBB", "DFII10",
]
SP500_SYMBOL = "^GSPC"

# 指数对比列表：符号 → 中文名
INDEX_LIST = [
    ("^GSPC", "标普500指数"),
    ("^IXIC", "纳斯达克综合指数"),
    ("^DJI", "道琼斯工业平均"),
    ("^RUT", "罗素2000"),
]

LABELS = {
    "GOLDILOCKS": "金发女孩", "RISK_ON": "风险偏好", "OVERHEAT": "过热",
    "STAGFLATION": "滞胀", "RISK_OFF": "风险规避", "RECOVERY": "复苏", "UNKNOWN": "不确定",
}


def load_indicator_data(conn, start_date: str):
    """批量加载所有指标数据，返回 {code: [(date, value), ...]}"""
    data = {}
    with conn.cursor() as cur:
        for code in INDICATOR_CODES:
            cur.execute("""
                SELECT d.period_date, d.value
                FROM indicator_data d
                JOIN indicators i ON i.id = d.indicator_id
                WHERE i.code = %s AND i.region = 'US'
                  AND d.period_date >= %s AND d.value IS NOT NULL
                ORDER BY d.period_date ASC
            """, (code, start_date))
            rows = cur.fetchall()
            data[code] = [(str(r["period_date"])[:10], float(r["value"])) for r in rows]
            log.info(f"  加载 {code}: {len(data[code])} 条")
    return data


def load_sp500_prices(conn, start_date: str):
    """加载 S&P500 价格，返回 {date_str: price}"""
    return load_index_prices(conn, SP500_SYMBOL, start_date)


def load_index_prices(conn, symbol: str, start_date: str):
    """加载指定指数价格，返回 {date_str: price}"""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT ap.trade_date, ap.close_price
            FROM asset_prices ap
            JOIN assets a ON a.id = ap.asset_id
            WHERE a.symbol = %s AND ap.trade_date >= %s AND ap.close_price > 0
            ORDER BY ap.trade_date ASC
        """, (symbol, start_date))
        rows = cur.fetchall()
        log.info(f"  加载 {symbol}: {len(rows)} 条")
        return {str(r["trade_date"])[:10]: float(r["close_price"]) for r in rows}


def get_latest_value(arr: list, date: str) -> float | None:
    """获取 <= date 的最新值"""
    if not arr:
        return None
    for d, v in reversed(arr):
        if d <= date:
            return v
    return None


def compute_yoy(data: dict, date: str) -> float | None:
    """计算 YoY 同比"""
    arr = data.get("CPI", [])
    if not arr:
        return None
    current = None
    for d, v in reversed(arr):
        if d <= date:
            current = (d, v)
            break
    if current is None:
        return None
    curr_date, curr_val = current
    year_ago = datetime.strptime(curr_date, "%Y-%m-%d") - timedelta(days=365)
    year_ago_str = year_ago.strftime("%Y-%m-%d")
    for d, v in reversed(arr):
        if d <= year_ago_str:
            if v == 0:
                return None
            return round((curr_val - v) / v * 100, 2)
    return None


def score_indicator(code: str, value: float) -> int:
    """评分单个指标"""
    if code == "CFNAI":
        return 1 if value > 0 else (-1 if value < -0.5 else 0)
    elif code == "CPI":
        return 1 if value < 3 else (0 if value < 5 else -1)
    elif code == "FEDFUNDS":
        return 0 if value > 5 else (1 if value > 2 else (0 if value > 0 else -1))
    elif code == "T10YIE":
        return 1 if value < 2.5 else (0 if value < 3.5 else -1)
    elif code == "VIXCLS":
        return 1 if value < 20 else (0 if value < 30 else -1)
    elif code == "BAMLC0A4CBBB":
        return 1 if value < 1.5 else (0 if value < 2.5 else -1)
    elif code == "DFII10":
        return 1 if value < 2 else (0 if value < 3 else -1)
    return 0


def decide_regime(scores: dict) -> tuple[str, int]:
    """根据指标评分决定体制"""
    growth_ok = scores.get("CFNAI", 0) == 1
    inflation_high = scores.get("CPI", 0) == -1
    stress = scores.get("VIXCLS", 0) == -1 or scores.get("BAMLC0A4CBBB", 0) == -1
    slope_ok = scores.get("slope", 0) == 1

    if growth_ok and not inflation_high and not stress and slope_ok:
        return "GOLDILOCKS", 10
    if growth_ok and not inflation_high and stress:
        return "RISK_ON", 7
    if growth_ok and inflation_high and not stress:
        return "OVERHEAT", 6
    if growth_ok and inflation_high and stress:
        return "STAGFLATION", 4
    if not growth_ok and inflation_high and stress:
        return "STAGFLATION", 3
    if not growth_ok and not inflation_high and stress:
        return "RISK_OFF", 2
    if scores.get("CFNAI", 0) == 0 and scores.get("FEDFUNDS", 0) == 1 and not stress:
        return "RECOVERY", 5
    return "UNKNOWN", 0


def compute_confidence(scores: dict, score_val: int) -> int:
    """计算置信度 0-100"""
    count = sum(1 for v in scores.values() if v != 0)
    if count == 0:
        return 0
    max_score = count * 0.15
    return min(100, round(abs(score_val) / max(max_score, 0.01) * 100))


def get_month_ends(start: str, end: str) -> list[str]:
    """生成月末日期列表"""
    dates = []
    d = datetime.strptime(start, "%Y-%m-%d")
    end_d = datetime.strptime(end, "%Y-%m-%d")
    while d <= end_d:
        # 月末
        import calendar
        last_day = calendar.monthrange(d.year, d.month)[1]
        me = datetime(d.year, d.month, last_day)
        if me > end_d:
            me = end_d
        dates.append(me.strftime("%Y-%m-%d"))
        # 下月1日
        if d.month == 12:
            d = datetime(d.year + 1, 1, 1)
        else:
            d = datetime(d.year, d.month + 1, 1)
    return dates


def price_at(prices: dict, date: str) -> float | None:
    """获取 <= date 的最新价格"""
    sorted_dates = sorted(prices.keys())
    for d in reversed(sorted_dates):
        if d <= date:
            return prices[d]
    return None


def add_months(date_str: str, months: int) -> str:
    """日期加N个月"""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    import calendar
    new_month = d.month + months
    new_year = d.year + (new_month - 1) // 12
    new_month = ((new_month - 1) % 12) + 1
    last_day = calendar.monthrange(new_year, new_month)[1]
    new_day = min(d.day, last_day)
    return datetime(new_year, new_month, new_day).strftime("%Y-%m-%d")


def sync_backtest(years: int = 10):
    """执行回测同步"""
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=years * 365)).strftime("%Y-%m-%d")
    log.info(f"开始回测同步: {start_date} ~ {end_date}")

    with get_conn() as conn:
        # 1. 批量加载数据
        log.info("加载指标数据...")
        indicator_data = load_indicator_data(conn, start_date)
        log.info("加载 S&P500 价格...")
        sp500 = load_sp500_prices(conn, start_date)

        if not sp500:
            log.warning("无 S&P500 数据，跳过")
            return

        # 2. 获取所有月末日期
        month_ends = get_month_ends(start_date, end_date)
        log.info(f"待计算月末: {len(month_ends)} 个")

        # 3. 逐月计算体制
        snapshots = []
        for me in month_ends:
            sp_price = price_at(sp500, me)
            if sp_price is None:
                continue

            # 获取各指标值
            cfnai = get_latest_value(indicator_data.get("CFNAI", []), me)
            cpi_yoy = compute_yoy(indicator_data, me)
            fedfunds = get_latest_value(indicator_data.get("FEDFUNDS", []), me)
            dgs10 = get_latest_value(indicator_data.get("DGS10", []), me)
            dgs2 = get_latest_value(indicator_data.get("DGS2", []), me)
            t10yie = get_latest_value(indicator_data.get("T10YIE", []), me)
            vix = get_latest_value(indicator_data.get("VIXCLS", []), me)
            bbb = get_latest_value(indicator_data.get("BAMLC0A4CBBB", []), me)
            dfii10 = get_latest_value(indicator_data.get("DFII10", []), me)

            # 使用默认值填充
            f = lambda v, fb: v if v is not None else fb
            g_cfnai = f(cfnai, 0.05)
            g_cpi = f(cpi_yoy, 3.0)
            g_fedfunds = f(fedfunds, 5.25)
            g_dgs10 = f(dgs10, 4.30)
            g_dgs2 = f(dgs2, 4.70)
            g_t10yie = f(t10yie, 2.20)
            g_vix = f(vix, 14.0)
            g_bbb = f(bbb, 1.20)
            g_dfii10 = f(dfii10, 1.80)
            slope = round(g_dgs10 - g_dgs2, 4)

            # 评分
            scores = {
                "CFNAI": score_indicator("CFNAI", g_cfnai),
                "CPI": score_indicator("CPI", g_cpi),
                "FEDFUNDS": score_indicator("FEDFUNDS", g_fedfunds),
                "T10YIE": score_indicator("T10YIE", g_t10yie),
                "VIXCLS": score_indicator("VIXCLS", g_vix),
                "BAMLC0A4CBBB": score_indicator("BAMLC0A4CBBB", g_bbb),
                "DFII10": score_indicator("DFII10", g_dfii10),
                "slope": 1 if slope > 0 else (0 if slope > -0.5 else -1),
            }
            regime, score = decide_regime(scores)
            confidence = compute_confidence(scores, score)

            # 前向收益
            fwd = {}
            for m in [1, 3, 6, 12]:
                fwd_date = add_months(me, m)
                fwd_price = price_at(sp500, fwd_date)
                if fwd_price and fwd_price > 0:
                    fwd[m] = round(fwd_price / sp_price - 1, 6)
                else:
                    fwd[m] = None

            snapshots.append({
                "date": me, "regime": regime, "label": LABELS.get(regime, regime),
                "confidence": confidence, "sp500_price": sp_price,
                "cfnai": g_cfnai, "cpi_yoy": g_cpi, "fedfunds": g_fedfunds,
                "dgs10": g_dgs10, "dgs2": g_dgs2, "t10yie": g_t10yie,
                "vix": g_vix, "bbb_spread": g_bbb, "dfii10": g_dfii10,
                "fwd_return_1m": fwd[1], "fwd_return_3m": fwd[3],
                "fwd_return_6m": fwd[6], "fwd_return_12m": fwd[12],
            })

        log.info(f"计算完成: {len(snapshots)} 个月度快照")

        # 4. 写入 regime_snapshots
        _upsert_snapshots(conn, snapshots)

        # 5. 汇总统计写入 regime_backtest_summaries
        _compute_and_upsert_summaries(conn, snapshots, start_date, end_date)

        # 6. 按指数 × 体制写入 regime_index_summaries（多指数对比）
        _compute_and_upsert_index_summaries(conn, snapshots, start_date, end_date)

        write_sync_log(conn, "regime_backtest", "regime_snapshots", "ok", len(snapshots))


def _upsert_snapshots(conn, snapshots: list):
    """批量写入体制快照"""
    if not snapshots:
        return
    with conn.cursor() as cur:
        # 使用 execute_values 更高效
        from psycopg2.extras import execute_values
        values = [
            (
                s["date"], s["regime"], s["label"], s["confidence"], s["sp500_price"],
                s["cfnai"], s["cpi_yoy"], s["fedfunds"], s["dgs10"], s["dgs2"],
                s["t10yie"], s["vix"], s["bbb_spread"], s["dfii10"],
                s["fwd_return_1m"], s["fwd_return_3m"], s["fwd_return_6m"], s["fwd_return_12m"],
                datetime.now(),
            )
            for s in snapshots
        ]
        execute_values(cur, """
            INSERT INTO regime_snapshots (
                snapshot_date, regime, label, confidence, sp500_price,
                cfnai, cpi_yoy, fedfunds, dgs10, dgs2,
                t10yie, vix, bbb_spread, dfii10,
                fwd_return_1m, fwd_return_3m, fwd_return_6m, fwd_return_12m,
                updated_at
            ) VALUES %s
            ON CONFLICT (snapshot_date) DO UPDATE SET
                regime = EXCLUDED.regime, label = EXCLUDED.label,
                confidence = EXCLUDED.confidence, sp500_price = EXCLUDED.sp500_price,
                cfnai = EXCLUDED.cfnai, cpi_yoy = EXCLUDED.cpi_yoy,
                fedfunds = EXCLUDED.fedfunds, dgs10 = EXCLUDED.dgs10,
                dgs2 = EXCLUDED.dgs2, t10yie = EXCLUDED.t10yie,
                vix = EXCLUDED.vix, bbb_spread = EXCLUDED.bbb_spread,
                dfii10 = EXCLUDED.dfii10,
                fwd_return_1m = EXCLUDED.fwd_return_1m,
                fwd_return_3m = EXCLUDED.fwd_return_3m,
                fwd_return_6m = EXCLUDED.fwd_return_6m,
                fwd_return_12m = EXCLUDED.fwd_return_12m,
                updated_at = EXCLUDED.updated_at
        """, values)
    conn.commit()
    log.info(f"写入 regime_snapshots: {len(snapshots)} 条")


def _compute_and_upsert_summaries(conn, snapshots: list, start_date: str, end_date: str):
    """按体制汇总统计"""
    by_regime = defaultdict(list)
    for s in snapshots:
        by_regime[s["regime"]].append(s)

    summaries = []
    for regime, snaps in by_regime.items():
        n = len(snaps)
        if n == 0:
            continue

        def avg(field):
            vals = [s[field] for s in snaps if s[field] is not None]
            return round(sum(vals) / len(vals), 6) if vals else 0

        def win_rate(field):
            vals = [s[field] for s in snaps if s[field] is not None]
            return round(sum(1 for v in vals if v > 0) / len(vals), 3) if vals else 0

        summaries.append({
            "period_start": start_date, "period_end": end_date,
            "regime": regime, "label": LABELS.get(regime, regime),
            "count": n,
            "avg_confidence": round(avg("confidence") / 100, 3),
            "avg_return_1m": avg("fwd_return_1m"),
            "avg_return_3m": avg("fwd_return_3m"),
            "avg_return_6m": avg("fwd_return_6m"),
            "avg_return_12m": avg("fwd_return_12m"),
            "win_rate_1m": win_rate("fwd_return_1m"),
            "win_rate_3m": win_rate("fwd_return_3m"),
            "win_rate_6m": win_rate("fwd_return_6m"),
            "win_rate_12m": win_rate("fwd_return_12m"),
        })

    if not summaries:
        return

    with conn.cursor() as cur:
        from psycopg2.extras import execute_values
        values = [
            (
                s["period_start"], s["period_end"], s["regime"], s["label"],
                s["count"], s["avg_confidence"],
                s["avg_return_1m"], s["avg_return_3m"], s["avg_return_6m"], s["avg_return_12m"],
                s["win_rate_1m"], s["win_rate_3m"], s["win_rate_6m"], s["win_rate_12m"],
                datetime.now(),
            )
            for s in summaries
        ]
        execute_values(cur, """
            INSERT INTO regime_backtest_summaries (
                period_start, period_end, regime, label, count,
                avg_confidence, avg_return_1m, avg_return_3m, avg_return_6m, avg_return_12m,
                win_rate_1m, win_rate_3m, win_rate_6m, win_rate_12m, updated_at
            ) VALUES %s
            ON CONFLICT (period_start, period_end, regime) DO UPDATE SET
                label = EXCLUDED.label, count = EXCLUDED.count,
                avg_confidence = EXCLUDED.avg_confidence,
                avg_return_1m = EXCLUDED.avg_return_1m,
                avg_return_3m = EXCLUDED.avg_return_3m,
                avg_return_6m = EXCLUDED.avg_return_6m,
                avg_return_12m = EXCLUDED.avg_return_12m,
                win_rate_1m = EXCLUDED.win_rate_1m,
                win_rate_3m = EXCLUDED.win_rate_3m,
                win_rate_6m = EXCLUDED.win_rate_6m,
                win_rate_12m = EXCLUDED.win_rate_12m,
                updated_at = EXCLUDED.updated_at
        """, values)
    conn.commit()
    log.info(f"写入 regime_backtest_summaries: {len(summaries)} 条")


def _compute_and_upsert_index_summaries(conn, snapshots: list, start_date: str, end_date: str):
    """按指数 × 体制累计前瞻收益（指数间可对比）"""
    from psycopg2.extras import execute_values

    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.regime_index_summaries')")
        if cur.fetchone()[0] is None:
            log.warning("regime_index_summaries 表不存在（请先在数据库执行 supabase_schema.sql 建表），跳过指数回测汇总")
            return

    for symbol, name_zh in INDEX_LIST:
        prices = load_index_prices(conn, symbol, start_date)
        if not prices:
            log.warning(f"  指数 {symbol} 无价格数据，跳过指数回测")
            continue

        by_regime = defaultdict(list)
        for s in snapshots:
            me = s["date"]
            px = price_at(prices, me)
            if not px or px <= 0:
                continue
            fwd = {}
            for m in [1, 3, 6, 12]:
                fd = add_months(me, m)
                fp = price_at(prices, fd)
                fwd[m] = round(fp / px - 1, 6) if fp and fp > 0 else None
            item = {**s, "fwd": fwd}
            by_regime[s["regime"]].append(item)

        rows = []
        for regime, snaps in by_regime.items():
            n = len(snaps)
            if n == 0:
                continue

            def avg(key):
                vals = [x["fwd"][key] for x in snaps if x["fwd"][key] is not None]
                return round(sum(vals) / len(vals), 6) if vals else 0

            def win_rate(key):
                vals = [x["fwd"][key] for x in snaps if x["fwd"][key] is not None]
                return round(sum(1 for v in vals if v > 0) / len(vals), 3) if vals else 0

            rows.append((
                start_date, end_date, symbol, name_zh, regime,
                LABELS.get(regime, regime), n,
                round(sum(x["confidence"] for x in snaps) / n / 100, 3),
                avg(1), avg(3), avg(6), avg(12),
                win_rate(1), win_rate(3), win_rate(6), win_rate(12),
                datetime.now(),
            ))

        if not rows:
            continue

        with conn.cursor() as cur:
            execute_values(cur, """
                INSERT INTO regime_index_summaries (
                    period_start, period_end, index_symbol, index_name_zh,
                    regime, label, count, avg_confidence,
                    avg_return_1m, avg_return_3m, avg_return_6m, avg_return_12m,
                    win_rate_1m, win_rate_3m, win_rate_6m, win_rate_12m,
                    updated_at
                ) VALUES %s
                ON CONFLICT (index_symbol, period_start, period_end, regime) DO UPDATE SET
                    index_name_zh = EXCLUDED.index_name_zh,
                    label = EXCLUDED.label, count = EXCLUDED.count,
                    avg_confidence = EXCLUDED.avg_confidence,
                    avg_return_1m = EXCLUDED.avg_return_1m,
                    avg_return_3m = EXCLUDED.avg_return_3m,
                    avg_return_6m = EXCLUDED.avg_return_6m,
                    avg_return_12m = EXCLUDED.avg_return_12m,
                    win_rate_1m = EXCLUDED.win_rate_1m,
                    win_rate_3m = EXCLUDED.win_rate_3m,
                    win_rate_6m = EXCLUDED.win_rate_6m,
                    win_rate_12m = EXCLUDED.win_rate_12m,
                    updated_at = EXCLUDED.updated_at
            """, rows)
        conn.commit()
        log.info(f"  写入 regime_index_summaries [{symbol}]: {len(rows)} 条")


def main():
    sync_backtest()


if __name__ == "__main__":
    main()

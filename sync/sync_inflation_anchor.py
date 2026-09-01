#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预计算：通胀预期锚定分析（API: /api/v1/analysis/inflation-anchor.json）"""
from datetime import datetime, timedelta

from sync_base import _setup_logger, get_conn, write_sync_log, upsert_analysis_result
from analysis import mean, z_score, percentile_rank


ENDPOINT = "analysis/inflation-anchor"
FED_TARGET = 2.0
HORIZON = 10 * 365
SP500_SYMBOL = "^GSPC"

log = _setup_logger("sync_inflation_anchor")


def _to_date(v):
    return str(v)[:10]


def _add_days(s, n):
    return (datetime.strptime(s, "%Y-%m-%d") + timedelta(days=n)).strftime("%Y-%m-%d")


def _load(conn, sql, params=()):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def _load_indicator(conn, code, horizon=None, asc=False):
    extra = f"LIMIT {horizon}" if horizon else ""
    sql = f"""
        SELECT d.period_date, d.value
        FROM indicator_data d
        JOIN indicators i ON i.id = d.indicator_id
        WHERE i.code = %s AND i.region = 'US'
          AND d.value IS NOT NULL
        ORDER BY d.period_date {'ASC' if asc else 'DESC'}
        {extra}
    """
    rows = _load(conn, sql, (code,))
    return [
        {"date": _to_date(r["period_date"]), "value": float(r["value"])}
        for r in (reversed(rows) if not asc else rows)
    ]


def _load_sp500(conn, horizon):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.trade_date, p.close_price
            FROM asset_prices p
            JOIN assets a ON a.id = p.asset_id
            WHERE a.symbol = %s AND p.close_price IS NOT NULL
            ORDER BY p.trade_date DESC
            LIMIT %s
            """,
            (SP500_SYMBOL, horizon + 365),
        )
        rows = cur.fetchall()
    return [
        {"date": _to_date(r["trade_date"]), "value": float(r["close_price"])}
        for r in reversed(rows)
    ]


def _load_gold(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT price_date, close_price FROM gold_price_history
            WHERE currency = 'USD' AND unit = 'OZ'
              AND source IN ('yfinance', 'gold-api', 'LOCAL-XLSX', 'FRED')
            ORDER BY price_date ASC
            """
        )
        rows = cur.fetchall()
    return [
        {"date": _to_date(r["price_date"]), "value": float(r["close_price"])}
        for r in rows
    ]


def _forward_return(price_dates, price_map, base_date, days):
    base_idx = -1
    for i, d in enumerate(price_dates):
        if d <= base_date:
            base_idx = i
        else:
            break
    if base_idx < 0:
        return None
    base = price_map.get(price_dates[base_idx])
    if base is None or base <= 0:
        return None
    target = _add_days(base_date, days)
    j = base_idx
    while j < len(price_dates) and price_dates[j] < target:
        j += 1
    if j >= len(price_dates):
        return None
    fwd = price_map.get(price_dates[j])
    return round((fwd / base - 1) * 100, 2) if fwd is not None and fwd > 0 else None


def _calc_fwd(points, price_dates, price_map):
    ranges = [
        (float("-inf"), -0.5, "低于目标 0.5% 以上"),
        (-0.5, 0.5, "锚定区间 (±0.5%)"),
        (0.5, float("inf"), "高于目标 0.5% 以上"),
    ]
    results = []
    for lo, hi, label in ranges:
        in_range = [
            p for p in points
            if (p["value"] > lo if hi == float("inf") else lo <= p["value"] < hi)
        ]
        buckets = {20: [], 60: [], 120: [], 240: []}
        for p in in_range:
            for d in buckets:
                r = _forward_return(price_dates, price_map, p["date"], d)
                if r is not None:
                    buckets[d].append(r)

        def stats(arr):
            if not arr:
                return {"avg": 0, "winRate": 0}
            return {"avg": mean(arr), "winRate": sum(1 for v in arr if v > 0) / len(arr)}

        s = {k: stats(v) for k, v in buckets.items()}
        results.append({
            "devRange": label,
            "avgReturn1m": round(s[20]["avg"], 2),
            "avgReturn3m": round(s[60]["avg"], 2),
            "avgReturn6m": round(s[120]["avg"], 2),
            "avgReturn12m": round(s[240]["avg"], 2),
            "winRate1m": round(s[20]["winRate"], 2),
            "winRate3m": round(s[60]["winRate"], 2),
            "winRate6m": round(s[120]["winRate"], 2),
            "winRate12m": round(s[240]["winRate"], 2),
            "sampleSize": len(in_range),
        })
    return results




def sync():
    with get_conn() as conn:
        t5yie = _load_indicator(conn, "T5YIE", HORIZON)
        t10yie = _load_indicator(conn, "T10YIE", HORIZON)
        dfii5 = _load_indicator(conn, "DFII5", HORIZON)
        dfii10 = _load_indicator(conn, "DFII10", HORIZON)
        dfii20 = _load_indicator(conn, "DFII20", HORIZON)
        dfii30 = _load_indicator(conn, "DFII30", HORIZON)
        cpi_rows = _load(conn, """
            SELECT d.period_date, d.value
            FROM indicator_data d
            JOIN indicators i ON i.id = d.indicator_id
            WHERE i.code = 'CPI' AND i.region = 'US' AND d.value IS NOT NULL
            ORDER BY d.period_date ASC
        """)
        sp500 = _load_sp500(conn, HORIZON)
        gold = _load_gold(conn)

        t5y_map = {p["date"]: p["value"] for p in t5yie}
        t10y_map = {p["date"]: p["value"] for p in t10yie}
        dfii5_map = {p["date"]: p["value"] for p in dfii5}
        dfii10_map = {p["date"]: p["value"] for p in dfii10}
        dfii20_map = {p["date"]: p["value"] for p in dfii20}
        dfii30_map = {p["date"]: p["value"] for p in dfii30}

        t5y_dates = {p["date"] for p in t5yie}
        t10y_dates = {p["date"] for p in t10yie}
        dates = sorted(t5y_dates & t10y_dates)
        latest_date = dates[-1] if dates else None

        dev_points = []
        dev_arr = []
        for d in dates:
            be = t10y_map.get(d)
            if be is not None:
                dev = be - FED_TARGET
                dev_points.append({"date": d, "value": dev})
                dev_arr.append(dev)
        last_dev = dev_arr[-1] if dev_arr else None

        z_arr = [None] * len(dates)
        z_map = {}
        for i in range(252, len(dev_points)):
            z = z_score(dev_arr[i - 252:i], dev_arr[i])
            z_arr[i] = round(z, 2)
            z_map[dev_points[i]["date"]] = z

        z_score_val = round(z_score(dev_arr[-252:], last_dev or 0), 2) if len(dev_arr) > 252 else None
        percentile_1y = (
            round(percentile_rank(dev_arr[-252:], last_dev or 0), 1)
            if len(dev_arr) > 252 else None
        )
        percentile_5y = (
            round(percentile_rank(dev_arr[-1260:], last_dev or 0), 1)
            if len(dev_arr) > 1260 else None
        )

        if last_dev is not None:
            abs_dev = abs(last_dev)
            if abs_dev < 0.3:
                anchor_status = "anchored"
                anchor_desc = "通胀预期锚定在联储2%目标附近"
            elif abs_dev < 0.8:
                anchor_status = "drifting"
                anchor_desc = "通胀预期偏离目标，但仍可控"
            else:
                anchor_status = "deanchored"
                anchor_desc = "通胀预期显著偏离目标"
        else:
            anchor_status = "anchored"
            anchor_desc = ""

        def pair_diff(a_map, b_map):
            return [
                round(a_map[d] - b_map[d], 3) if a_map.get(d) is not None and b_map.get(d) is not None else None
                for d in dates
            ]

        slope_arr = pair_diff(t10y_map, t5y_map)
        fwd_arr = [
            round(2 * t10y_map[d] - t5y_map[d], 3) if t10y_map.get(d) is not None and t5y_map.get(d) is not None else None
            for d in dates
        ]
        cur_5y = t5y_map.get(latest_date)
        cur_10y = t10y_map.get(latest_date)
        slope_5y10y = round(cur_10y - cur_5y, 3) if cur_5y is not None and cur_10y is not None else None
        fwd_5y5y = round(2 * cur_10y - cur_5y, 3) if cur_5y is not None and cur_10y is not None else None

        ry_tenors = ["5Y", "10Y", "20Y", "30Y"]
        ry_rows = [dfii5, dfii10, dfii20, dfii30]
        ry_date_sets = [{p["date"] for p in r} for r in ry_rows]
        ry_dates = sorted(ry_date_sets[0] & ry_date_sets[1] & ry_date_sets[2] & ry_date_sets[3])
        ry_series_data = []
        for r in ry_rows:
            m = {p["date"]: p["value"] for p in r}
            ry_series_data.append([m.get(d) for d in ry_dates])
        ry_values = [s[-1] if s else None for s in ry_series_data] if ry_dates else [None] * 4
        ry_latest_date = ry_dates[-1] if ry_dates else None

        cpi_monthly = {}
        cpi_month_list = []
        for r in cpi_rows:
            mk = _to_date(r["period_date"])[:7]
            cpi_monthly[mk] = float(r["value"])
            cpi_month_list.append(mk)
        cpi_month_list = sorted(set(cpi_month_list))
        cpi_yoy_by_month = {}
        for mk in cpi_month_list:
            year = int(mk[:4]) - 1
            pmk = f"{year}{mk[4:]}"
            prev = cpi_monthly.get(pmk)
            now = cpi_monthly.get(mk)
            if prev is not None and now is not None:
                cpi_yoy_by_month[mk] = round((now / prev - 1) * 100, 2)

        cpi_yoy_daily = {}
        last_yoy = None
        m_idx = 0
        for d in dates:
            mk = d[:7]
            while m_idx < len(cpi_month_list) and cpi_month_list[m_idx] <= mk:
                v = cpi_yoy_by_month.get(cpi_month_list[m_idx])
                if v is not None:
                    last_yoy = v
                m_idx += 1
            if last_yoy is not None:
                cpi_yoy_daily[d] = last_yoy

        cpi_yoy_arr = [cpi_yoy_daily.get(d) for d in dates]
        gap_arr = [
            round(t10y_map[d] - cpi_yoy_arr[i], 3)
            if t10y_map.get(d) is not None and cpi_yoy_arr[i] is not None else None
            for i, d in enumerate(dates)
        ]
        current_gap = gap_arr[-1] if gap_arr else None

        be10_arr = [t10y_map.get(d) for d in dates]

        def chg(lookback):
            i = len(be10_arr) - 1 - lookback
            if i < 0 or be10_arr[-1] is None or be10_arr[i] is None:
                return None
            return round(be10_arr[-1] - be10_arr[i], 3)

        momentum = {"chg1m": chg(21), "chg3m": chg(63), "chg1y": chg(252)}

        sp_dates = [p["date"] for p in sp500]
        sp_map = {p["date"]: p["value"] for p in sp500}
        forward_returns = _calc_fwd(dev_points, sp_dates, sp_map)

        gold_dates = [p["date"] for p in gold]
        gold_map = {p["date"]: p["value"] for p in gold}

        events = []
        run_start = -1
        peak_idx = -1
        peak_abs = float("-inf")

        def flush(end_idx):
            nonlocal run_start, peak_idx, peak_abs
            if run_start < 0:
                return
            if peak_idx >= 0:
                ev = dev_points[peak_idx]
                events.append({
                    "date": ev["date"],
                    "peakDeviation": round(ev["value"], 2),
                    "z": round(z_map[ev["date"]], 2) if ev["date"] in z_map else None,
                    "ret3m": _forward_return(sp_dates, sp_map, ev["date"], 60),
                    "ret6m": _forward_return(sp_dates, sp_map, ev["date"], 120),
                    "ret12m": _forward_return(sp_dates, sp_map, ev["date"], 240),
                    "goldRet3m": _forward_return(gold_dates, gold_map, ev["date"], 60),
                    "goldRet6m": _forward_return(gold_dates, gold_map, ev["date"], 120),
                    "goldRet12m": _forward_return(gold_dates, gold_map, ev["date"], 240),
                })
            run_start = -1
            peak_idx = -1
            peak_abs = float("-inf")

        for i, p in enumerate(dev_points):
            av = abs(p["value"])
            if av >= 0.8:
                if run_start < 0:
                    run_start = i
                if av > peak_abs:
                    peak_abs = av
                    peak_idx = i
            else:
                flush(i)
        flush(len(dev_points))
        recent_events = events[-6:]

        direction = "neutral"
        strength = "weak"
        confidence = 50
        evidence = []

        if last_dev is not None:
            if last_dev > 0.5:
                direction = "hawkish"
                evidence.append(f"10Y通胀预期高于联储目标 {last_dev:.2f}%")
            elif last_dev < -0.5:
                direction = "dovish"
                evidence.append(f"10Y通胀预期低于联储目标 {abs(last_dev):.2f}%")
            else:
                evidence.append(f"10Y通胀预期接近联储目标（{cur_10y:.2f}%）" if cur_10y is not None else "10Y通胀预期接近联储目标")

        if anchor_status == "deanchored":
            strength = "strong"
            confidence = 80
        elif anchor_status == "drifting":
            strength = "moderate"
            confidence = 65

        if z_score_val is not None:
            p1y = f"{percentile_1y:.0f}%" if percentile_1y is not None else "--"
            evidence.append(f"10Y 偏差滚动 Z-Score {z_score_val:.2f}（1 年分位 {p1y}）")
            if abs(z_score_val) >= 2:
                evidence.append("Z-Score 偏离超过 2σ，偏差脱离常态分布区间")
            elif abs(z_score_val) >= 1:
                evidence.append("Z-Score 偏离超过 1σ，偏差接近常态区间边缘")

        if fwd_5y5y is not None:
            evidence.append(f"5Y5Y 远期通胀预期 {fwd_5y5y:.2f}%（2×10Y−5Y 换算）")
        if slope_5y10y is not None:
            sign = "+" if slope_5y10y >= 0 else ""
            direction_desc = "更高" if slope_5y10y >= 0 else "更低"
            evidence.append(f"5Y-10Y 期限斜率 {sign}{slope_5y10y:.2f}%（长端预期{direction_desc}）")
        if current_gap is not None:
            evidence.append(f"10Y 预期高于已实现 CPI YoY {current_gap:.2f}%（通胀预期溢价）")
        if momentum["chg1m"] is not None:
            sign = "+" if momentum["chg1m"] >= 0 else ""
            evidence.append(f"10Y 盈亏平衡近 1 月变动 {sign}{momentum['chg1m']:.2f}%")
        if recent_events:
            evidence.append(
                f"近 10 年出现 {len(events)} 次脱锚事件（|偏差|≥0.8%，最近峰值 {recent_events[-1]['peakDeviation']:.2f}%）"
            )

        data = {
            "breakevenHistory": {
                "dates": dates,
                "series": [
                    {"name": "5Y", "tenor": "5Y", "data": [t5y_map.get(d) for d in dates]},
                    {"name": "10Y", "tenor": "10Y", "data": [t10y_map.get(d) for d in dates]},
                ],
            },
            "anchorDeviation": {
                "currentDeviation10y": round(last_dev, 3) if last_dev is not None else None,
                "zScore": round(z_score_val, 2) if z_score_val is not None else None,
                "percentile1y": round(percentile_1y, 1) if percentile_1y is not None else None,
                "percentile5y": round(percentile_5y, 1) if percentile_5y is not None else None,
                "anchorStatus": anchor_status,
                "anchorDesc": anchor_desc,
            },
            "termStructure": {"slope5y10y": slope_5y10y, "fwd5y5y": fwd_5y5y},
            "termHistory": {
                "dates": dates,
                "series": [
                    {"name": "5Y-10Y 斜率", "data": slope_arr},
                    {"name": "5Y5Y 远期", "data": fwd_arr},
                ],
            },
            "realYieldCurve": {"tenors": ry_tenors, "values": ry_values},
            "realYieldHistory": {
                "dates": ry_dates,
                "series": [
                    {"name": f"{tn} 实际利率", "data": ry_series_data[i]}
                    for i, tn in enumerate(ry_tenors)
                ],
            },
            "zScoreHistory": {"dates": dates, "data": z_arr},
            "inflationGap": {
                "dates": dates,
                "breakeven10y": be10_arr,
                "cpiYoy": cpi_yoy_arr,
                "gap": gap_arr,
                "currentGap": current_gap,
            },
            "momentum": momentum,
            "forwardReturns": forward_returns,
            "deAnchoringEvents": recent_events,
            "currentSnapshot": {
                "breakeven5y": cur_5y,
                "breakeven10y": cur_10y,
                "realYield5y": dfii5_map.get(ry_latest_date) if ry_latest_date else None,
                "realYield10y": dfii10_map.get(ry_latest_date) if ry_latest_date else None,
                "realYield20y": dfii20_map.get(ry_latest_date) if ry_latest_date else None,
                "realYield30y": dfii30_map.get(ry_latest_date) if ry_latest_date else None,
                "fedTargetPct": FED_TARGET,
            },
            "signal": {"direction": direction, "strength": strength, "confidence": confidence, "evidence": evidence},
            "updatedAt": datetime.utcnow().strftime("%Y-%m-%d"),
        }

        valid_from = latest_date or datetime.utcnow().strftime("%Y-%m-%d")
        upsert_analysis_result(conn, ENDPOINT, valid_from, data)
        log.info("写入 analysis_results[%s]: valid_from=%s", ENDPOINT, valid_from)
        write_sync_log("analysis_inflation_anchor", "success", 1, "", ENDPOINT)


def main():
    log.info("=" * 60)
    log.info("开始同步: 通胀预期锚定分析")
    sync()


if __name__ == "__main__":
    main()
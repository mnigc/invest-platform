#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预计算：信用-利率交叉压力（API: /api/v1/analysis/credit-stress.json）"""
from datetime import datetime, timedelta

from sync_base import _setup_logger, get_conn, write_sync_log, upsert_analysis_result
from analysis import mean, z_score, percentile_rank, quantile, rolling_corr


ENDPOINT = "analysis/credit-stress"
HORIZON = 10 * 365

INDICATORS = ["BAMLC0A4CBBB", "BAMLH0A0HYM2", "BAMLC0A1CAAA", "DGS10", "DGS2"]
SP500_SYMBOL = "^GSPC"
HORIZONS = [(20, 60), (60, 120), (120, 180), (240, 365)]  # (days, return label)

log = _setup_logger("sync_credit_stress")


def _to_date(v):
    return str(v)[:10]


def _add_days(date_str, days):
    d = datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=days)
    return d.strftime("%Y-%m-%d")


def _load_indicator(conn, code, horizon):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT d.period_date, d.value
            FROM indicator_data d
            JOIN indicators i ON i.id = d.indicator_id
            WHERE i.code = %s AND i.region = 'US'
              AND d.value IS NOT NULL
            ORDER BY d.period_date DESC
            LIMIT %s
            """,
            (code, horizon),
        )
        rows = cur.fetchall()
    return [
        {"date": _to_date(r["period_date"]), "value": float(r["value"])}
        for r in reversed(rows)
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


def _calc_stats(vals):
    if not vals:
        return {"avg": 0, "winRate": 0}
    return {
        "avg": mean(vals),
        "winRate": sum(1 for v in vals if v > 0) / len(vals),
    }


def _calculate_forward_returns(points, price_map):
    ranges = [
        (float("-inf"), 1.2, "利差 < 1.2%"),
        (1.2, 1.8, "1.2% ~ 1.8%"),
        (1.8, float("inf"), "利差 > 1.8%"),
    ]
    sorted_prices = sorted(price_map.items())
    results = []
    for lo, hi, label in ranges:
        in_range = [
            p for p in points
            if (p["value"] > lo if hi == float("inf") else lo <= p["value"] < hi)
        ]
        buckets = {20: [], 60: [], 120: [], 240: []}
        for p in in_range:
            base = price_map.get(p["date"])
            if base is None or base <= 0:
                continue
            for days in (20, 60, 120, 240):
                target = _add_days(p["date"], days)
                tp = None
                for d, v in sorted_prices:
                    if d >= target:
                        tp = v
                        break
                if tp is not None:
                    buckets[days].append((tp / base - 1) * 100)
        stats = {k: _calc_stats(v) for k, v in buckets.items()}
        results.append({
            "spreadRange": label,
            "avgReturn1m": round(stats[20]["avg"], 2),
            "avgReturn3m": round(stats[60]["avg"], 2),
            "avgReturn6m": round(stats[120]["avg"], 2),
            "avgReturn12m": round(stats[240]["avg"], 2),
            "winRate1m": round(stats[20]["winRate"], 2),
            "winRate3m": round(stats[60]["winRate"], 2),
            "winRate6m": round(stats[120]["winRate"], 2),
            "winRate12m": round(stats[240]["winRate"], 2),
            "sampleSize": len(in_range),
        })
    return results




def sync():
    with get_conn() as conn:
        bbb = _load_indicator(conn, "BAMLC0A4CBBB", HORIZON)
        hy = _load_indicator(conn, "BAMLH0A0HYM2", HORIZON)
        aaa = _load_indicator(conn, "BAMLC0A1CAAA", HORIZON)
        t10y = _load_indicator(conn, "DGS10", HORIZON)
        t2y = _load_indicator(conn, "DGS2", HORIZON)
        sp500 = _load_sp500(conn, HORIZON)

        bbb_map = {p["date"]: p["value"] for p in bbb}
        hy_map = {p["date"]: p["value"] for p in hy}
        aaa_map = {p["date"]: p["value"] for p in aaa}
        t10y_map = {p["date"]: p["value"] for p in t10y}
        t2y_map = {p["date"]: p["value"] for p in t2y}

        bbb_dates = {p["date"] for p in bbb}
        hy_dates = {p["date"] for p in hy}
        t10y_dates = {p["date"] for p in t10y}
        all_dates = sorted(bbb_dates & hy_dates & t10y_dates)
        if len(all_dates) < 2:
            raise RuntimeError("信用利差数据不足")

        latest_date = all_dates[-1]

        spread_series = []
        hy_series = []
        wedge_series = []
        t10y_series = []
        credit_spreads = []
        for d in all_dates:
            s = bbb_map.get(d)
            h = hy_map.get(d)
            t = t10y_map.get(d)
            spread_series.append(s)
            hy_series.append(h)
            t10y_series.append(t)
            wedge_series.append(round(h - s, 3) if s is not None and h is not None else None)
            if s is not None:
                credit_spreads.append(s)

        current_bbb = bbb_map.get(latest_date)
        current_hy = hy_map.get(latest_date)
        current_aaa = aaa_map.get(latest_date)
        wedge = round(current_hy - current_bbb, 3) if current_bbb is not None and current_hy is not None else None
        spread_z = round(z_score(credit_spreads[-252:], current_bbb or 0), 2) if len(credit_spreads) > 252 else None
        percentile_5y = (
            round(percentile_rank(credit_spreads[-1260:], current_bbb or 0), 3)
            if len(credit_spreads) >= 252 else None
        )

        sorted_spreads = sorted(credit_spreads)
        median_spread = round(quantile(sorted_spreads, 0.5), 3) if sorted_spreads else None
        p90_spread = round(quantile(sorted_spreads, 0.9), 3) if sorted_spreads else None

        credit_stress = (
            round(max(0, min(1, (current_bbb - 1.0) / 2)), 3)
            if current_bbb is not None else None
        )
        t10y_v = t10y_map.get(latest_date)
        t2y_v = t2y_map.get(latest_date)
        spread10y2y = t10y_v - t2y_v if t10y_v is not None and t2y_v is not None else None
        rate_stress = (
            round(max(0, min(1, (-spread10y2y + 1) / 2)), 3)
            if spread10y2y is not None else None
        )
        combined_index = (
            round((credit_stress + rate_stress) / 2, 3)
            if credit_stress is not None and rate_stress is not None else None
        )

        if combined_index is not None:
            if combined_index > 0.7:
                status = "high_stress"
                status_desc = "信用-利率复合压力达到警戒水平"
            elif combined_index > 0.4:
                status = "elevated"
                status_desc = "复合压力偏高，需持续关注"
            else:
                status = "normal"
                status_desc = "信用与利率环境相对平稳"
        else:
            status = "normal"
            status_desc = ""

        bbb_points = [{"date": d, "value": bbb_map.get(d)} for d in all_dates]
        t10y_points = [{"date": d, "value": t10y_map.get(d)} for d in all_dates]

        def diff_series(pts):
            out = []
            for i, p in enumerate(pts):
                v = float("nan")
                if i > 0:
                    pv = pts[i - 1]["value"]
                    if (
                        p["value"] is not None and pv is not None
                        and isinstance(p["value"], (int, float))
                        and isinstance(pv, (int, float))
                    ):
                        v = p["value"] - pv
                out.append({"date": p["date"], "value": v})
            return out

        bbb_diff = diff_series(bbb_points)
        t10y_diff = diff_series(t10y_points)
        rc120 = rolling_corr(bbb_diff, t10y_diff, 120)
        corr_val = rc120[-1]["value"] if rc120 else None

        def rolling_aligned(win):
            rc = rolling_corr(bbb_diff, t10y_diff, win)
            rc_map = {p["date"]: p["value"] for p in rc}
            return [rc_map.get(d) for d in all_dates]

        corr_history = {
            "dates": all_dates,
            "series": [
                {"name": f"{win}日", "data": rolling_aligned(win)}
                for win in (60, 120)
            ],
        }

        price_map = {p["date"]: p["value"] for p in sp500}

        raw_points = [
            {"date": all_dates[i], "value": spread_series[i]}
            for i in range(len(all_dates)) if spread_series[i] is not None
        ]

        stress_events = []
        if p90_spread is not None:
            run_start = -1
            peak_idx = -1
            peak_val = float("-inf")
            sorted_prices = sorted(price_map.items())

            def flush(end_idx):
                nonlocal run_start, peak_idx, peak_val
                if run_start < 0:
                    return
                if peak_idx >= 0:
                    ev_date = raw_points[peak_idx]["date"]
                    base = price_map.get(ev_date)
                    if base is not None and base > 0:
                        rets = []
                        for days in (60, 120, 240):
                            target = _add_days(ev_date, days)
                            tp = None
                            for d, v in sorted_prices:
                                if d >= target:
                                    tp = v
                                    break
                            rets.append(round((tp / base - 1) * 100, 2) if tp is not None else None)
                    else:
                        rets = [None, None, None]
                    stress_events.append({
                        "date": ev_date,
                        "peakSpread": round(peak_val, 3),
                        "ret3m": rets[0], "ret6m": rets[1], "ret12m": rets[2],
                    })
                run_start = -1
                peak_idx = -1
                peak_val = float("-inf")

            for i, p in enumerate(raw_points):
                if p["value"] >= p90_spread:
                    if run_start < 0:
                        run_start = i
                    if p["value"] > peak_val:
                        peak_val = p["value"]
                        peak_idx = i
                else:
                    flush(i)
            flush(len(raw_points))

        recent_events = stress_events[-6:]

        evidence = []
        if current_bbb is not None:
            evidence.append(f"BBB信用利差当前 {current_bbb:.2f}%")
        if current_hy is not None:
            evidence.append(f"HY OAS当前 {current_hy:.2f}%")
        if wedge is not None:
            evidence.append(f"BBB-HY溢价（信用溢价）{wedge:.2f}%")
        if percentile_5y is not None:
            # percentile_5y 已是 0-100（percentile_rank 返回值），不要再 *100
            evidence.append(f"BBB利差处于 5 年约 {percentile_5y:.0f}% 分位")
        if corr_val is not None and corr_val < -0.3:
            evidence.append(f"信用利差与利率变化负相关 {corr_val:.2f}")
        if spread10y2y is not None and spread10y2y < 0:
            evidence.append(f"收益率曲线倒挂 {spread10y2y:.2f}%")
        if recent_events:
            evidence.append(
                f"近10年曾 {len(stress_events)} 次进入高压力区间（峰值利差 {recent_events[-1]['peakSpread']:.2f}%）"
            )

        forward_returns = _calculate_forward_returns(raw_points, price_map)

        data = {
            "spreadHistory": {
                "dates": all_dates,
                "series": [
                    {"name": "BBB信用利差", "data": spread_series},
                    {"name": "HY OAS", "data": hy_series},
                    {"name": "BBB-HY溢价", "data": wedge_series},
                ],
            },
            "corrHistory": corr_history,
            "combinedStress": {
                "creditStress": round(credit_stress, 3) if credit_stress is not None else None,
                "rateStress": round(rate_stress, 3) if rate_stress is not None else None,
                "combinedIndex": combined_index,
                "status": status,
                "statusDesc": status_desc,
            },
            "currentSpread": {
                "bbbSpread": current_bbb,
                "hyOas": current_hy,
                "aaaSpread": current_aaa,
                "wedge": wedge,
                "spreadZScore": round(spread_z, 2) if spread_z is not None else None,
                "percentile5y": round(percentile_5y, 3) if percentile_5y is not None else None,
            },
            "forwardReturns": forward_returns,
            "stressEvents": recent_events,
            "thresholds": {
                "median": median_spread,
                "p90": p90_spread,
            },
            "rateCreditCorr": round(corr_val, 3) if corr_val is not None else None,
            "signal": {
                "direction": "risk_off" if combined_index is not None and combined_index > 0.5 else "neutral",
                "strength": "strong" if combined_index is not None and combined_index > 0.7 else "moderate",
                "confidence": 70 if combined_index is not None else 50,
                "evidence": evidence,
            },
            "updatedAt": datetime.utcnow().strftime("%Y-%m-%d"),
        }

        valid_from = latest_date
        upsert_analysis_result(conn, ENDPOINT, valid_from, data)
        log.info("写入 analysis_results[%s]: valid_from=%s", ENDPOINT, valid_from)
        write_sync_log("analysis_credit_stress", "success", 1, "", ENDPOINT)


def main():
    log.info("=" * 60)
    log.info("开始同步: 信用-利率交叉压力")
    sync()


if __name__ == "__main__":
    main()
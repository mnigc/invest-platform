#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预计算：收益率曲线×宏观体制（API: /api/v1/analysis/yield-curve-regime.json）"""
from datetime import datetime, timedelta

from sync_base import _setup_logger, get_conn, write_sync_log, upsert_analysis_result
from analysis import mean, z_score, percentile_rank


ENDPOINT = "analysis/yield-curve-regime"
HORIZON = 5 * 365
SP500_SYMBOL = "^GSPC"

# 前瞻收益回测的指数池：(symbol, 中文名)。与 sync_indexes.py / regime 回测对齐。
INDEXES = [
    ("^GSPC", "标普500指数"),
    ("^IXIC", "纳斯达克综合指数"),
    ("^DJI", "道琼斯工业平均"),
    ("^RUT", "罗素2000"),
]

# 曲线形态 → (direction, strength, confidence)。
# 注意 direction 用 bullish/bearish/neutral —— 这是 /signal-board 的
# dirFromSignal 唯一能识别的值域，与 currentSpread.signal
# （strong_warning/buy 等描述性取值）刻意区分开。
SIGNAL_MAP = {
    "strong_warning": ("bearish", "strong", 80),
    "warning": ("bearish", "moderate", 65),
    "strong_buy": ("bullish", "strong", 75),
    "buy": ("bullish", "moderate", 60),
    "neutral": ("neutral", "weak", 40),
}

log = _setup_logger("sync_yield_curve")


def _to_date(v):
    return str(v)[:10]


def _add_days(s, n):
    return (datetime.strptime(s, "%Y-%m-%d") + timedelta(days=n)).strftime("%Y-%m-%d")


def _load(conn, sql, params=()):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def _load_indicator(conn, code, horizon):
    rows = _load(conn, """
        SELECT d.period_date, d.value
        FROM indicator_data d
        JOIN indicators i ON i.id = d.indicator_id
        WHERE i.code = %s AND i.region = 'US'
          AND d.value IS NOT NULL
        ORDER BY d.period_date DESC
        LIMIT %s
    """, (code, horizon))
    return [
        {"date": _to_date(r["period_date"]), "value": float(r["value"])}
        for r in reversed(rows)
    ]


def _load_index(conn, symbol, horizon):
    rows = _load(conn, """
        SELECT p.trade_date, p.close_price
        FROM asset_prices p
        JOIN assets a ON a.id = p.asset_id
        WHERE a.symbol = %s AND p.close_price IS NOT NULL
        ORDER BY p.trade_date DESC
        LIMIT %s
    """, (symbol, horizon))
    return [
        {"date": _to_date(r["trade_date"]), "value": float(r["close_price"])}
        for r in reversed(rows)
    ]


def _load_regime(conn, horizon):
    rows = _load(conn, """
        SELECT snapshot_date, regime FROM regime_snapshots
        ORDER BY snapshot_date DESC
        LIMIT %s
    """, (horizon,))
    return [
        {"date": _to_date(r["snapshot_date"]), "regime": r["regime"]}
        for r in reversed(rows)
    ]


def _shape_of(spread):
    if spread > 0.5:
        return "steep"
    if spread > 0.1:
        return "normal"
    if spread > -0.1:
        return "flat"
    return "inverted"


def _detect_transitions(dates, regimes):
    out = []
    for i in range(1, len(dates)):
        if regimes[i] != regimes[i - 1]:
            out.append({
                "fromRegime": regimes[i - 1],
                "toRegime": regimes[i],
                "date": dates[i],
            })
    return out


def _inversion_periods(spread_history):
    """spread10y2y < 0 的连续区间。遇到 None 或值 >=0 即结束一段。
    返回 [{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}]。"""
    periods = []
    start = None
    for p in spread_history:
        v = p["spread10y2y"]
        if v is not None and v < 0:
            if start is None:
                start = p["date"]
            end = p["date"]
        else:
            if start is not None:
                periods.append({"start": start, "end": end})
                start = None
    if start is not None:
        periods.append({"start": start, "end": end})
    return periods


def _calc_forward(spread_history, price_history):
    ranges = [
        (float("-inf"), -0.2, "倒挂 (< -0.2%)"),
        (-0.2, 0.2, "平坦 (-0.2% ~ 0.2%)"),
        (0.2, 0.5, "正常 (0.2% ~ 0.5%)"),
        (0.5, float("inf"), "陡峭 (> 0.5%)"),
    ]
    price_map = {p["date"]: p["value"] for p in price_history}
    sorted_prices = sorted(price_map.items())
    out = []
    for lo, hi, label in ranges:
        points = [
            p for p in spread_history if p["spread10y2y"] is not None
            and (p["spread10y2y"] > lo if hi == float("inf") else lo <= p["spread10y2y"] < hi)
        ]
        buckets = {20: [], 60: [], 120: [], 240: []}
        for pt in points:
            base = price_map.get(pt["date"])
            if base is None:
                continue
            for d in buckets:
                tgt = _add_days(pt["date"], d)
                tp = None
                for ds, v in sorted_prices:
                    if ds >= tgt:
                        tp = v
                        break
                if tp is not None and base > 0:
                    buckets[d].append((tp / base - 1) * 100)

        def stats(arr):
            if not arr:
                return {"avg": 0, "winRate": 0}
            return {"avg": mean(arr), "winRate": sum(1 for v in arr if v > 0) / len(arr)}

        s = {k: stats(v) for k, v in buckets.items()}
        out.append({
            "spreadRange": label,
            "avgReturn1m": round(s[20]["avg"], 2),
            "avgReturn3m": round(s[60]["avg"], 2),
            "avgReturn6m": round(s[120]["avg"], 2),
            "avgReturn12m": round(s[240]["avg"], 2),
            "winRate1m": round(s[20]["winRate"], 2),
            "winRate3m": round(s[60]["winRate"], 2),
            "winRate6m": round(s[120]["winRate"], 2),
            "winRate12m": round(s[240]["winRate"], 2),
            "sampleSize": len(points),
        })
    return out


def _build_signal(signal, signal_desc, latest_spread, inversion_months,
                  percentile_1y, percentile_5y, forward_returns):
    """构造供信号板聚合的顶层 signal。"""
    direction, strength, confidence = SIGNAL_MAP.get(
        signal, ("neutral", "weak", 40)
    )

    evidence = [signal_desc]
    if latest_spread is not None:
        evidence.append(f"10Y-2Y 利差 {latest_spread:.2f}%")
    if inversion_months:
        evidence.append(f"倒挂已持续约 {inversion_months} 个月")
    # percentile_* 已是 0-100（与 analysis.percentile_rank 一致），直接输出
    if percentile_1y is not None:
        evidence.append(f"利差处于 1 年 {percentile_1y:.0f}% 分位")
    if percentile_5y is not None:
        evidence.append(f"利差处于 5 年 {percentile_5y:.0f}% 分位")

    for prefix in ("倒挂", "陡峭"):
        bucket = next(
            (b for b in forward_returns
             if b["spreadRange"].startswith(prefix) and b["sampleSize"] > 0),
            None,
        )
        if bucket:
            evidence.append(
                f"曲线{prefix}时 S&P500 未来 3M 均值 {bucket['avgReturn3m']:.2f}%"
                f"（{bucket['sampleSize']} 个样本）"
            )

    return {
        "id": "yield-curve-regime",
        "module": "yield-curve",
        "title": "收益率曲线 × 宏观体制",
        "direction": direction,
        "strength": strength,
        "confidence": confidence,
        "evidence": evidence,
        "updatedAt": datetime.utcnow().strftime("%Y-%m-%d"),
    }


def sync():
    with get_conn() as conn:
        spread_series = _load_indicator(conn, "T10Y2Y", HORIZON)
        dgs2 = _load_indicator(conn, "DGS2", HORIZON)
        dgs10 = _load_indicator(conn, "DGS10", HORIZON)
        dgs3m = _load_indicator(conn, "DGS3MO", HORIZON)
        dgs30 = _load_indicator(conn, "DGS30", HORIZON)
        regime_snaps = _load_regime(conn, HORIZON)

        spread_history = [
            {
                "date": p["date"],
                "spread10y2y": p["value"],
                "spread10y3m": None,
                "shape": _shape_of(p["value"]),
            }
            for p in spread_series
        ]

        dates = sorted({
            *[p["date"] for p in spread_series],
            *[p["date"] for p in dgs2],
            *[p["date"] for p in dgs10],
            *[p["date"] for p in dgs3m],
            *[p["date"] for p in dgs30],
        })

        dgs2_map = {p["date"]: p["value"] for p in dgs2}
        dgs10_map = {p["date"]: p["value"] for p in dgs10}
        dgs3m_map = {p["date"]: p["value"] for p in dgs3m}
        dgs30_map = {p["date"]: p["value"] for p in dgs30}

        curve_history = {
            "dates": dates,
            "tenors": [
                {"name": "3M", "data": [dgs3m_map.get(d) for d in dates]},
                {"name": "2Y", "data": [dgs2_map.get(d) for d in dates]},
                {"name": "10Y", "data": [dgs10_map.get(d) for d in dates]},
                {"name": "30Y", "data": [dgs30_map.get(d) for d in dates]},
            ],
        }

        spread_time_map = {
            s["date"]: s["spread10y2y"] for s in spread_history if s["spread10y2y"] is not None
        }

        regime_transitions = _detect_transitions(
            [r["date"] for r in regime_snaps],
            [r["regime"] for r in regime_snaps],
        )
        for t in regime_transitions:
            t["spreadAtTransition"] = spread_time_map.get(t["date"])

        spread_values = [s["spread10y2y"] for s in spread_history if s["spread10y2y"] is not None]
        latest_spread = spread_values[-1] if spread_values else None
        spread_1y = spread_values[-252:]
        spread_5y = spread_values[-1260:]

        percentile_1y = round(percentile_rank(spread_1y, latest_spread or 0), 1) if spread_values else None
        percentile_5y = round(percentile_rank(spread_5y, latest_spread or 0), 1) if spread_values else None
        z_score_val = round(z_score(spread_values[-252:], latest_spread or 0), 2) if len(spread_values) > 60 else None

        inversion_months = 0
        if spread_values:
            cnt = 0
            for v in reversed(spread_values):
                if v < 0:
                    cnt += 1
                else:
                    break
            inversion_months = round(cnt / 21)

        if inversion_months >= 6 and latest_spread is not None and latest_spread < -0.3:
            signal = "strong_warning"
            signal_desc = "深度倒挂超过6个月，历史上高度预示衰退"
        elif inversion_months >= 3:
            signal = "warning"
            signal_desc = "倒挂持续3个月以上，需要关注衰退风险"
        elif latest_spread is not None and latest_spread > 1.0 and percentile_1y is not None and percentile_1y > 80:
            signal = "strong_buy"
            signal_desc = "曲线陡峭且处于高位，经济复苏信号强劲"
        elif latest_spread is not None and latest_spread > 0.5:
            signal = "buy"
            signal_desc = "曲线正常陡峭，经济扩张环境"
        else:
            signal = "neutral"
            signal_desc = "曲线形态中性"

        forward_returns_by_index = [
            {
                "symbol": sym,
                "nameZh": name,
                "buckets": _calc_forward(spread_history, _load_index(conn, sym, HORIZON)),
            }
            for sym, name in INDEXES
        ]
        # 顶层仍保留 S&P500 一套（供 signal evidence 与向后兼容）
        forward_returns = next(
            (f for f in forward_returns_by_index if f["symbol"] == SP500_SYMBOL),
            forward_returns_by_index[0],
        )["buckets"]
        inversion_periods = _inversion_periods(spread_history)

        data = {
            "curveHistory": curve_history,
            "spreadHistory": spread_history,
            "regimeTransitions": regime_transitions,
            "forwardReturns": forward_returns,
            "forwardReturnsByIndex": forward_returns_by_index,
            "inversionPeriods": inversion_periods,
            "signal": _build_signal(
                signal, signal_desc, latest_spread, inversion_months,
                percentile_1y, percentile_5y, forward_returns,
            ),
            "currentSpread": {
                "spread10y2y": latest_spread,
                "spread10y3m": None,
                "percentile1y": percentile_1y,
                "percentile5y": percentile_5y,
                "zScore": round(z_score_val, 2) if z_score_val is not None else None,
                "inversionMonths": inversion_months,
                "signal": signal,
                "signalDesc": signal_desc,
            },
            "updatedAt": datetime.utcnow().strftime("%Y-%m-%d"),
        }

        valid_from = spread_series[-1]["date"] if spread_series else datetime.utcnow().strftime("%Y-%m-%d")
        upsert_analysis_result(conn, ENDPOINT, valid_from, data)
        log.info("写入 analysis_results[%s]: valid_from=%s", ENDPOINT, valid_from)
        write_sync_log("analysis_yield_curve", "success", 1, "", ENDPOINT)


def main():
    log.info("=" * 60)
    log.info("开始同步: 收益率曲线×宏观体制")
    sync()


if __name__ == "__main__":
    main()
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预计算：宏观信号一致性评分（API: /api/v1/analysis/macro-consensus.json）"""
from datetime import datetime

from sync_base import _setup_logger, get_conn, write_sync_log, upsert_analysis_result
from analysis import mean, z_score, percentile_rank


ENDPOINT = "analysis/macro-consensus"
HORIZON = 365

INDICATORS = [
    ("FED_BALANCE_SHEET", "GLOBAL"),
    ("VIXCLS", "US"),
    ("DGS10", "US"),
    ("DGS2", "US"),
    ("T10YIE", "US"),
    ("BAMLC0A4CBBB", "US"),
    ("BAMLH0A0HYM2", "US"),
]

log = _setup_logger("sync_macro_consensus")


def _load_series(conn, codes_regions, horizon):
    out_map = {}
    with conn.cursor() as cur:
        for code, region in codes_regions:
            cur.execute(
                """
                SELECT d.period_date, d.value
                FROM indicator_data d
                JOIN indicators i ON i.id = d.indicator_id
                WHERE i.code = %s AND i.region = %s
                  AND d.value IS NOT NULL
                ORDER BY d.period_date DESC
                LIMIT %s
                """,
                (code, region, horizon),
            )
            rows = cur.fetchall()
            series = [
                {"date": str(r["period_date"])[:10], "value": float(r["value"])}
                for r in reversed(rows)
            ]
            out_map[(code, region)] = series
            log.info("  %s/%s: %d 条", code, region, len(series))
    return out_map


def _ffill(arr):
    last = None
    out = []
    for v in arr:
        if v is not None and isinstance(v, (int, float)):
            last = v
        out.append(last)
    return out


def _get_z(arr):
    valid = [v for v in arr if v is not None]
    if len(valid) < 63:
        return None
    last = valid[-1]
    window = valid[-252:]
    return round(z_score(window, last), 2)


def _rolling_z(arr):
    out = []
    window = []
    for v in arr:
        if v is not None and isinstance(v, (int, float)):
            window.append(v)
            if len(window) > 252:
                window.pop(0)
        if v is not None and isinstance(v, (int, float)) and len(window) >= 63:
            out.append(round(z_score(window, v), 2))
        else:
            out.append(None)
    return out


def _score_of(z, sign):
    if z is None:
        return None
    return round(max(0, min(100, 50 + sign * z * 15)))




def sync():
    with get_conn() as conn:
        series_map = _load_series(conn, INDICATORS, HORIZON)

        vix_dates = {p["date"] for p in series_map[("VIXCLS", "US")]}
        t10y_dates = {p["date"] for p in series_map[("DGS10", "US")]}
        all_dates = sorted(vix_dates & t10y_dates)

        maps = {k: {p["date"]: p["value"] for p in v} for k, v in series_map.items()}

        def get_arr(key):
            return [maps[key].get(d) for d in all_dates]

        liquidity_arr = _ffill(get_arr(("FED_BALANCE_SHEET", "GLOBAL")))
        vix_arr = _ffill(get_arr(("VIXCLS", "US")))
        t10y_arr = _ffill(get_arr(("DGS10", "US")))
        t2_arr = _ffill(get_arr(("DGS2", "US")))
        t10yie_arr = _ffill(get_arr(("T10YIE", "US")))
        bbb_arr = _ffill(get_arr(("BAMLC0A4CBBB", "US")))
        # hy_arr 仅用于完整性，原 TS 未用到 score，保留以备扩展

        spread10y2y = [
            round(v - t2_arr[i], 2) if v is not None and t2_arr[i] is not None else None
            for i, v in enumerate(t10y_arr)
        ]

        def last(arr):
            return arr[-1] if arr else None

        def direction(arr, threshold, above, below):
            v = last(arr)
            if v is None:
                return "unknown"
            if v > threshold:
                return above
            if v < threshold:
                return below
            return "normal"

        liquidity_mean = mean([v for v in liquidity_arr if v is not None])
        signals = [
            {
                "id": "liquidity", "name": "美联储资产负债表", "category": "liquidity",
                "current": last(liquidity_arr),
                "zScore": _get_z(liquidity_arr),
                "direction": "expansion" if last(liquidity_arr) is not None and last(liquidity_arr) > liquidity_mean else "contraction",
                "weight": 0.2,
            },
            {
                "id": "vix", "name": "VIX恐慌指数", "category": "risk",
                "current": last(vix_arr),
                "zScore": _get_z(vix_arr),
                "direction": direction(vix_arr, 20, "elevated", "calm"),
                "weight": 0.2,
            },
            {
                "id": "spread", "name": "10Y-2Y利差", "category": "growth",
                "current": last(spread10y2y),
                "zScore": _get_z(spread10y2y),
                "direction": direction(spread10y2y, 0, "normal", "inverted"),
                "weight": 0.25,
            },
            {
                "id": "inflation", "name": "10Y通胀预期", "category": "inflation",
                "current": last(t10yie_arr),
                "zScore": _get_z(t10yie_arr),
                "direction": direction(t10yie_arr, 2.5, "above_target", "anchored"),
                "weight": 0.2,
            },
            {
                "id": "credit", "name": "BBB信用利差", "category": "risk",
                "current": last(bbb_arr),
                "zScore": _get_z(bbb_arr),
                "direction": direction(bbb_arr, 1.5, "stress", "normal"),
                "weight": 0.15,
            },
        ]

        by_id = {s["id"]: s for s in signals}
        liquidity_score = by_id["liquidity"]["zScore"] or 0
        inflation_score = by_id["inflation"]["zScore"] or 0
        risk_score = by_id["vix"]["zScore"] or 0
        growth_score = by_id["spread"]["zScore"] or 0

        overall_raw = sum((s["zScore"] or 0) * s["weight"] for s in signals)
        overall_pct = round(max(0, min(100, 50 + overall_raw * 15)))

        if overall_pct > 70:
            direction_str = "bullish"
            strength = "strong" if overall_pct > 85 else "moderate"
        elif overall_pct < 30:
            direction_str = "bearish"
            strength = "strong" if overall_pct < 15 else "moderate"
        else:
            direction_str = "neutral"
            strength = "moderate"

        evidence = []
        sp_last = last(spread10y2y)
        if sp_last is not None and sp_last < 0:
            evidence.append("收益率曲线倒挂，衰退信号")
        v_last = last(vix_arr)
        if v_last is not None and v_last > 25:
            evidence.append("VIX偏高，市场恐慌情绪上升")
        ie_last = last(t10yie_arr)
        if ie_last is not None and ie_last > 2.5:
            evidence.append("通胀预期高于联储目标")

        liq_z = _rolling_z(liquidity_arr)
        risk_z = _rolling_z(vix_arr)
        growth_z = _rolling_z(spread10y2y)
        inf_z = _rolling_z(t10yie_arr)
        credit_z = _rolling_z(bbb_arr)

        overall_history = []
        for i in range(len(all_dates)):
            parts = [
                (liq_z[i], 0.2), (risk_z[i], 0.2), (growth_z[i], 0.25),
                (inf_z[i], 0.2), (credit_z[i], 0.15),
            ]
            parts = [(z, w) for z, w in parts if z is not None]
            if not parts:
                overall_history.append(None)
                continue
            sum_w = sum(w for _, w in parts)
            raw = sum(z * w for z, w in parts) / sum_w
            overall_history.append(round(max(0, min(100, 50 + raw * 15))))

        data = {
            "signals": signals,
            "consensusScore": {
                "overall": overall_pct,
                "growth": round(50 + growth_score * 15),
                "inflation": round(50 + inflation_score * 15),
                "risk": round(50 - risk_score * 15),
                "liquidity": round(50 + liquidity_score * 15),
                "direction": direction_str,
                "strength": strength,
                "confidence": 70,
            },
            "historicalConsensus": {
                "dates": all_dates,
                "overall": overall_history,
                "liquidity": [_score_of(z, 1) for z in liq_z],
                "inflation": [_score_of(z, 1) for z in inf_z],
                "risk": [_score_of(z, -1) for z in risk_z],
            },
            "signal": {
                "direction": direction_str,
                "strength": strength,
                "confidence": 70,
                "evidence": evidence,
            },
            "updatedAt": datetime.utcnow().strftime("%Y-%m-%d"),
        }

        valid_from = all_dates[-1] if all_dates else datetime.utcnow().strftime("%Y-%m-%d")
        upsert_analysis_result(conn, ENDPOINT, valid_from, data)
        log.info("写入 analysis_results[%s]: valid_from=%s", ENDPOINT, valid_from)
        write_sync_log("analysis_macro_consensus", "success", 1, "", ENDPOINT)


def main():
    log.info("=" * 60)
    log.info("开始同步: 宏观信号一致性评分")
    sync()


if __name__ == "__main__":
    main()
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预计算：跨资产相关性矩阵（API: /api/v1/analysis/cross-asset-correlation.json）

输出 payload 与原 endpoint data 字段字节级一致。
"""
import sys
from math import isfinite
from datetime import datetime

from sync_base import _setup_logger, get_conn, write_sync_log, upsert_analysis_result
from analysis import corr, align_by_date, rolling_corr


ENDPOINT = "analysis/cross-asset-correlation"
HORIZON = 365
WINDOW_SIZE = 63

INDICATORS = ["DGS10", "T10YIE", "DFII10", "BAMLC0A4CBBB", "BAMLH0A0HYM2", "VIXCLS"]
SERIES_NAMES = ["10Y国债", "通胀预期", "实际利率", "BBB利差", "HY利差", "VIX"]

PAIRS = [
    (0, 3, "国债-BBB利差"),
    (0, 4, "国债-HY利差"),
    (0, 5, "国债-VIX"),
    (3, 4, "BBB-HY利差"),
    (2, 5, "实际利率-VIX"),
    (1, 3, "通胀预期-BBB利差"),
]

log = _setup_logger("sync_cross_asset")


def _load_series(conn, codes, horizon):
    out_map = {}
    with conn.cursor() as cur:
        for code in codes:
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
            series = [
                {"date": str(r["period_date"])[:10], "value": float(r["value"])}
                for r in reversed(rows)
            ]
            out_map[code] = series
            log.info("  %s: %d 条", code, len(series))
    return out_map


def _diff_series(points):
    out = []
    for i, p in enumerate(points):
        v = float("nan")
        if i > 0:
            prev_v = points[i - 1]["value"]
            if (
                p["value"] is not None
                and prev_v is not None
                and isfinite(p["value"])
                and isfinite(prev_v)
            ):
                v = p["value"] - prev_v
        out.append({"date": p["date"], "value": v})
    return out


def _rolling_series(a, b, all_dates):
    rc = rolling_corr(a, b, WINDOW_SIZE)
    rc_map = {p["date"]: p["value"] for p in rc}
    out = []
    for d in all_dates:
        v = rc_map.get(d)
        out.append(round(v, 3) if v is not None else None)
    return out




def sync():
    with get_conn() as conn:
        series_map = _load_series(conn, INDICATORS, HORIZON)

        dgs10_dates = {p["date"] for p in series_map["DGS10"]}
        bbb_dates = {p["date"] for p in series_map["BAMLC0A4CBBB"]}
        all_dates = sorted(dgs10_dates & bbb_dates)

        series_maps = [{p["date"]: p["value"] for p in series_map[c]} for c in INDICATORS]
        series_data = [
            [m.get(d) for d in all_dates] for m in series_maps
        ]
        series_points = [
            [{"date": d, "value": m.get(d)} for d in all_dates] for m in series_maps
        ]
        diff_points = [_diff_series(pts) for pts in series_points]

        current_correlations = []
        for i, j, name in PAIRS:
            aligned = align_by_date(diff_points[i], diff_points[j])[-WINDOW_SIZE:]
            if len(aligned) > 21:
                c = corr([pt["a"] for pt in aligned], [pt["b"] for pt in aligned])
            else:
                c = 0
            if c > 0.3:
                status = "positive"
            elif c < -0.3:
                status = "negative"
            else:
                status = "neutral"
            current_correlations.append({
                "pair": name,
                "correlation": round(c, 3),
                "status": status,
            })

        correlation_history = {
            "dates": all_dates,
            "series": [
                {
                    "name": name,
                    "data": _rolling_series(diff_points[i], diff_points[j], all_dates),
                }
                for i, j, name in PAIRS
            ],
        }

        avg_abs = sum(abs(c["correlation"]) for c in current_correlations) / max(len(current_correlations), 1)
        diversification_score = round((1 - avg_abs) * 100)

        vix_corr = next((c for c in current_correlations if "VIX" in c["pair"]), None)
        if vix_corr and vix_corr["correlation"] < -0.3:
            regime = "flight_to_quality"
            regime_desc = "利率与VIX负相关增强，避险需求上升"
        elif vix_corr and vix_corr["correlation"] > 0.3:
            regime = "contagion"
            regime_desc = "利率与VIX同向波动，市场压力传导"
        else:
            regime = "normal_correlation"
            regime_desc = "跨资产相关性处于正常水平"

        evidence = []
        for c in current_correlations:
            if abs(c["correlation"]) > 0.3:
                evidence.append(f"{c['pair']} 相关系数 {c['correlation']:.3f}")
        if diversification_score > 60:
            evidence.append(f"分散化评分 {diversification_score}，资产配置效果较好")

        data = {
            "correlationMatrix": {
                "dates": all_dates,
                "series": [
                    {"name": SERIES_NAMES[i], "data": series_data[i]}
                    for i in range(len(INDICATORS))
                ],
            },
            "correlationHistory": correlation_history,
            "currentCorrelations": current_correlations,
            "regimeDetection": {
                "regime": regime,
                "regimeDesc": regime_desc,
                "confidence": 70,
            },
            "diversificationScore": diversification_score,
            "signal": {
                "direction": "risk_off" if regime == "flight_to_quality" else "neutral",
                "strength": "strong" if regime == "contagion" else "moderate",
                "confidence": 70,
                "evidence": evidence,
            },
            "updatedAt": datetime.utcnow().strftime("%Y-%m-%d"),
        }

        valid_from = all_dates[-1] if all_dates else datetime.utcnow().strftime("%Y-%m-%d")
        upsert_analysis_result(conn, ENDPOINT, valid_from, data)
        log.info("写入 analysis_results[%s]: valid_from=%s", ENDPOINT, valid_from)
        write_sync_log("analysis_cross_asset", "success", 1, "", ENDPOINT)


def main():
    log.info("=" * 60)
    log.info("开始同步: 跨资产相关性矩阵")
    sync()


if __name__ == "__main__":
    main()
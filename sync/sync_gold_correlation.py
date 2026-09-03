#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预计算：黄金定价残差 + 美元关联信号（API: /api/v1/gold/correlation.json）"""
from datetime import datetime

from sync_base import _setup_logger, get_conn, write_sync_log, upsert_analysis_result
from analysis import (
    mean as amean,
    corr as acorr,
    rolling_corr,
    log_returns,
    align_by_date,
    z_score,
    percentile_rank,
    event_study,
)


ENDPOINT = "gold/correlation"
HORIZON = 5 * 260
DXY_SYMBOL = "DX-Y.NYB"
DFII_CODE = "DFII10"
T10YIE_CODE = "T10YIE"

log = _setup_logger("sync_gold_correlation")


def _to_date(v):
    return str(v)[:10]


def _load(conn, sql, params=()):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def _load_gold(conn):
    rows = _load(conn, """
        SELECT price_date, close_price FROM gold_price_history
        WHERE source IN ('yfinance', 'gold-api', 'LOCAL-XLSX', 'FRED')
          AND currency = 'USD' AND unit = 'OZ'
        ORDER BY price_date ASC
    """)
    return [
        {"date": _to_date(r["price_date"]), "value": float(r["close_price"])}
        for r in rows
    ]


def _load_dxy(conn):
    rows = _load(conn, """
        SELECT p.trade_date, p.close_price
        FROM asset_prices p
        JOIN assets a ON a.id = p.asset_id
        WHERE a.symbol = %s AND p.close_price IS NOT NULL
        ORDER BY p.trade_date ASC
    """, (DXY_SYMBOL,))
    return [
        {"date": _to_date(r["trade_date"]), "value": float(r["close_price"])}
        for r in rows
    ]


def _load_indicator(conn, code):
    rows = _load(conn, """
        SELECT d.period_date, d.value
        FROM indicator_data d
        JOIN indicators i ON i.id = d.indicator_id
        WHERE i.code = %s AND i.region = 'US'
          AND d.value IS NOT NULL
        ORDER BY d.period_date ASC
    """, (code,))
    return [
        {"date": _to_date(r["period_date"]), "value": float(r["value"])}
        for r in rows
    ]


BAND_LABEL = {
    "inverse":   {"label": "正常负相关", "desc": "美元走弱利好黄金，经典范式生效"},
    "weakening": {"label": "相关性弱化", "desc": "负相关减弱，范式开始松动"},
    "broken":    {"label": "相关性失效", "desc": "负相关消失，黄金可能由其他因素定价（地缘/避险）"},
    "positive":  {"label": "正相关区间", "desc": "黄金与美元同涨同跌，极端联动范式"},
}


def _band_of(c):
    if c < -0.4:
        return "inverse"
    if c < -0.15:
        return "weakening"
    if c < 0.15:
        return "broken"
    return "positive"


def _band_switch_events(corr_series):
    out = []
    prev = None
    for p in corr_series:
        b = _band_of(p["value"])
        if prev is not None and b != prev:
            out.append({"date": p["date"], "from": prev, "to": b})
        prev = b
    return out


def _ols2(y, x1, x2):
    n = min(len(y), len(x1), len(x2))
    yy = list(y[-n:])
    xx1 = list(x1[-n:])
    xx2 = list(x2[-n:])
    my = amean(yy)
    m1 = amean(xx1)
    m2 = amean(xx2)
    s11 = s12 = s22 = sy1 = sy2 = 0.0
    for i in range(n):
        d1 = xx1[i] - m1
        d2 = xx2[i] - m2
        dy = yy[i] - my
        s11 += d1 * d1
        s12 += d1 * d2
        s22 += d2 * d2
        sy1 += dy * d1
        sy2 += dy * d2
    det = s11 * s22 - s12 * s12
    if abs(det) < 1e-12:
        return {"b0": my, "b1": 0, "b2": 0}
    b1 = (sy1 * s22 - sy2 * s12) / det
    b2 = (sy2 * s11 - sy1 * s12) / det
    b0 = my - b1 * m1 - b2 * m2
    return {"b0": b0, "b1": b1, "b2": b2}


def _build_residual_z(gold, dxy, dfii, horizon):
    from math import log as _log

    dxy_ret = log_returns(dxy)
    # 建索引：金价历史与 DXY 各约数千条，逐日线性扫描是 O(n·m)（约 1600 万次比较）。
    # 注：log_returns 首项 value 为 None，dict 取到 None 时同样保持 FFILL，语义与旧逻辑一致。
    dxy_ret_map = {r["date"]: r["value"] for r in dxy_ret}
    dfii_map = {p["date"]: p["value"] for p in dfii}

    cur_dxy_ret = None
    cur_dfii = None
    samples = []
    for p in gold:
        d = p["date"]
        # 当前 DXY 动量（FFILL）：找到该日期之前的最近 dxy_ret
        cand = dxy_ret_map.get(d)
        if cand is not None:
            cur_dxy_ret = cand
        elif not dxy_ret:
            cur_dxy_ret = None
        # DFII FFILL
        dfii_v = dfii_map.get(d)
        if dfii_v is not None:
            cur_dfii = dfii_v
        samples.append({
            "date": d,
            "y": _log(p["value"]) if p["value"] and p["value"] > 0 else None,
            "x1": cur_dfii,
            "x2": cur_dxy_ret,
        })

    complete = [s for s in samples if s["y"] is not None and s["x1"] is not None and s["x2"] is not None]
    tail = complete[-horizon:]
    if len(tail) < 60:
        return []

    coef = _ols2([s["y"] for s in tail], [s["x1"] for s in tail], [s["x2"] for s in tail])
    resid = [s["y"] - (coef["b0"] + coef["b1"] * s["x1"] + coef["b2"] * s["x2"]) for s in complete]

    out = []
    window = 250
    for i in range(len(resid)):
        start = max(0, i - window)
        seg = resid[start:i + 1]
        z = None
        if len(seg) >= 40:
            if abs(amean(seg)) < 1e-9:
                z = 0
            else:
                z = z_score(seg, resid[i])
        out.append({
            "date": complete[i]["date"],
            "residualZ": round(z, 3) if z is not None else None,
            "fitted": None,
            "actualLog": None,
        })
    return out




def _round_or_none(v, digits=2):
    return round(v, digits) if v is not None else None


def sync():
    with get_conn() as conn:
        gold = _load_gold(conn)
        dxy = _load_dxy(conn)
        dfii = _load_indicator(conn, DFII_CODE)
        t10yie = _load_indicator(conn, T10YIE_CODE)

        price_chart = [
            {"date": p["date"], "gold": round(p["a"], 2),
             "dxy": round(p["b"], 2) if p["b"] is not None else None}
            for p in align_by_date(gold, dxy)
        ]

        gold_ret = log_returns(gold)
        dxy_ret_all = log_returns(dxy)
        corr20 = rolling_corr(gold_ret, dxy_ret_all, 20)
        corr60 = rolling_corr(gold_ret, dxy_ret_all, 60)
        corr120 = rolling_corr(gold_ret, dxy_ret_all, 120)

        momentum20 = []
        momentum60 = []
        for i in range(len(gold_ret)):
            if i >= 19:
                s = sum(r["value"] for r in gold_ret[i - 19:i + 1])
                momentum20.append({"date": gold_ret[i]["date"], "value": round(s, 4)})
            if i >= 59:
                s = sum(r["value"] for r in gold_ret[i - 59:i + 1])
                momentum60.append({"date": gold_ret[i]["date"], "value": round(s, 4)})

        latest_60 = corr60[-1]["value"] if corr60 else 0
        latest_20 = corr20[-1]["value"] if corr20 else 0
        latest_120 = corr120[-1]["value"] if corr120 else 0
        band = _band_of(latest_60)
        band_info = BAND_LABEL[band]

        switches = _band_switch_events(corr60)

        broken_events = [s["date"] for s in switches if s["to"] in ("broken", "positive")]
        broken_study = event_study(gold, broken_events, [20, 60, 120])

        resid_series = _build_residual_z(gold, dxy, dfii, HORIZON)
        latest_resid = resid_series[-1] if resid_series else None
        resid_vals = [r["residualZ"] for r in resid_series if r["residualZ"] is not None]
        latest_resid_z = latest_resid["residualZ"] if latest_resid and latest_resid["residualZ"] is not None else 0
        resid_percentile = round(percentile_rank(resid_vals, latest_resid_z), 1) if len(resid_vals) > 1 else 50

        extreme_events = []
        last_dir = ""
        for r in resid_series:
            if r["residualZ"] is None:
                continue
            if r["residualZ"] >= 2:
                if last_dir != "over":
                    extreme_events.append({"date": r["date"], "dir": "overvalued"})
                    last_dir = "over"
            elif r["residualZ"] <= -2:
                if last_dir != "under":
                    extreme_events.append({"date": r["date"], "dir": "undervalued"})
                    last_dir = "under"

        extreme_over = [e["date"] for e in extreme_events if e["dir"] == "overvalued"]
        extreme_under = [e["date"] for e in extreme_events if e["dir"] == "undervalued"]
        over_study = event_study(gold, extreme_over, [20, 60, 120])
        under_study = event_study(gold, extreme_under, [20, 60, 120])

        evidence = []
        counter_evidence = []
        historical = []

        def fmt_pct(v):
            return f"{v * 100:.1f}%"

        sign = "+" if latest_resid_z >= 0 else ""
        evidence.append(
            f"双因子定价残差 z = {sign}{latest_resid_z:.2f}（5Y 分位 {resid_percentile:.0f}）"
        )
        evidence.append(
            f"黄金-美元收益率滚动相关（60 日）：{latest_60:.2f}，解析为「{band_info['label']}」"
        )
        gold_last = gold[-1]["value"] if gold else None
        dxy_last = dxy[-1]["value"] if dxy else None
        gold_str = f"{gold_last:.2f}" if gold_last is not None else "--"
        dxy_str = f"{dxy_last:.2f}" if dxy_last is not None else "--"
        evidence.append(f"最新金价 {gold_str} / DXY {dxy_str}")

        if latest_resid_z >= 2:
            direction = "bearish"
            evidence.append("残差严重为正：金价高于实际利率+美元模型定价，存高估风险")
        elif latest_resid_z <= -2:
            direction = "bullish"
            evidence.append("残差严重为负：金价低于实际利率+美元模型定价，存在低估机会")
        else:
            direction = "neutral"
            evidence.append("残差处于 ±2σ 内，金价与双因子定价模型基本一致")

        if band in ("broken", "positive"):
            evidence.append(
                f"关注相关性「{band_info['label']}」：传统美元定价逻辑失效，金价可能由地缘/其他因素独立定价"
            )

        hs = broken_study["horizons"].get("60")
        if broken_study["nEvents"] > 0 and hs and hs["n"] >= 3:
            historical.append({
                "label": "相关失效后 60 日",
                "expected": "neutral",
                "n": broken_study["nEvents"],
                "median": hs["median"],
                "winRate": hs["winRate"],
            })
        oh = over_study["horizons"].get("60")
        if over_study["nEvents"] > 0 and oh and oh["n"] >= 3:
            historical.append({
                "label": "残差高估后 60 日",
                "expected": "bearish",
                "n": over_study["nEvents"],
                "median": oh["median"],
                "winRate": oh["winRate"],
            })
        uh = under_study["horizons"].get("60")
        if under_study["nEvents"] > 0 and uh and uh["n"] >= 3:
            historical.append({
                "label": "残差低估后 60 日",
                "expected": "bullish",
                "n": under_study["nEvents"],
                "median": uh["median"],
                "winRate": uh["winRate"],
            })

        abs_z = abs(latest_resid_z)
        strength = "strong" if abs_z >= 2.5 else ("moderate" if abs_z >= 1.5 else "weak")
        confidence = round(max(0, min(95, 45 + abs_z * 15 + (0 if strength == "weak" else 10) - (10 if counter_evidence else 0))))
        confidence = max(20, min(95, confidence))

        signal = {
            "id": "gold-pricing-residual",
            "module": "gold",
            "title": "黄金定价残差 + 美元关联信号",
            "direction": direction,
            "strength": strength,
            "confidence": confidence,
            "evidence": evidence,
            "counterEvidence": counter_evidence,
            "historical": historical,
            "updatedAt": datetime.utcnow().strftime("%Y-%m-%d"),
        }

        data = {
            "updatedAt": datetime.utcnow().strftime("%Y-%m-%d"),
            "latest": {
                "gold": _round_or_none(gold_last),
                "dxy": _round_or_none(dxy_last),
                "corr20": round(latest_20, 3),
                "corr60": round(latest_60, 3),
                "corr120": round(latest_120, 3),
                "band": band,
                "bandLabel": band_info["label"],
                "bandDesc": band_info["desc"],
                "dfii10": _round_or_none(dfii[-1]["value"]) if dfii else None,
                "t10yie": _round_or_none(t10yie[-1]["value"]) if t10yie else None,
                "residZ": _round_or_none(latest_resid["residualZ"]) if latest_resid else None,
                "residPercentile": resid_percentile,
                "momentum20": momentum20[-1]["value"] if momentum20 else 0,
                "momentum60": momentum60[-1]["value"] if momentum60 else 0,
            },
            "priceChart": price_chart,
            "corrChart": {
                "s20": [{"date": p["date"], "value": round(p["value"], 3)} for p in corr20],
                "s60": [{"date": p["date"], "value": round(p["value"], 3)} for p in corr60],
                "s120": [{"date": p["date"], "value": round(p["value"], 3)} for p in corr120],
            },
            "bandSwitches": [{"date": s["date"], "from": s["from"], "to": s["to"]} for s in switches],
            "residSeries": [{"date": r["date"], "z": r["residualZ"]} for r in resid_series],
            "momentumChart": {"m20": momentum20, "m60": momentum60},
            "extremes": extreme_events[-15:],
            "eventStudies": {
                "broken": broken_study,
                "overvalued": over_study,
                "undervalued": under_study,
            },
            "signal": signal,
        }

        valid_from = data["latest"]["gold"] and datetime.utcnow().strftime("%Y-%m-%d") or datetime.utcnow().strftime("%Y-%m-%d")
        upsert_analysis_result(conn, ENDPOINT, valid_from, data)
        log.info("写入 analysis_results[%s]: valid_from=%s", ENDPOINT, valid_from)
        write_sync_log("analysis_gold_correlation", "success", 1, "", ENDPOINT)


def main():
    log.info("=" * 60)
    log.info("开始同步: 黄金定价残差 + 美元关联信号")
    sync()


if __name__ == "__main__":
    main()
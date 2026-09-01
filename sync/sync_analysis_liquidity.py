#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预计算：全球流动性分析（API: /api/v1/analysis/liquidity.json）

核心指标：净流动性 = 美联储总资产 - RRP - TGA（前向填充，避免缺数据当 0）。
输出一份统一的分析包给前端：
  - current:  最新净流动性数值 / 周变化 / z-score / 5 年分位 / 趋势
  - signal:  体制（扩张/收缩/中性）+ 强度 + 置信度 + 证据链
  - thresholds:  5 年中位 + 10% / 90% 分位线（用于在净流动性图上叠加参考线）
  - forwardReturns:  按「近 8 周净流动性变化方向」分组，标普未来 1/3/6/12 月收益与胜率
  - liquidityEvents:  历史关键事件（2019 repo、2020 QE、2022 QT、2023 SVB、2024 RRP 归零 等）
  - history:  净流动性时序 + 滚动 z-score
  - status / statusDesc:  人类可读的当前状态
"""
from datetime import datetime, timedelta

from sync_base import _setup_logger, get_conn, write_sync_log, upsert_analysis_result
from analysis import mean, z_score, percentile_rank, quantile


ENDPOINT = "analysis/liquidity"
HORIZON = 10 * 365
SP500_SYMBOL = "^GSPC"
HORIZONS = [(20, 60), (60, 120), (120, 180), (240, 365)]
TREND_WINDOW = 8  # 净流动性趋势判断窗口（周）

# 关键历史事件（流动性视角）。label 短、desc 详细
LIQUIDITY_EVENTS = [
    {"date": "2019-09-17", "label": "回购危机", "desc": "2019-09 美元货币市场流动性紧张，SOFR 异常跳升"},
    {"date": "2020-03-15", "label": "无限 QE", "desc": "美联储宣布无限量 QE + 多个紧急工具"},
    {"date": "2020-06-11", "label": "PEPP 续作", "desc": "美联储资产负债表从 4.2T 加速扩至 7.1T"},
    {"date": "2022-06-01", "label": "QT 启动", "desc": "美联储开始缩表，每月最多 950 亿美元"},
    {"date": "2023-03-12", "label": "BTFP 设立", "desc": "SVB 事件后设立银行定期融资计划"},
    {"date": "2024-01-01", "label": "BTFP 到期", "desc": "银行定期融资计划到期，TGA 重新抽水"},
    {"date": "2024-09-30", "label": "RRP 归零", "desc": "隔夜逆回购规模降至 0，流动性缓冲耗尽"},
    {"date": "2025-04-01", "label": "关税冲击", "desc": "新一轮关税引发 RRP 短暂回升"},
]

log = _setup_logger("sync_analysis_liquidity")


def _to_date(v):
    return str(v)[:10]


def _add_days(date_str, days):
    d = datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=days)
    return d.strftime("%Y-%m-%d")


def _load_indicator(conn, code, region, horizon):
    with conn.cursor() as cur:
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


def _ffill(points):
    """对缺数据的日期做前向填充。返回 [(date, value)] 列表，已剔除前向填充仍为空的早期点。"""
    out = []
    last = None
    for p in sorted(points, key=lambda x: x["date"]):
        if p["value"] is not None:
            last = p["value"]
        if last is not None:
            out.append({"date": p["date"], "value": last})
    return out


def _build_net_liquidity(fed, rrp, tga):
    """净流动性 = Fed 总资产 - RRP - TGA。

    RRP / TGA 与 Fed 频率不一致，标准做法：
      1) 各自前向填充到完整日期轴
      2) 取 Fed 的实际日期作为主轴（weekly 节奏代表官方口径）
      3) 缺一项则跳过该日
    """
    rrp_filled = {p["date"]: p["value"] for p in _ffill(rrp)}
    tga_filled = {p["date"]: p["value"] for p in _ffill(tga)}
    out = []
    for p in fed:
        r = rrp_filled.get(p["date"])
        t = tga_filled.get(p["date"])
        if r is None or t is None:
            continue
        out.append({
            "date": p["date"],
            "value": round(p["value"] - r - t, 2),
        })
    return out


def _rolling_z(values, window):
    """对每个点计算过去 window 期的 z-score（不包含当前点更早的窗口）。"""
    out = [None] * len(values)
    for i in range(window, len(values)):
        seg = values[i - window:i]
        if len(seg) < 2:
            continue
        m = mean(seg)
        s2 = sum((v - m) ** 2 for v in seg) / len(seg)
        if s2 == 0:
            continue
        sd = s2 ** 0.5
        out[i] = round((values[i] - m) / sd, 3)
    return out


def _calc_forward_returns(net_points, price_points):
    """按近 TREND_WINDOW 周净流动性变化方向分组，统计标普未来 1/3/6/12 月收益。

    返回: [{ regime: 'expansion'|'contraction'|'neutral', n, avgReturn1m, ..., winRate1m, ... }, ...]
    """
    sorted_prices = sorted(price_points, key=lambda p: p["date"])
    price_map = {p["date"]: p["value"] for p in sorted_prices}
    sorted_net = sorted(net_points, key=lambda p: p["date"])

    # 周频（Fed 数据本身就是 weekly）数据，TREND_WINDOW 周即 TREND_WINDOW 个点
    buckets = {"expansion": [], "contraction": [], "neutral": []}
    for i in range(TREND_WINDOW, len(sorted_net)):
        cur = sorted_net[i]["value"]
        prev = sorted_net[i - TREND_WINDOW]["value"]
        delta = cur - prev
        if delta > 0:
            regime = "expansion"
        elif delta < 0:
            regime = "contraction"
        else:
            regime = "neutral"
        base_date = sorted_net[i]["date"]
        base_price = price_map.get(base_date)
        if not base_price or base_price <= 0:
            continue
        for days, _ in HORIZONS:
            target = _add_days(base_date, days)
            tp = None
            for d, v in sorted_prices:
                if d >= target:
                    tp = v
                    break
            if tp is not None:
                buckets[regime].append((tp / base_price - 1) * 100)

    out = []
    for regime in ("expansion", "contraction", "neutral"):
        vals = buckets[regime]
        if not vals:
            out.append({
                "regime": regime,
                "n": 0,
                "avgReturn1m": None, "avgReturn3m": None, "avgReturn6m": None, "avgReturn12m": None,
                "winRate1m": None, "winRate3m": None, "winRate6m": None, "winRate12m": None,
            })
            continue
        out.append({
            "regime": regime,
            "n": len(vals) // len(HORIZONS),
            "avgReturn1m": round(mean(vals[0::4]), 2) if len(vals) >= 1 else None,
            "avgReturn3m": round(mean(vals[1::4]), 2) if len(vals) >= 2 else None,
            "avgReturn6m": round(mean(vals[2::4]), 2) if len(vals) >= 3 else None,
            "avgReturn12m": round(mean(vals[3::4]), 2) if len(vals) >= 4 else None,
            "winRate1m": round(sum(1 for v in vals[0::4] if v > 0) / max(1, len(vals[0::4])), 3) if len(vals) >= 1 else None,
            "winRate3m": round(sum(1 for v in vals[1::4] if v > 0) / max(1, len(vals[1::4])), 3) if len(vals) >= 2 else None,
            "winRate6m": round(sum(1 for v in vals[2::4] if v > 0) / max(1, len(vals[2::4])), 3) if len(vals) >= 3 else None,
            "winRate12m": round(sum(1 for v in vals[3::4] if v > 0) / max(1, len(vals[3::4])), 3) if len(vals) >= 4 else None,
        })
    return out


def sync():
    with get_conn() as conn:
        fed = _load_indicator(conn, "FED_BALANCE_SHEET", "GLOBAL", HORIZON)
        rrp = _load_indicator(conn, "FED_RRP", "GLOBAL", HORIZON)
        tga = _load_indicator(conn, "FED_TGA", "GLOBAL", HORIZON)
        sp500 = _load_sp500(conn, HORIZON)

        if len(fed) < TREND_WINDOW * 2:
            raise RuntimeError("美联储总资产数据不足，无法计算净流动性")

        net = _build_net_liquidity(fed, rrp, tga)
        if len(net) < TREND_WINDOW * 2:
            raise RuntimeError("净流动性数据不足")

        net_values = [p["value"] for p in net]
        net_values_t = [p["value"] / 1e6 for p in net]  # 百万美元 → 万亿美元

        latest = net[-1]
        prev = net[-2] if len(net) >= 2 else None
        prev_w = net[-(1 + TREND_WINDOW)] if len(net) > TREND_WINDOW else None

        # z-score：滚动 252 周（约 5 年）
        rolling_zs = _rolling_z(net_values_t, 252)
        cur_z = rolling_zs[-1] if rolling_zs else None

        # 5 年分位
        last5y = net_values_t[-252:] if len(net_values_t) >= 252 else net_values_t
        cur = net_values_t[-1]
        cur_pct = round(percentile_rank(last5y, cur), 1) if last5y else None

        # 趋势
        if prev_w:
            delta_t = net_values_t[-1] - net_values_t[-(1 + TREND_WINDOW)]
        else:
            delta_t = None

        # 阈值
        sorted_v = sorted(net_values_t)
        median_v = round(quantile(sorted_v, 0.5), 4) if sorted_v else None
        p10_v = round(quantile(sorted_v, 0.1), 4) if sorted_v else None
        p90_v = round(quantile(sorted_v, 0.9), 4) if sorted_v else None

        # 体制分类
        if cur_z is None:
            regime = "neutral"
            strength = "moderate"
        elif cur_z >= 1.0:
            regime = "expansion"
            strength = "strong" if cur_z >= 1.5 else "moderate"
        elif cur_z <= -1.0:
            regime = "contraction"
            strength = "strong" if cur_z <= -1.5 else "moderate"
        else:
            regime = "neutral"
            strength = "moderate"

        # 置信度：基于 z-score 极端程度 + 趋势一致性
        evidence_z = abs(cur_z) if cur_z is not None else 0
        trend_dir = 0 if delta_t is None else (1 if delta_t > 0 else -1)
        z_dir = 0 if cur_z is None else (1 if cur_z > 0 else -1)
        align = 1 if trend_dir == z_dir else -1
        # 基础置信度 50，z 越大越极端、趋势越一致越高
        base = 50 + min(evidence_z * 8, 30) + (10 if align > 0 else -5)
        confidence = max(35, min(85, round(base)))

        # 事件命中（仅保留已有数据范围内的）
        available_dates = {p["date"] for p in net}
        events = [e for e in LIQUIDITY_EVENTS if e["date"] in available_dates]

        # 状态描述
        if regime == "expansion":
            status = "abundant"
            status_desc = "净流动性处于历史高位区间，风险资产偏多"
        elif regime == "contraction":
            status = "tight"
            status_desc = "净流动性处于历史低位区间，需警惕流动性收紧"
        else:
            status = "neutral"
            status_desc = "净流动性处于中性区间，结构未现极端"

        # 证据链
        evidence = []
        evidence.append(f"净流动性 {round(cur, 2)} 万亿美元")
        if prev:
            wk = round(net_values_t[-1] - net_values_t[-2], 4)
            evidence.append(f"周变化 {'+' if wk >= 0 else ''}{wk} 万亿")
        if delta_t is not None:
            tag = f"{TREND_WINDOW} 周趋势 {'+' if delta_t >= 0 else ''}{round(delta_t, 2)}T"
            evidence.append(tag)
        if cur_z is not None:
            evidence.append(f"5Y z-score {cur_z:.2f}（{'扩张' if cur_z > 0 else '收缩'}）")
        if cur_pct is not None:
            evidence.append(f"5Y 分位 {cur_pct:.0f}%")
        if status_desc:
            evidence.append(status_desc)

        # 前瞻收益
        forward_returns = _calc_forward_returns(net, sp500)

        # 历史时序（保持 weekly 颗粒度，与前端图表一致）
        history_dates = [p["date"] for p in net]
        history_values = net_values_t
        history_z = rolling_zs

        data = {
            "current": {
                "netLiquidityTrn": round(cur, 4) if cur is not None else None,
                "weeklyChangeTrn": round(net_values_t[-1] - net_values_t[-2], 4) if len(net_values_t) >= 2 else None,
                "trendChangeTrn": round(delta_t, 4) if delta_t is not None else None,
                "zScore5y": cur_z,
                "percentile5y": cur_pct,
                "asOf": latest["date"],
            },
            "thresholds": {
                "median": median_v,
                "p10": p10_v,
                "p90": p90_v,
            },
            "signal": {
                "direction": regime,
                "strength": strength,
                "confidence": confidence,
                "status": status,
                "statusDesc": status_desc,
                "evidence": evidence,
            },
            "history": {
                "dates": history_dates,
                "netLiquidityTrn": [round(v, 4) for v in history_values],
                "zScore5y": history_z,
            },
            "liquidityEvents": events,
            "forwardReturns": forward_returns,
            "components": {
                "fedLastTrn": round(fed[-1]["value"] / 1e6, 4) if fed else None,
                "rrpLastTrn": round(_ffill(rrp)[-1]["value"] / 1000, 4) if rrp else None,
                "tgaLastTrn": round(_ffill(tga)[-1]["value"] / 1e6, 4) if tga else None,
            },
            "updatedAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

        valid_from = latest["date"]
        upsert_analysis_result(conn, ENDPOINT, valid_from, data)
        log.info(
            "写入 analysis_results[%s]: valid_from=%s, regime=%s, z=%.2f, pct=%.0f%%",
            ENDPOINT, valid_from, regime, cur_z or 0, cur_pct or 0,
        )
        write_sync_log("analysis_liquidity", "success", 1, "", ENDPOINT)


def main():
    log.info("=" * 60)
    log.info("开始同步: 全球流动性分析")
    sync()


if __name__ == "__main__":
    main()

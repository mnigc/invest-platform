#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""通用分析引擎：相关性 / 事件研究 / 统计工具。

这些函数原为 src/lib/analysis.ts 的 1:1 翻译（重计算从 Worker 迁移到 Python 同步层时），
用于保证两端数值一致。现前端已不再持有计算逻辑（改为直接读 analysis_results 的
预计算 JSONB），TS 版已随迁移完成删除，此模块即为唯一实现。

数值字段统一 round(value, 4) 处理后输出（对应原 TS 的 .toFixed(4)）。
"""
from math import log as _ln, sqrt, isfinite


# ── 统计基础 ──
def mean(nums):
    if not nums:
        return 0
    return sum(nums) / len(nums)


def std(nums):
    if len(nums) < 2:
        return 0
    m = mean(nums)
    return sqrt(sum((v - m) ** 2 for v in nums) / len(nums))


def percentile_rank(values, v):
    if len(values) < 2:
        return 50
    sorted_vals = sorted(values)
    below = sum(1 for x in sorted_vals if x < v)
    return round((below / (len(sorted_vals) - 1)) * 100, 1)


def z_score(values, v):
    m = mean(values)
    s = std(values)
    if s == 0:
        return 0
    return (v - m) / s


def quantile(sorted_vals, q):
    if not sorted_vals:
        return 0
    pos = (len(sorted_vals) - 1) * q
    lo = int(pos // 1)
    hi = int(-(-pos // 1))  # ceil
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


# ── 收益率 ──
def log_returns(points):
    """相邻日 ln(p_i / p_{i-1})，首项跳过。points: [{date, value}, ...]"""
    out = []
    for i in range(1, len(points)):
        prev = points[i - 1]["value"]
        cur = points[i]["value"]
        if prev is not None and cur is not None and prev > 0 and cur > 0:
            out.append({"date": points[i]["date"], "value": _ln(cur / prev)})
    return out


# ── 按日期对齐两条序列（交集） ──
def align_by_date(a, b):
    """a, b: [{date, value}, ...] -> [{date, a, b}, ...]"""
    b_map = {p["date"]: p["value"] for p in b}
    out = []
    for p in a:
        bv = b_map.get(p["date"])
        if (
            bv is not None
            and isfinite(bv)
            and p["value"] is not None
            and isfinite(p["value"])
        ):
            out.append({"date": p["date"], "a": p["value"], "b": bv})
    return out


# ── 相关 ──
def corr(ax, bx):
    """Pearson 相关系数，去掉对齐后取最后 n 个，结果 +round 4 位"""
    n = min(len(ax), len(bx))
    if n < 3:
        return 0
    a = list(ax[-n:])
    b = list(bx[-n:])
    ma = mean(a)
    mb = mean(b)
    cov = sa2 = sb2 = 0
    for i in range(n):
        da = a[i] - ma
        db = b[i] - mb
        cov += da * db
        sa2 += da * da
        sb2 += db * db
    if sa2 == 0 or sb2 == 0:
        return 0
    return round(cov / sqrt(sa2 * sb2), 4)


def rolling_corr(a, b, window):
    """滑动窗口相关系数：每窗口计算一次 corr，输出每个右端点的 (date, value)"""
    aligned = align_by_date(a, b)
    out = []
    for i in range(window, len(aligned) + 1):
        seg = aligned[i - window:i]
        r = corr([pt["a"] for pt in seg], [pt["b"] for pt in seg])
        out.append({"date": seg[-1]["date"], "value": r})
    return out


# ── 事件研究 ──
def _forward_returns(price_dates, price_map, base_date, horizons):
    """以 base_date 之前最近一个交易日为基准，计算 N 个交易日后收益率（小数，+round 4）"""
    base_idx = -1
    for i, d in enumerate(price_dates):
        if d <= base_date:
            base_idx = i
        else:
            break
    if base_idx < 0:
        return {}
    base = price_map.get(price_dates[base_idx])
    if base is None or base == 0:
        return {}
    rets = {}
    for h in horizons:
        j = base_idx + h
        if j < len(price_dates):
            fwd = price_map.get(price_dates[j])
            rets[str(h)] = round((fwd / base) - 1, 4) if fwd is not None and fwd > 0 else None
        else:
            rets[str(h)] = None
    return rets


def event_study(prices, event_dates, horizons):
    """prices: [{date, value}], event_dates: ['YYYY-MM-DD', ...], horizons: [int, ...]

    返回 dict:
      {
        'nEvents': int,
        'events': [{date, rets: {horizon: r|null}}, ...],
        'horizons': {h: HorizonStats}
      }
    """
    price_dates = sorted(str(p["date"]) for p in prices)
    price_map = {str(p["date"]): p["value"] for p in prices}

    events = []
    for ev in event_dates:
        rets = _forward_returns(price_dates, price_map, str(ev), horizons)
        events.append({"date": str(ev), "rets": rets})

    horizons_out = {}
    for h in horizons:
        vals = [
            e["rets"][str(h)]
            for e in events
            if e["rets"].get(str(h)) is not None and isfinite(e["rets"][str(h)])
        ]
        if not vals:
            horizons_out[str(h)] = {
                "n": 0, "mean": 0, "median": 0, "winRate": 0,
                "p25": 0, "p75": 0, "best": 0, "worst": 0,
            }
            continue
        sorted_vals = sorted(vals)
        horizons_out[str(h)] = {
            "n": len(vals),
            "mean": round(mean(vals), 4),
            "median": round(quantile(sorted_vals, 0.5), 4),
            "winRate": round(sum(1 for v in vals if v > 0) / len(vals), 4),
            "p25": round(quantile(sorted_vals, 0.25), 4),
            "p75": round(quantile(sorted_vals, 0.75), 4),
            "best": round(sorted_vals[-1], 4),
            "worst": round(sorted_vals[0], 4),
        }

    return {"nEvents": len(events), "events": events, "horizons": horizons_out}
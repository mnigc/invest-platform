#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预计算：ETF 回撤与修复分析（API: /api/v1/analysis/drawdown.json）

对每个标的构建完整回撤序列，输出：
- 每个回撤事件的 峰顶日/谷底日/深度/修复日/时长（≥1% 计为事件）
- 最大回撤、平均/中位回撤与修复时长、按深度分桶统计、水下时间占比
- 深度×修复时长散点（≥5%，"伤口越深愈合越久"的核心图）
- 风险指标：CAGR/波动/Sharpe/Sortino/Calmar/Ulcer Index/年度收益

口径说明：
- ETF（SPY/VOO/QQQ）优先用 adjusted_close（分红再投资全收益）；
  ^GSPC 只有价格口径（不含分红），UI 必须标注差异。
- 修复 = 收盘价首次回到前高；未修复的回撤属删失数据，
  不进"平均修复时长"均值，但在 buckets.ongoing 单列。

用法:
    python sync_analysis_drawdown.py            # 全部标的
"""
import sys
from math import sqrt, isfinite
from datetime import date, datetime, timezone

from sync_base import (
    _setup_logger, get_conn, write_sync_log, upsert_analysis_result, SyncError,
)

ENDPOINT = "analysis/etf-drawdown"

# (symbol, 名称, 口径, 价格列)  口径: total_return=分红再投资 / price=价格指数
SYMBOLS = [
    ("SPY", "标普500ETF", "total_return", "adjusted_close"),
    ("VOO", "标普500ETF(先锋)", "total_return", "adjusted_close"),
    ("QQQ", "纳指100ETF", "total_return", "adjusted_close"),
    ("^GSPC", "标普500指数(1950起)", "price", "close_price"),
]

MIN_EPISODE_DEPTH = 0.01    # ≥1% 跌幅才计为一次回撤事件（过滤日内噪音）
SCATTER_MIN_DEPTH = 0.05    # 散点图只画 ≥5% 的事件
BUCKET_EDGES = [0.01, 0.05, 0.10, 0.20, 0.30, 0.50, 1.01]  # 左闭右开，末桶含 50%+
TRADING_DAYS = 252

log = _setup_logger("sync_analysis_drawdown")


# ────────────────────────── 数据加载 ──────────────────────────
def load_prices(conn, symbol, price_col):
    """加载日线序列，返回 (dates, prices)；优先 price_col，缺失回退 close_price。"""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT ap.trade_date, ap.{price_col} AS v, ap.close_price
            FROM asset_prices ap
            JOIN assets a ON a.id = ap.asset_id
            WHERE a.symbol = %s AND ap.close_price > 0
            ORDER BY ap.trade_date ASC
            """,
            (symbol,),
        )
        rows = cur.fetchall()

    dates, prices, fallback = [], [], 0
    for r in rows:
        v = r["v"]
        if v is None:
            v = r["close_price"]
            fallback += 1
        if v is None or v <= 0:
            continue
        dates.append(str(r["trade_date"])[:10])
        prices.append(float(v))
    if fallback:
        log.warning("  %s: %d 天缺 %s，回退 close_price（口径降级为价格）",
                    symbol, fallback, price_col)
    return dates, prices


# ────────────────────────── 回撤引擎 ──────────────────────────
def _days_between(d1, d2):
    """两个 YYYY-MM-DD 的日历天数差"""
    try:
        return (date.fromisoformat(d2) - date.fromisoformat(d1)).days
    except Exception:
        return None


def _median(vals):
    s = sorted(vals)
    n = len(s)
    if n == 0:
        return 0
    if n % 2:
        return s[n // 2]
    return (s[n // 2 - 1] + s[n // 2]) / 2


def extract_drawdowns(dates, prices):
    """逐日扫描运行峰值，产出所有 ≥MIN_EPISODE_DEPTH 的回撤事件 + 每日水下深度。

    修复定义：收盘价首次 >= 前高（全收益口径下即真实回本时点）。
    返回 (episodes, daily_dd)：
      episodes: [{peak_date, trough_date, depth, decline_days, recovery_date,
                  recovery_days, underwater_days, recovered}]
      daily_dd: [(date, dd)] dd∈(-1,0]，新高日为 0
    """
    episodes, daily_dd = [], []
    peak, peak_date = prices[0], dates[0]
    trough, trough_date = None, None
    in_dd = False

    for i in range(len(dates)):
        p, d = prices[i], dates[i]
        if p >= peak:
            if in_dd:
                depth = trough / peak - 1
                if depth <= -MIN_EPISODE_DEPTH:
                    episodes.append({
                        "peakDate": peak_date, "troughDate": trough_date,
                        "depth": round(depth, 4),
                        "declineDays": _days_between(peak_date, trough_date),
                        "recoveryDate": d,
                        "recoveryDays": _days_between(trough_date, d),
                        "underwaterDays": _days_between(peak_date, d),
                        "recovered": True,
                    })
            in_dd = False
            peak, peak_date = p, d
        else:
            if not in_dd:
                in_dd = True
                trough, trough_date = p, d
            elif p < trough:
                trough, trough_date = p, d
        daily_dd.append((d, round(p / peak - 1, 4) if p < peak else 0.0))

    # 收尾：进行中的回撤（删失数据，不进均值）
    if in_dd:
        depth = trough / peak - 1
        if depth <= -MIN_EPISODE_DEPTH:
            last_d = dates[-1]
            episodes.append({
                "peakDate": peak_date, "troughDate": trough_date,
                "depth": round(depth, 4),
                "declineDays": _days_between(peak_date, trough_date),
                "recoveryDate": None,
                "recoveryDays": None,
                "underwaterDays": _days_between(peak_date, last_d),
                "recovered": False,
            })

    # 内部一致性校验：修复日必须晚于谷底日，深度必须在 (-1, 0)
    for e in episodes:
        if not (-1 < e["depth"] < 0):
            raise SyncError("drawdown 引擎异常: depth=%s @%s" % (e["depth"], e["peakDate"]))
        if e["recovered"] and e["recoveryDate"] <= e["troughDate"]:
            raise SyncError("drawdown 引擎异常: recovery 早于 trough @%s" % e["peakDate"])
    return episodes, daily_dd


def bucket_stats(episodes):
    """按深度分桶：频次/平均深度/修复时长统计；未修复事件单列 ongoing。"""
    buckets = []
    for i in range(len(BUCKET_EDGES) - 1):
        lo, hi = BUCKET_EDGES[i], BUCKET_EDGES[i + 1]
        seg = [e for e in episodes if lo <= -e["depth"] < hi]
        rec = [e for e in seg if e["recovered"]]
        rec_days = [e["recoveryDays"] for e in rec if e["recoveryDays"]]
        uw_days = [e["underwaterDays"] for e in rec if e["underwaterDays"]]
        hi_label = "50%+" if hi > 1 else "%g%%" % (hi * 100)
        buckets.append({
            "label": "%g%%~%s" % (lo * 100, hi_label),
            "minDepth": lo, "maxDepth": hi if hi <= 1 else None,
            "count": len(seg),
            "avgDepth": round(sum(-e["depth"] for e in seg) / len(seg), 4) if seg else 0,
            "avgRecoveryDays": round(sum(rec_days) / len(rec_days)) if rec_days else None,
            "medianRecoveryDays": round(_median(rec_days)) if rec_days else None,
            "maxRecoveryDays": max(rec_days) if rec_days else None,
            "avgUnderwaterDays": round(sum(uw_days) / len(uw_days)) if uw_days else None,
            "ongoing": sum(1 for e in seg if not e["recovered"]),
        })
    return buckets


def underwater_weekly(daily_dd):
    """水下曲线周线采样（每周最后一个交易日），控制 payload 体积。"""
    dates, values, last_iso = [], [], None
    for d, dd in daily_dd:
        iso = date.fromisoformat(d).isocalendar()[:2]
        if last_iso is not None and iso != last_iso:
            dates.append(cur_d)
            values.append(cur_v)
        cur_d, cur_v, last_iso = d, dd, iso
    dates.append(cur_d)
    values.append(cur_v)
    return dates, values


def risk_stats(dates, prices, daily_dd, mdd_depth):
    """CAGR/波动/Sharpe/Sortino/Calmar/Ulcer + 年度收益表。rf=0（注明口径）。"""
    rets = [prices[i] / prices[i - 1] - 1 for i in range(1, len(prices))
            if prices[i - 1] > 0]
    n_years = _days_between(dates[0], dates[-1]) / 365.25
    cagr = (prices[-1] / prices[0]) ** (1 / n_years) - 1 if n_years > 0 and prices[0] > 0 else None

    mean_r = sum(rets) / len(rets)
    vol = sqrt(sum((r - mean_r) ** 2 for r in rets) / (len(rets) - 1)) * sqrt(TRADING_DAYS)
    downside = sqrt(sum(min(r, 0) ** 2 for r in rets) / len(rets)) * sqrt(TRADING_DAYS)
    sharpe = cagr / vol if cagr is not None and vol > 0 else None
    sortino = cagr / downside if cagr is not None and downside > 0 else None
    calmar = cagr / abs(mdd_depth) if cagr is not None and mdd_depth < 0 else None
    ulcer = sqrt(sum(dd * dd for _, dd in daily_dd) / len(daily_dd)) * 100

    # 年度收益：按自然年最后一个收盘对上一个自然年最后一个收盘
    year_last = {}
    for d, p in zip(dates, prices):
        year_last[d[:4]] = p
    years = sorted(year_last)
    annual = []
    for i in range(1, len(years)):
        prev, cur = year_last[years[i - 1]], year_last[years[i]]
        if prev > 0:
            annual.append({"year": int(years[i]), "ret": round(cur / prev - 1, 4)})
    pos_years = [a for a in annual if a["ret"] > 0]

    return {
        "cagr": round(cagr, 4) if cagr is not None else None,
        "vol": round(vol, 4) if vol else None,
        "sharpe": round(sharpe, 2) if sharpe is not None else None,
        "sortino": round(sortino, 2) if sortino is not None else None,
        "calmar": round(calmar, 2) if calmar is not None else None,
        "ulcerIndex": round(ulcer, 2),
        "bestYear": max((a["ret"] for a in annual), default=None),
        "worstYear": min((a["ret"] for a in annual), default=None),
        "positiveYearRate": round(len(pos_years) / len(annual), 4) if annual else None,
        "annualReturns": annual,
    }


def compute_asset(symbol, name_zh, basis, dates, prices):
    """单个标的的完整回撤分析块"""
    episodes, daily_dd = extract_drawdowns(dates, prices)

    mdd_ep = min(episodes, key=lambda e: e["depth"]) if episodes else None
    rec = [e for e in episodes if e["recovered"]]
    rec_days = [e["recoveryDays"] for e in rec if e["recoveryDays"]]
    uw_days = [e["underwaterDays"] for e in rec if e["underwaterDays"]]
    ongoing = [e for e in episodes if not e["recovered"]]

    dd_vals = [dd for _, dd in daily_dd]
    n_years = _days_between(dates[0], dates[-1]) / 365.25

    # 当前回撤状态
    cur_dd = dd_vals[-1]
    cur_peak_date = dates[-1]
    if cur_dd < 0:
        # 回溯找当前运行峰顶日
        for d, dd in zip(reversed(dates), reversed(dd_vals)):
            if dd == 0:
                cur_peak_date = d
                break
    cur_ep = ongoing[-1] if ongoing else None

    weekly_d, weekly_v = underwater_weekly(daily_dd)

    return {
        "symbol": symbol,
        "nameZh": name_zh,
        "basis": basis,
        "basisLabel": "全收益(含分红)" if basis == "total_return" else "价格(不含分红)",
        "dataStart": dates[0],
        "dataEnd": dates[-1],
        "nDays": len(dates),
        "years": round(n_years, 1),
        "current": {
            "inDrawdown": cur_dd < 0,
            "depth": round(cur_dd, 4),
            "peakDate": cur_peak_date if cur_dd < 0 else dates[-1],
            "daysUnderwater": _days_between(cur_peak_date, dates[-1]) if cur_dd < 0 else 0,
            "troughDate": cur_ep["troughDate"] if cur_ep else None,
            "troughDepth": cur_ep["depth"] if cur_ep else None,
        },
        "mdd": {
            "depth": mdd_ep["depth"] if mdd_ep else 0,
            "peakDate": mdd_ep["peakDate"] if mdd_ep else None,
            "troughDate": mdd_ep["troughDate"] if mdd_ep else None,
            "recoveryDate": mdd_ep["recoveryDate"] if mdd_ep else None,
            "recoveryDays": mdd_ep["recoveryDays"] if mdd_ep else None,
            "underwaterDays": mdd_ep["underwaterDays"] if mdd_ep else None,
            "ongoing": not (mdd_ep or {}).get("recovered", True),
        },
        "stats": {
            "episodeCount": len(episodes),
            "drawdownsPerYear": round(len(episodes) / n_years, 2) if n_years > 0 else None,
            "avgDepth": round(sum(-e["depth"] for e in episodes) / len(episodes), 4) if episodes else 0,
            "medianDepth": round(_median([-e["depth"] for e in episodes]), 4) if episodes else 0,
            "avgRecoveryDays": round(sum(rec_days) / len(rec_days)) if rec_days else None,
            "medianRecoveryDays": round(_median(rec_days)) if rec_days else None,
            "avgUnderwaterDays": round(sum(uw_days) / len(uw_days)) if uw_days else None,
            "longestUnderwaterDays": max(uw_days) if uw_days else None,
            "underwaterPctDays": round(sum(1 for v in dd_vals if v < 0) / len(dd_vals), 4),
            "ongoingCount": len(ongoing),
        },
        "buckets": bucket_stats(episodes),
        "episodes": sorted(episodes, key=lambda e: e["depth"])[:60],  # 最深 60 次
        "scatter": [
            {
                "depth": round(-e["depth"], 4),
                "recoveryDays": e["recoveryDays"],
                "peakDate": e["peakDate"],
                "troughDate": e["troughDate"],
                "recovered": e["recovered"],
            }
            for e in episodes if -e["depth"] >= SCATTER_MIN_DEPTH
        ],
        "underwater": {"dates": weekly_d, "values": weekly_v},
        "risk": risk_stats(dates, prices, daily_dd, mdd_ep["depth"] if mdd_ep else 0),
    }


def sync():
    with get_conn() as conn:
        assets = {}
        for symbol, name_zh, basis, price_col in SYMBOLS:
            dates, prices = load_prices(conn, symbol, price_col)
            if len(dates) < 250:
                log.warning("  %s 仅 %d 天数据（回填未完成？），跳过", symbol, len(dates))
                continue
            log.info("  %s: %d 天 (%s ~ %s)", symbol, len(dates), dates[0], dates[-1])
            assets[symbol] = compute_asset(symbol, name_zh, basis, dates, prices)

        if not assets:
            raise SyncError("etf_drawdown: 无任何标的有可用价格数据")

        # 数值自检：最大回撤必须等于水下曲线极值（两套代码路径互验）
        for sym, blk in assets.items():
            uv_min = min(blk["underwater"]["values"])
            if abs(uv_min - blk["mdd"]["depth"]) > 0.005:
                raise SyncError(
                    "etf_drawdown %s: MDD(%s) 与水下曲线极值(%s)不一致"
                    % (sym, blk["mdd"]["depth"], uv_min))

        payload = {
            "assets": assets,
            "minEpisodeDepth": MIN_EPISODE_DEPTH,
            "notes": [
                "修复=收盘价回到前高；ETF 按含分红全收益口径，指数为价格口径",
                "进行中的回撤不计入平均修复时长（删失数据），在 ongoing 中单列",
                "时长为日历天；事件按 ≥1% 深度统计",
            ],
            "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        }
        valid_from = max(b["dataEnd"] for b in assets.values())
        upsert_analysis_result(conn, ENDPOINT, valid_from, payload)
        log.info("写入 analysis_results[%s]: %d 个标的, valid_from=%s",
                 ENDPOINT, len(assets), valid_from)
        write_sync_log("analysis_etf_drawdown", "success", len(assets), "", ENDPOINT)


def main():
    log.info("=" * 60)
    log.info("开始预计算: ETF 回撤与修复分析")
    sync()


if __name__ == "__main__":
    main()

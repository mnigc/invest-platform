#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预计算：ETF 策略回测（API: /api/v1/analysis/backtest.json）

向量化日频回测引擎，纪律：
- 信号在 t 日收盘产生，仓位自 t+1 收盘生效（杜绝前视偏差）；
- 换仓计交易成本（默认单边 2bp，ETF 买卖价差量级）；
- 每个策略与买入持有同图对比，跑不赢基准风险调整收益即噪音；
- 输出样本内/样本外(70/30)分段统计 + 参数敏感性，暴露过拟合风险。

策略注册表：
- buy_hold  买入持有（基准）
- sma200    200日均线趋势过滤：线上持有、线下空仓（高 Calmar 代表）
- rsi2_dip  RSI(2)<10 且站上 MA200 时做多，收盘>MA5 离场（高胜率均值回归代表）
- dip_buy   自 60 日高点回撤 ≥10% 时做多，收复入场时前高离场（回撤加仓）

用法:
    python sync_analysis_backtest.py            # 全部标的
"""
import sys
from math import sqrt
from datetime import date, datetime, timezone

from sync_base import (
    _setup_logger, get_conn, write_sync_log, upsert_analysis_result, SyncError,
)

ENDPOINT = "analysis/etf-backtest"

# VOO 与 SPY 跟踪同一指数（结果几乎一致），不重复回测
SYMBOLS = [
    ("SPY", "标普500ETF"),
    ("QQQ", "纳指100ETF"),
]

COST_BPS = 2            # 单边交易成本（点差+滑点），ETF 量级
TRADING_DAYS = 252
OOS_SPLIT = 0.7         # 样本内 70% / 样本外 30%
HOLD_MAX = 250          # dip_buy 持仓超时（交易日）

log = _setup_logger("sync_analysis_backtest")


# ────────────────────────── 数据加载 ──────────────────────────
def load_prices(conn, symbol):
    """加载日线（优先 adjusted_close 全收益口径），返回 (dates, closes, basis)"""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ap.trade_date, ap.adjusted_close, ap.close_price
            FROM asset_prices ap
            JOIN assets a ON a.id = ap.asset_id
            WHERE a.symbol = %s AND ap.close_price > 0
            ORDER BY ap.trade_date ASC
            """,
            (symbol,),
        )
        rows = cur.fetchall()

    dates, closes = [], []
    for r in rows:
        v = r["adjusted_close"] if r["adjusted_close"] is not None else r["close_price"]
        if v is None or v <= 0:
            continue
        dates.append(str(r["trade_date"])[:10])
        closes.append(float(v))
    basis = "total_return" if all(
        r["adjusted_close"] is not None for r in rows) and rows else "price"
    return dates, closes, basis


# ────────────────────────── 指标 ──────────────────────────
def sma(closes, n):
    out = [None] * len(closes)
    s = 0.0
    for i, c in enumerate(closes):
        s += c
        if i >= n:
            s -= closes[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def rolling_max(closes, n):
    """前 n 日最高（不含当日）"""
    out = [None] * len(closes)
    for i in range(n, len(closes)):
        out[i] = max(closes[i - n:i])
    return out


def rsi_wilder(closes, period):
    """Wilder RSI；未成型期为 None"""
    out = [None] * len(closes)
    if len(closes) < period + 1:
        return out
    ag = al = 0.0
    for i in range(1, len(closes)):
        ch = closes[i] - closes[i - 1]
        g, l = max(ch, 0.0), max(-ch, 0.0)
        if i <= period:
            ag += g / period
            al += l / period
            if i == period:
                out[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
        else:
            ag = (ag * (period - 1) + g) / period
            al = (al * (period - 1) + l) / period
            out[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return out


# ────────────────────────── 策略信号 ──────────────────────────
def sig_buy_hold(closes):
    """首日建仓后永不卖出（s[0]=1 → 第 1 日起持有全段收益）"""
    return [1] * len(closes)


def sig_sma(closes, window=200):
    ma = sma(closes, window)
    return [1 if (ma[i] is not None and closes[i] > ma[i]) else 0
            for i in range(len(closes))]


def sig_rsi2_dip(closes, rsi_buy=10, trend=200, exit_ma=5):
    """站上 MA200 的前提下，RSI(2) 超卖进场，收盘上穿 MA5 离场"""
    r2 = rsi_wilder(closes, 2)
    ma_t = sma(closes, trend)
    ma_e = sma(closes, exit_ma)
    entries = [r2[i] is not None and r2[i] < rsi_buy
               and ma_t[i] is not None and closes[i] > ma_t[i]
               for i in range(len(closes))]
    exits = [ma_e[i] is not None and closes[i] > ma_e[i]
             for i in range(len(closes))]
    return _state_machine(entries, exits)


def sig_dip_buy(closes, lookback=60, dd_trigger=-0.10, max_hold=HOLD_MAX):
    """自前高回撤超阈值进场，收复入场时的前高（或超时）离场"""
    highs = rolling_max(closes, lookback)
    n = len(closes)
    s = [0] * n
    in_pos = False
    ref_high = None
    hold = 0
    for i in range(n):
        if in_pos:
            hold += 1
            if (ref_high is not None and closes[i] >= ref_high) or hold >= max_hold:
                in_pos = False
                ref_high = None
                hold = 0
        elif highs[i] is not None and closes[i] / highs[i] - 1 <= dd_trigger:
            in_pos = True
            ref_high = highs[i]
            hold = 0
        s[i] = 1 if in_pos else 0
    return s


def _state_machine(entries, exits):
    """通用进出仓状态机：离场信号优先于进场"""
    n = len(entries)
    s = [0] * n
    in_pos = False
    for i in range(n):
        if in_pos:
            if exits[i]:
                in_pos = False
        elif entries[i]:
            in_pos = True
        s[i] = 1 if in_pos else 0
    return s


STRATEGIES = [
    ("buy_hold", "买入持有", "基准：首日买入永不卖出，一切策略的对照线",
     sig_buy_hold, None),
    ("sma200", "200日线趋势过滤", "收盘>MA200 持有、线下空仓。胜率不高但砍掉大部分熊市回撤（高 Calmar 代表）",
     sig_sma, None),
    ("rsi2_dip", "RSI(2) 超卖回归", "MA200 上方 RSI(2)<10 进场，收盘>MA5 离场。历史胜率 75%+ 的均值回归代表（负偏度）",
     sig_rsi2_dip, {
         "rsi_buy": [5, 10, 15, 20],
     }),
    ("dip_buy", "回撤 10% 加仓", "自 60 日高点回撤≥10% 进场，收复前高或持仓一年离场",
     sig_dip_buy, None),
]
SENSITIVITY_SMA_WINDOWS = [100, 150, 200, 250]


# ────────────────────────── 回测引擎 ──────────────────────────
def run_backtest(dates, closes, desired):
    """desired[i]=t 日收盘后的目标仓位 → t+1 生效。

    返回 (pos_during, strat_rets, trades)：
      trades: [{entryDate, exitDate, entryPx, exitPx, ret, holdDays}]
      仓位翻日 i 的成交发生在 i-1 收盘（信号生效时点）。
    """
    n = len(closes)
    pos_during = [0] * n
    for i in range(1, n):
        pos_during[i] = desired[i - 1]

    cost = COST_BPS / 1e4
    strat_rets = [0.0] * n
    for i in range(1, n):
        r = closes[i] / closes[i - 1] - 1 if closes[i - 1] > 0 else 0.0
        turnover = abs(pos_during[i] - pos_during[i - 1])
        strat_rets[i] = pos_during[i] * r - (cost * turnover if turnover else 0.0)

    trades = []
    entry_i = None
    for i in range(1, n):
        if pos_during[i] == 1 and pos_during[i - 1] == 0:
            entry_i = i - 1
        elif pos_during[i] == 0 and pos_during[i - 1] == 1 and entry_i is not None:
            exit_i = i - 1
            trades.append({
                "entryDate": dates[entry_i], "exitDate": dates[exit_i],
                "entryPx": closes[entry_i], "exitPx": closes[exit_i],
                "ret": round(closes[exit_i] / closes[entry_i] - 1, 4),
                "holdDays": _cal_days(dates[entry_i], dates[exit_i]),
            })
            entry_i = None
    if entry_i is not None:  # 仍持仓 → 用最后收盘虚拟结算（不计入胜率统计？计入，标注未平仓）
        trades.append({
            "entryDate": dates[entry_i], "exitDate": dates[-1],
            "entryPx": closes[entry_i], "exitPx": closes[-1],
            "ret": round(closes[-1] / closes[entry_i] - 1, 4),
            "holdDays": _cal_days(dates[entry_i], dates[-1]),
            "open": True,
        })
    return pos_during, strat_rets, trades


def _cal_days(d1, d2):
    try:
        return (date.fromisoformat(d2) - date.fromisoformat(d1)).days
    except Exception:
        return None


def equity_curve(strat_rets):
    eq = [1.0]
    for r in strat_rets[1:]:
        eq.append(eq[-1] * (1 + r))
    return eq


def max_drawdown(equity):
    peak, mdd = equity[0], 0.0
    for v in equity:
        peak = max(peak, v)
        if peak > 0:
            mdd = min(mdd, v / peak - 1)
    return mdd


def perf_metrics(dates, equity, strat_rets, pos_during):
    n_years = _cal_days(dates[0], dates[-1]) / 365.25
    total = equity[-1]
    cagr = total ** (1 / n_years) - 1 if n_years > 0.5 and total > 0 else None
    rets = strat_rets[1:]
    mean_r = sum(rets) / len(rets)
    vol = sqrt(sum((r - mean_r) ** 2 for r in rets) / max(len(rets) - 1, 1)) * sqrt(TRADING_DAYS)
    downside = sqrt(sum(min(r, 0) ** 2 for r in rets) / len(rets)) * sqrt(TRADING_DAYS)
    mdd = max_drawdown(equity)
    return {
        "totalReturn": round(total - 1, 4),
        "cagr": round(cagr, 4) if cagr is not None else None,
        "vol": round(vol, 4) if vol > 0 else None,
        "sharpe": round(cagr / vol, 2) if cagr is not None and vol > 0 else None,
        "sortino": round(cagr / downside, 2) if cagr is not None and downside > 0 else None,
        "maxDD": round(mdd, 4),
        "calmar": round(cagr / abs(mdd), 2) if cagr is not None and mdd < 0 else None,
        "exposure": round(sum(pos_during) / len(pos_during), 4),
        "currentPosition": pos_during[-1],
    }


def trade_stats(trades):
    closed = [t for t in trades if not t.get("open")]
    wins = [t["ret"] for t in closed if t["ret"] > 0]
    losses = [t["ret"] for t in closed if t["ret"] <= 0]
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    holds = [t["holdDays"] for t in closed if t["holdDays"]]
    return {
        "nTrades": len(closed),
        "openTrades": len(trades) - len(closed),
        "winRate": round(len(wins) / len(closed), 4) if closed else None,
        "avgWin": round(sum(wins) / len(wins), 4) if wins else None,
        "avgLoss": round(sum(losses) / len(losses), 4) if losses else None,
        "profitFactor": round(gross_win / gross_loss, 2) if gross_loss > 0 else None,
        "expectancy": round(sum(t["ret"] for t in closed) / len(closed), 4) if closed else None,
        "avgHoldDays": round(sum(holds) / len(holds)) if holds else None,
        "bestTrade": max((t["ret"] for t in closed), default=None),
        "worstTrade": min((t["ret"] for t in closed), default=None),
    }


def annual_returns(dates, equity):
    """自然年收益（年末权益对上年年末权益）"""
    year_last = {}
    for d, v in zip(dates, equity):
        year_last[d[:4]] = v
    years = sorted(year_last)
    out = []
    for i in range(1, len(years)):
        prev, cur = year_last[years[i - 1]], year_last[years[i]]
        if prev > 0:
            out.append({"year": int(years[i]), "ret": round(cur / prev - 1, 4)})
    return out


def oos_split(dates, date_idx, strat_rets, trades):
    """70/30 样本内外分段：按策略自身日收益重构分段权益，胜率按分段内进场的交易"""
    n = len(dates)
    split_i = int(n * OOS_SPLIT)
    segs = {}
    for name, lo, hi in (("inSample", 0, split_i), ("outSample", split_i, n)):
        if hi - lo < 30:
            segs[name] = None
            continue
        eq = [1.0]
        for i in range(lo + 1, hi):
            eq.append(eq[-1] * (1 + strat_rets[i]))
        yrs = _cal_days(dates[lo], dates[hi - 1]) / 365.25
        cagr = eq[-1] ** (1 / yrs) - 1 if yrs > 0.5 and eq[-1] > 0 else None
        seg_trades = [t for t in trades
                      if not t.get("open") and lo <= date_idx.get(t["entryDate"], lo) < hi]
        wins = [t for t in seg_trades if t["ret"] > 0]
        segs[name] = {
            "start": dates[lo], "end": dates[hi - 1],
            "cagr": round(cagr, 4) if cagr is not None else None,
            "maxDD": round(max_drawdown(eq), 4),
            "winRate": round(len(wins) / len(seg_trades), 4) if seg_trades else None,
            "nTrades": len(seg_trades),
        }
    return segs


def monthly_sample(dates, *series_list):
    """每月最后一个交易日采样，返回 (month_dates, [sampled_series...])"""
    md, idxs, last = [], [], None
    for i, d in enumerate(dates):
        cur = (d[:4], d[5:7])
        if last is not None and cur != last:
            md.append(dates[i - 1])
            idxs.append(i - 1)
        last = cur
    if dates:
        md.append(dates[-1])
        idxs.append(len(dates) - 1)
    return md, [ [s[i] for i in idxs] for s in series_list ]


def sensitivity_rsi2(dates, closes):
    out = []
    for v in [5, 10, 15, 20]:
        s = sig_rsi2_dip(closes, rsi_buy=v)
        pos, rets, trades = run_backtest(dates, closes, s)
        m = perf_metrics(dates, equity_curve(rets), rets, pos)
        t = trade_stats(trades)
        out.append({"param": v, "cagr": m["cagr"], "maxDD": m["maxDD"],
                    "winRate": t["winRate"], "nTrades": t["nTrades"]})
    return out


def sensitivity_sma(dates, closes):
    out = []
    for w in SENSITIVITY_SMA_WINDOWS:
        s = sig_sma(closes, window=w)
        pos, rets, trades = run_backtest(dates, closes, s)
        m = perf_metrics(dates, equity_curve(rets), rets, pos)
        t = trade_stats(trades)
        out.append({"param": w, "cagr": m["cagr"], "maxDD": m["maxDD"],
                    "winRate": t["winRate"], "nTrades": t["nTrades"]})
    return out


def compute_symbol(symbol, name_zh, dates, closes, basis):
    n = len(dates)
    date_idx = {d: i for i, d in enumerate(dates)}
    strategies = []
    eq_list = []

    for key, label, desc, sig_fn, sens in STRATEGIES:
        s = sig_fn(closes)
        pos, rets, trades = run_backtest(dates, closes, s)
        eq = equity_curve(rets)
        eq_list.append(eq)
        metrics = perf_metrics(dates, eq, rets, pos)
        tstats = trade_stats(trades)
        item = {
            "key": key, "labelZh": label, "desc": desc,
            "params": (
                {"rsiBuy": 10, "trendMa": 200, "exitMa": 5} if key == "rsi2_dip"
                else {"window": 200} if key == "sma200"
                else {"lookback": 60, "ddTrigger": -0.10} if key == "dip_buy"
                else {}
            ),
            "metrics": {**metrics, **tstats},
            "annual": annual_returns(dates, eq),
            "oos": oos_split(dates, date_idx, rets, trades),
        }
        if sens and key == "rsi2_dip":
            item["sensitivity"] = sensitivity_rsi2(dates, closes)
        if key == "sma200":
            item["sensitivity"] = sensitivity_sma(dates, closes)
        strategies.append(item)

    # 内部一致性：买入持有终值应≈价格比（差一次建仓成本）
    bh_ratio = eq_list[0][-1]
    px_ratio = closes[-1] / closes[0]
    if abs(bh_ratio - px_ratio * (1 - COST_BPS / 1e4)) > 0.002:
        raise SyncError(
            "backtest 引擎异常: buy_hold 终值 %s 与价格比 %s 不一致 @%s"
            % (bh_ratio, px_ratio, symbol))

    month_dates, sampled = monthly_sample(dates, *eq_list)
    return {
        "symbol": symbol,
        "nameZh": name_zh,
        "basis": basis,
        "basisLabel": "全收益(含分红)" if basis == "total_return" else "价格(不含分红)",
        "period": {"start": dates[0], "end": dates[-1], "nDays": n},
        "costBps": COST_BPS,
        "equityDates": month_dates,
        "strategies": strategies,
        "_equitySampled": sampled,  # 内部使用，写 payload 前合并进 strategies
    }, sampled


def sync():
    with get_conn() as conn:
        symbols_out = {}
        for symbol, name_zh in SYMBOLS:
            dates, closes, basis = load_prices(conn, symbol)
            if len(dates) < 500:
                log.warning("  %s 仅 %d 天数据，跳过（回填未完成？）", symbol, len(dates))
                continue
            log.info("  %s: %d 天 (%s ~ %s, %s)", symbol, len(dates),
                     dates[0], dates[-1], basis)
            blk, sampled = compute_symbol(symbol, name_zh, dates, closes, basis)
            sampled_eq = blk.pop("_equitySampled")
            for strat, eq_month in zip(blk["strategies"], sampled_eq):
                strat["equity"] = {
                    "dates": blk["equityDates"],
                    "values": [round(v * 100, 2) for v in eq_month],  # 期初=100
                }
            symbols_out[symbol] = blk

        if not symbols_out:
            raise SyncError("etf_backtest: 无任何标的有可用价格数据")

        payload = {
            "symbols": symbols_out,
            "notes": [
                "信号 t 日收盘产生、t+1 收盘生效；成本按单边 %dbp 计" % COST_BPS,
                "胜率=盈利交易占已平仓交易比例；ProfitFactor=总盈利/总亏损",
                "样本内/外按 70/30 切分；两段表现差异大=过拟合警示",
                "Sharpe/Sortino 以 rf=0 计；权益曲线期初=100、月度采样",
            ],
            "disclaimer": "历史回测不代表未来表现。参数敏感性差、样本外衰减的策略应视为过拟合，不构成投资建议。",
            "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        }
        valid_from = max(v["period"]["end"] for v in symbols_out.values())
        upsert_analysis_result(conn, ENDPOINT, valid_from, payload)
        log.info("写入 analysis_results[%s]: %d 个标的, valid_from=%s",
                 ENDPOINT, len(symbols_out), valid_from)
        write_sync_log("analysis_etf_backtest", "success", len(symbols_out), "", ENDPOINT)


def main():
    log.info("=" * 60)
    log.info("开始预计算: ETF 策略回测")
    sync()


if __name__ == "__main__":
    main()

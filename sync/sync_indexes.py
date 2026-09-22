#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""同步美股四大指数历史数据，供宏观体制回测与指数对比图使用。

数据源: stooq.com（首选）→ Yahoo Finance（yfinance）→ Yahoo Finance（curl_cffi）
写入表: assets (注册), asset_prices (日线)
用法:
    python3 sync_indexes.py            # 同步全部指数
    python3 sync_indexes.py ^IXIC      # 同步单个指数
"""
import os
import sys
import time
import datetime
import calendar
import pandas as pd

from sync_base import (
    SyncError,
    _setup_logger, get_conn, write_sync_log, with_retry,
    bulk_upsert, drop_unsettled_today,
)

log = _setup_logger("sync_indexes")

# 符号 → (中文名, 英文名, 起始日期, stooq 符号)
INDEXES = [
    ("^GSPC", "标普500指数", "S&P 500", "1950-01-01", "^spx.us"),
    ("^IXIC", "纳斯达克综合指数", "Nasdaq Composite", "1971-01-01", "^ndq.us"),
    ("^DJI", "道琼斯工业平均", "Dow Jones Industrial", "1928-01-01", "^dji.us"),
    ("^RUT", "罗素2000", "Russell 2000", "1978-01-01", "^rut.us"),
]

# 标普 11 大行业中 ETF 流动性最好的代表 —— 用于「周期 vs 防御」相对强弱
# (symbol, name_zh, name_en, start_date, bucket)
#   bucket = 'cyclical' 或 'defensive'。stooq 不支持 ETF，走 yfinance / curl_cffi。
SECTOR_ETFS = [
    ("XLI", "工业精选行业 ETF", "Industrial Select Sector SPDR", "2000-01-01", "cyclical"),
    ("XLY", "可选消费精选行业 ETF", "Consumer Discretionary Select Sector SPDR",
     "2000-01-01", "cyclical"),
    ("XLE", "能源精选行业 ETF", "Energy Select Sector SPDR", "2000-01-01", "cyclical"),
    ("XLB", "原材料精选行业 ETF", "Materials Select Sector SPDR", "2000-01-01", "cyclical"),
    ("XLU", "公用事业精选行业 ETF", "Utilities Select Sector SPDR", "2000-01-01", "defensive"),
    ("XLP", "必需消费精选行业 ETF", "Consumer Staples Select Sector SPDR",
     "2000-01-01", "defensive"),
]

# 宽基核心 ETF —— 回撤/修复分析与策略回测的主力标的。
# 与指数不同，ETF 的 adjusted_close（分红再投资全收益口径）才是真实持有收益，
# 回撤与修复时间必须按全收益计算，否则修复时长被系统性高估。
# (symbol, name_zh, name_en, start_date) —— stooq 无 ETF，走 yfinance / curl_cffi。
CORE_ETFS = [
    ("SPY", "标普500ETF", "SPDR S&P 500 ETF Trust", "1993-02-01"),
    ("VOO", "标普500ETF(先锋)", "Vanguard S&P 500 ETF", "2010-09-01"),
    ("QQQ", "纳指100ETF", "Invesco QQQ Trust", "1999-03-10"),
]

YAHOO_TIMEOUT = 30
YAHOO_MAX_RETRY = 4


def ensure_asset(symbol, name_zh, name_en, sub_category="股票指数"):
    """注册指数资产，返回 asset_id"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM asset_categories WHERE code = 'index'")
            row = cur.fetchone()
            if row:
                cat_id = row["id"]
            else:
                cur.execute(
                    "INSERT INTO asset_categories (code, name_zh, name_en, sort_order) "
                    "VALUES (%s, %s, %s, %s)",
                    ("index", "指数", "Index", 10)
                )
                conn.commit()
                cur.execute("SELECT id FROM asset_categories WHERE code = 'index'")
                cat_id = cur.fetchone()["id"]

            cur.execute("SELECT id FROM assets WHERE symbol = %s", (symbol,))
            row = cur.fetchone()
            if row:
                return row["id"]

            cur.execute(
                "INSERT INTO assets (symbol, name_zh, name_en, category_id, sub_category, "
                "exchange, currency) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (symbol, name_zh, name_en, cat_id, sub_category, "NYSE", "USD")
            )
            conn.commit()
            log.info("注册新资产: %s (%s, sub=%s)", symbol, name_zh, sub_category)
            cur.execute("SELECT id FROM assets WHERE symbol = %s", (symbol,))
            return cur.fetchone()["id"]


def _fetch_via_yfinance(symbol, start):
    """使用 yfinance 拉取数据"""
    try:
        import yfinance as yf
        df = yf.download(symbol, start=start, progress=False,
                         auto_adjust=False, prepost=False, threads=False,
                         timeout=30)  # 不传 timeout 会依赖 yf 内部默认，挂起时最坏烧到 job 级超时
    except Exception as e:
        log.warning("yfinance %s 拉取异常: %s", symbol, e)
        return []

    if df is None or getattr(df, "empty", True):
        log.warning("yfinance %s 返回空", symbol)
        return []

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [str(c[-1]).strip() for c in df.columns]
    df = df.reset_index()

    date_col, close_col = None, None
    for c in df.columns:
        low = str(c).lower()
        if date_col is None and (low == "date" or low.startswith("date")):
            date_col = c
        if close_col is None and low == "close":
            close_col = c

    if date_col is None:
        date_col = df.columns[0]
    if close_col is None:
        log.warning("%s 未找到 Close 列: %s", symbol, list(df.columns))
        return []

    rows = []
    for _, r in df.iterrows():
        try:
            d = r[date_col]
            if isinstance(d, (datetime.datetime, datetime.date)):
                d = d.strftime("%Y-%m-%d")
            else:
                d = str(d)[:10]
            v = float(r[close_col])
            if d and v > 0:
                rows.append((d, v))
        except Exception:
            continue

    log.info("yfinance %s -> %d 条", symbol, len(rows))
    return rows


def _fetch_via_curl(symbol, start):
    """使用 curl_cffi 拉取 Yahoo Finance 数据"""
    from curl_cffi import requests as c_requests

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    period1 = calendar.timegm(time.strptime(start, "%Y-%m-%d"))
    period2 = int(time.time())
    params = {"period1": period1, "period2": period2, "interval": "1d"}

    last_err = None
    for attempt in range(1, YAHOO_MAX_RETRY + 1):
        try:
            r = c_requests.get(url, params=params, impersonate="chrome", timeout=YAHOO_TIMEOUT)
            if r.status_code != 200:
                last_err = "HTTP %d" % r.status_code
                log.warning("curl_cffi %s 状态码 %d（尝试 %d/%d）", symbol, r.status_code, attempt, YAHOO_MAX_RETRY)
                time.sleep(min(2 ** (attempt - 1), 15))
                continue
            j = r.json()
            res = (j.get("chart") or {}).get("result") or []
            if not res:
                last_err = "chart.result 为空"
                time.sleep(min(2 ** (attempt - 1), 15))
                continue
            ts = res[0].get("timestamp") or []
            closes = (res[0].get("indicators", {}).get("quote", [{}])[0]).get("close") or []
            rows = []
            for t_, c_ in zip(ts, closes):
                try:
                    d = datetime.datetime.utcfromtimestamp(t_).strftime("%Y-%m-%d")
                    v = float(c_)
                    if d and v > 0:
                        rows.append((d, v))
                except Exception:
                    continue
            rows.sort()
            if rows:
                log.info("curl_cffi %s -> %d 条", symbol, len(rows))
                return rows
            last_err = "拉取 0 条"
        except Exception as e:
            last_err = repr(e)[:120]
            log.warning("curl_cffi %s 异常: %s", symbol, e)
        time.sleep(min(2 ** (attempt - 1), 15))

    raise RuntimeError("Yahoo %s 拉取失败: %s" % (symbol, last_err))


def _fetch_ohlcv_yfinance(symbol, start):
    """yfinance 拉取 OHLCV + 复权收盘（auto_adjust=False 时 Adj Close 单列返回）"""
    try:
        import yfinance as yf
        df = yf.download(symbol, start=start, progress=False,
                         auto_adjust=False, prepost=False, threads=False,
                         timeout=30)
    except Exception as e:
        log.warning("yfinance %s OHLCV 拉取异常: %s", symbol, e)
        return []

    if df is None or getattr(df, "empty", True):
        log.warning("yfinance %s OHLCV 返回空", symbol)
        return []

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [str(c[-1]).strip() for c in df.columns]
    df = df.reset_index()

    col_map = {}
    for c in df.columns:
        low = str(c).lower().replace(" ", "")
        if low.startswith("date"):
            col_map["date"] = c
        elif low == "open":
            col_map["open"] = c
        elif low == "high":
            col_map["high"] = c
        elif low == "low":
            col_map["low"] = c
        elif low == "close":
            col_map["close"] = c
        elif low == "volume":
            col_map["volume"] = c
        elif low == "adjclose":
            col_map["adjclose"] = c

    if "date" not in col_map or "close" not in col_map:
        log.warning("%s OHLCV 缺关键列: %s", symbol, list(df.columns))
        return []

    rows = []
    for _, r in df.iterrows():
        try:
            d = r[col_map["date"]]
            d = d.strftime("%Y-%m-%d") if isinstance(d, (datetime.datetime, datetime.date)) else str(d)[:10]
            close = float(r[col_map["close"]])
            if not d or close <= 0:
                continue

            def _f(key):
                try:
                    return float(r[col_map[key]]) if key in col_map else None
                except Exception:
                    return None

            adj = _f("adjclose")
            rows.append((d, _f("open"), _f("high"), _f("low"), close,
                         _f("volume"), adj if adj and adj > 0 else close))
        except Exception:
            continue

    log.info("yfinance %s OHLCV -> %d 条", symbol, len(rows))
    return rows


def _fetch_ohlcv_curl(symbol, start):
    """curl_cffi 拉取 Yahoo v8 chart API 的 OHLCV + adjclose（绕限流兜底）"""
    from curl_cffi import requests as c_requests

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    period1 = calendar.timegm(time.strptime(start, "%Y-%m-%d"))
    period2 = int(time.time())
    params = {"period1": period1, "period2": period2, "interval": "1d",
              "events": "div,splits"}

    last_err = None
    for attempt in range(1, YAHOO_MAX_RETRY + 1):
        try:
            r = c_requests.get(url, params=params, impersonate="chrome", timeout=YAHOO_TIMEOUT)
            if r.status_code != 200:
                last_err = "HTTP %d" % r.status_code
                time.sleep(min(2 ** (attempt - 1), 15))
                continue
            res = ((r.json().get("chart") or {}).get("result") or [None])[0]
            if not res:
                last_err = "chart.result 为空"
                time.sleep(min(2 ** (attempt - 1), 15))
                continue
            ts = res.get("timestamp") or []
            quote = (res.get("indicators", {}).get("quote") or [{}])[0]
            adj = (res.get("indicators", {}).get("adjclose") or [{}])[0].get("adjclose") or []
            opens, highs, lows = quote.get("open") or [], quote.get("high") or [], quote.get("low") or []
            closes, volumes = quote.get("close") or [], quote.get("volume") or []
            rows = []
            for k, t_ in enumerate(ts):
                try:
                    d = datetime.datetime.utcfromtimestamp(t_).strftime("%Y-%m-%d")
                    close = float(closes[k]) if k < len(closes) and closes[k] is not None else 0
                    if not d or close <= 0:
                        continue
                    a = float(adj[k]) if k < len(adj) and adj[k] is not None else close
                    rows.append((
                        d,
                        float(opens[k]) if k < len(opens) and opens[k] is not None else None,
                        float(highs[k]) if k < len(highs) and highs[k] is not None else None,
                        float(lows[k]) if k < len(lows) and lows[k] is not None else None,
                        close,
                        float(volumes[k]) if k < len(volumes) and volumes[k] is not None else None,
                        a if a > 0 else close,
                    ))
                except Exception:
                    continue
            rows.sort(key=lambda x: x[0])
            if rows:
                log.info("curl_cffi %s OHLCV -> %d 条", symbol, len(rows))
                return rows
            last_err = "拉取 0 条"
        except Exception as e:
            last_err = repr(e)[:120]
            log.warning("curl_cffi %s OHLCV 异常: %s", symbol, e)
        time.sleep(min(2 ** (attempt - 1), 15))

    raise RuntimeError("Yahoo %s OHLCV 拉取失败: %s" % (symbol, last_err))


def _fetch_via_stooq(symbol, stooq_symbol, start):
    """使用 stooq.com 拉取数据（免费，无需 API Key）"""
    import requests

    url = f"https://stooq.com/q/d/l/?s={stooq_symbol}&d1={start.replace('-', '')}&d2={datetime.date.today().strftime('%Y%m%d')}&i=d"

    try:
        r = with_retry(lambda: requests.get(url, timeout=30), timeout=30, max_retry=3)
        text = r.text.strip()

        if "No data" in text or len(text) < 100:
            log.warning("stooq.com %s 返回空数据", symbol)
            return []

        rows = []
        lines = text.split('\n')
        for line in lines[1:]:  # 跳过表头
            parts = line.strip().split(',')
            if len(parts) >= 5:
                try:
                    d = parts[0]  # Date
                    v = float(parts[4])  # Close
                    if d and v > 0:
                        rows.append((d, v))
                except (ValueError, IndexError):
                    continue

        log.info("stooq.com %s -> %d 条", symbol, len(rows))
        return rows

    except Exception as e:
        log.warning("stooq.com %s 获取失败: %s", symbol, e)
        return []


def fetch_index_history(symbol, stooq_symbol, start):
    """从多个数据源拉取指数历史日线收盘价 -> [(date, close)]"""
    rows = _fetch_via_stooq(symbol, stooq_symbol, start)
    if not rows:
        rows = _fetch_via_yfinance(symbol, start)
    if not rows:
        rows = _fetch_via_curl(symbol, start)
    return drop_unsettled_today(rows)


def upsert_prices(asset_id, rows):
    """批量写入 asset_prices"""
    if not rows:
        return 0
    payload = [(asset_id, d, v) for d, v in rows]
    with get_conn() as conn:
        with conn.cursor() as cur:
            return bulk_upsert(
                conn, cur, "asset_prices",
                ["asset_id", "trade_date", "close_price"],
                payload, ["asset_id", "trade_date"], ["close_price"]
            )


def sync_one(symbol, name_zh, name_en, start, stooq_symbol, sub_category="股票指数"):
    """同步单个指数，返回写入行数"""
    asset_id = ensure_asset(symbol, name_zh, name_en, sub_category=sub_category)
    log.info("asset_id(%s) = %d", symbol, asset_id)
    rows = fetch_index_history(symbol, stooq_symbol, start)
    return asset_id, upsert_prices(asset_id, rows)


def sync_sector_etf(symbol, name_zh, name_en, start, bucket):
    """同步单个行业 ETF（无 stooq 通道，仅 yfinance / curl_cffi）。"""
    asset_id = ensure_asset(
        symbol, name_zh, name_en,
        sub_category="行业ETF·%s" % ("周期" if bucket == "cyclical" else "防御"),
    )
    rows = _fetch_via_yfinance(symbol, start)
    if not rows:
        rows = _fetch_via_curl(symbol, start)
    return asset_id, upsert_prices(asset_id, rows)


def upsert_ohlcv(asset_id, rows):
    """批量写入 asset_prices（含 OHLCV + adjusted_close，全收益口径）"""
    if not rows:
        return 0
    payload = [(asset_id,) + tuple(r) for r in rows]
    with get_conn() as conn:
        with conn.cursor() as cur:
            return bulk_upsert(
                conn, cur, "asset_prices",
                ["asset_id", "trade_date", "open_price", "high_price", "low_price",
                 "close_price", "volume", "adjusted_close"],
                payload, ["asset_id", "trade_date"],
                ["open_price", "high_price", "low_price", "close_price",
                 "volume", "adjusted_close"]
            )


def sync_core_etf(symbol, name_zh, name_en, start):
    """同步单个宽基 ETF 的 OHLCV + 复权价（无 stooq 通道）。"""
    asset_id = ensure_asset(symbol, name_zh, name_en, sub_category="宽基ETF")
    rows = _fetch_ohlcv_yfinance(symbol, start)
    if not rows:
        rows = _fetch_ohlcv_curl(symbol, start)
    rows = drop_unsettled_today(rows)
    return asset_id, upsert_ohlcv(asset_id, rows)


def main():
    log.info("=" * 60)
    log.info("开始同步: 美股四大指数 + 行业 ETF + 宽基 ETF")

    only = sys.argv[1] if len(sys.argv) > 1 else None

    total = 0
    errors = []

    if only:
        # 单 symbol 模式：支持指数（^GSPC）/ 行业 ETF（XLI）/ 宽基 ETF（SPY）
        targets_idx = [t for t in INDEXES if t[0] == only]
        targets_etf = [t for t in SECTOR_ETFS if t[0] == only]
        targets_core = [t for t in CORE_ETFS if t[0] == only]
    else:
        targets_idx = INDEXES
        targets_etf = SECTOR_ETFS
        targets_core = CORE_ETFS

    if not targets_idx and not targets_etf and not targets_core and only:
        log.error("未知标的: %s", only)
        write_sync_log("indices", "failed", 0, "未知标的 %s" % only)
        return

    for symbol, name_zh, name_en, start, stooq_symbol in targets_idx:
        try:
            _, n = sync_one(symbol, name_zh, name_en, start, stooq_symbol)
            total += n
            log.info("[%s] 写入 %d 条", symbol, n)
        except Exception as e:
            log.error("[%s] 同步失败: %s", symbol, e)
            errors.append("%s: %s" % (symbol, e))
        time.sleep(1)

    for symbol, name_zh, name_en, start, bucket in targets_etf:
        try:
            _, n = sync_sector_etf(symbol, name_zh, name_en, start, bucket)
            total += n
            log.info("[%s/%s] 写入 %d 条", symbol, bucket, n)
        except Exception as e:
            log.error("[%s] 同步失败: %s", symbol, e)
            errors.append("%s: %s" % (symbol, e))
        time.sleep(1)

    for symbol, name_zh, name_en, start in targets_core:
        try:
            _, n = sync_core_etf(symbol, name_zh, name_en, start)
            total += n
            log.info("[%s/宽基] 写入 %d 条", symbol, n)
        except Exception as e:
            log.error("[%s] 同步失败: %s", symbol, e)
            errors.append("%s: %s" % (symbol, e))
        time.sleep(1)

    status = "failed" if errors and total == 0 else ("partial" if errors else "success")
    msg = "indices+etfs 写入 %d 行；失败 %d 项" % (total, len(errors))
    if errors:
        msg += "；" + "; ".join(errors[:3])
    log.info(msg)
    write_sync_log("indices", status, total, msg)
    if errors:
        raise SyncError("indices 有 %d 项失败: %s" % (len(errors), "; ".join(errors[:3])))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""同步 S&P500 指数历史数据，供宏观体制回测使用。

数据源: Yahoo Finance (^GSPC)
写入表: assets (注册), asset_prices (日线)
用法:
    python3 sync_sp500.py
"""
import os
import sys
import time
import datetime
import pandas as pd

from sync_base import (
    _setup_logger, get_conn, write_sync_log, with_retry,
    bulk_upsert,
)

log = _setup_logger("sync_sp500")

SYMBOL = "^GSPC"
NAME_ZH = "标普500指数"
NAME_EN = "S&P 500"
START = "1950-01-01"  # S&P500 历史数据起点

YAHOO_TIMEOUT = 30
YAHOO_MAX_RETRY = 4


def ensure_asset():
    """注册 S&P500 资产，返回 asset_id"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 确保有 index 类别
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

            # 检查是否已存在
            cur.execute("SELECT id FROM assets WHERE symbol = %s", (SYMBOL,))
            row = cur.fetchone()
            if row:
                return row["id"]

            # 新增资产
            cur.execute(
                "INSERT INTO assets (symbol, name_zh, name_en, category_id, sub_category, "
                "exchange, currency) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (SYMBOL, NAME_ZH, NAME_EN, cat_id, "股票指数", "NYSE", "USD")
            )
            conn.commit()
            log.info("注册新资产: %s (%s)", SYMBOL, NAME_ZH)
            cur.execute("SELECT id FROM assets WHERE symbol = %s", (SYMBOL,))
            return cur.fetchone()["id"]


def _fetch_via_yfinance(symbol, start):
    """使用 yfinance 拉取数据"""
    try:
        import yfinance as yf
        df = yf.download(symbol, start=start, progress=False,
                         auto_adjust=False, prepost=False, threads=False)
    except Exception as e:
        log.warning("yfinance %s 拉取异常: %s", symbol, e)
        return []

    if df is None or getattr(df, "empty", True):
        log.warning("yfinance %s 返回空", symbol)
        return []

    # 处理 MultiIndex 列
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
    import calendar
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


def _fetch_via_stooq(symbol, start):
    """使用 stooq.com 拉取数据（免费，无需 API Key）"""
    import requests

    # stooq 符号: ^GSPC -> ^spx.us
    stooq_symbol = "^spx.us"
    url = f"https://stooq.com/q/d/l/?s={stooq_symbol}&d1={start.replace('-', '')}&d2={datetime.date.today().strftime('%Y%m%d')}&i=d"

    try:
        r = with_retry(lambda: requests.get(url, timeout=30), timeout=30, max_retry=3)
        text = r.text.strip()

        # 检查是否有数据
        if "No data" in text or len(text) < 100:
            log.warning("stooq.com 返回空数据")
            return []

        # 解析 CSV
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


def fetch_sp500_history():
    """从多个数据源拉取 S&P500 历史日线收盘价 -> [(date, close)]"""
    # 按优先级尝试: stooq -> yfinance -> curl_cffi
    rows = _fetch_via_stooq(SYMBOL, START)
    if rows:
        return rows

    rows = _fetch_via_yfinance(SYMBOL, START)
    if rows:
        return rows

    rows = _fetch_via_curl(SYMBOL, START)
    return rows


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


def main():
    log.info("=" * 60)
    log.info("开始同步: S&P500 指数")

    total = 0
    errors = []

    # 1. 注册资产
    try:
        asset_id = ensure_asset()
        log.info("S&P500 asset_id = %d", asset_id)
    except Exception as e:
        log.error("注册资产失败: %s", e)
        write_sync_log("sp500", "failed", 0, str(e))
        return

    # 2. 拉取历史数据
    try:
        rows = fetch_sp500_history()
        n = upsert_prices(asset_id, rows)
        total += n
        log.info("[S&P500 历史] 写入 %d 条", n)
    except Exception as e:
        log.error("[S&P500 历史] 失败: %s", e)
        errors.append(str(e))

    status = "success" if not errors and total > 0 else ("partial" if total > 0 else "failed")
    msg = "sp500 写入 %d 行；失败 %d 项" % (total, len(errors))
    if errors:
        msg += "；" + "; ".join(errors[:3])
    log.info(msg)
    write_sync_log("sp500", status, total, msg)


if __name__ == "__main__":
    main()

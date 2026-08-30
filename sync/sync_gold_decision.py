#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示模块：黄金决策（/signals/gold，同时供组合信号板的黄金信号卡）

页面内容对应的数据：
  1. 双轴价格 + 收益率滚动相关  -> 金价历史（gold_price_history）+ 美元指数 DXY（asset_prices）
  2. 双因子定价残差              -> 金价 + DXY + DFII10 + T10YIE
  3. 相关性失效 / 残差极端事件研究 -> 同上（历史序列越长越好）

数据源:
  - 金价历史:   Yahoo Finance（source=yfinance；symbol=GC=F，COMEX 黄金期货 USD/oz）
  - 今日金价:   gold-api.com（source=gold-api）
  - DXY:        Yahoo Finance（DX-Y.NYB）
  - DFII10/T10YIE: FRED（走 indicators 注册表）
写入表: gold_price_history, asset_prices, assets, indicators, indicator_data, data_sync_logs
用法:
    python3 sync_gold_decision.py
"""
import os
import re
import time
import calendar
import datetime
import pandas

import yfinance as yf

from sync_base import (
    _setup_logger, get_conn, write_sync_log, with_retry, safe_dec, bulk_upsert,
)
from indicators import sync_indicators


log = _setup_logger("sync_gold_decision")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Yahoo Finance 符号
GOLD_SYMBOL = "GC=F"          # COMEX 黄金期货（USD/oz）
DXY_SYMBOL = "DX-Y.NYB"       # 美元指数
GOLD_START = "2010-01-01"
DXY_START = "2010-01-01"

GOLD_API_URL = "https://api.gold-api.com/price/XAU"
HTTP_TIMEOUT = 30


# =====================================================================
# 建表
# =====================================================================
def ensure_tables():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS gold_price_history (
                    id BIGSERIAL PRIMARY KEY,
                    source VARCHAR(40) NOT NULL,
                    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
                    unit VARCHAR(20) NOT NULL DEFAULT 'OZ',
                    price_date DATE NOT NULL,
                    close_price NUMERIC(18,4) NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    CONSTRAINT uk_gold_price_source_date UNIQUE (source, price_date)
                )
            """)
        conn.commit()


# =====================================================================
# 日期解析
# =====================================================================
def _parse_date(val):
    if val is None:
        return None
    if isinstance(val, (datetime.datetime, datetime.date)):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    if not s:
        return None
    m = re.search(r"(\d{4})[-/\.](\d{1,2})[-/\.](\d{1,2})", s)
    if m:
        return "%04d-%02d-%02d" % (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.search(r"(\d{4})[-/](\d{1,2})", s)
    if m:
        return "%04d-%02d-01" % (int(m.group(1)), int(m.group(2)))
    if s.isdigit() and len(s) == 8:
        return "%s-%s-%s" % (s[:4], s[4:6], s[6:8])
    return None


# =====================================================================
# 远程数据
# =====================================================================
def fetch_today_gold_price():
    """gold-api.com 今日伦敦金价（XAU/USD）"""
    import requests
    try:
        r = with_retry(lambda: requests.get(GOLD_API_URL, timeout=HTTP_TIMEOUT),
                       timeout=HTTP_TIMEOUT, max_retry=3)
        data = r.json()
    except Exception as e:
        log.warning("gold-api.com 今日金价拉取失败: %s", e)
        return []
    price = safe_dec(data.get("price"), 4)
    if not price or float(price) <= 0:
        log.warning("gold-api.com 返回价格无效")
        return []
    d = None
    for key in ("updatedAt", "timestamp", "date"):
        if data.get(key):
            m = re.search(r"(\d{4}-\d{2}-\d{2})", str(data[key]))
            if m:
                d = m.group(1)
                break
    if d is None:
        d = datetime.date.today().isoformat()
    log.info("今日金价 (gold-api.com): %s = %.2f USD/oz", d, float(price))
    return [(d, float(price))]


YAHOO_TIMEOUT = 30
YAHOO_MAX_RETRY = 4


def _yahoo_via_yfinance(symbol, start):
    """用 yfinance 拉取 Yahoo 日线收盘价 -> [(date, close)]；拉空/异常返回 []（不抛）"""
    try:
        df = yf.download(symbol, start=start, progress=False,
                         auto_adjust=False, prepost=False, threads=False)
    except Exception as e:
        log.warning("yfinance %s 拉取异常: %s", symbol, e)
        return []

    if df is None or getattr(df, "empty", True):
        log.warning("yfinance %s 返回空", symbol)
        return []

    if isinstance(df.columns, pandas.MultiIndex):
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
            d = _parse_date(r[date_col])
            v = float(r[close_col])
            if d and v > 0:
                rows.append((d, v))
        except Exception:
            continue
    log.info("yfinance %s -> %d 条", symbol, len(rows))
    return rows


def _yahoo_via_curl(symbol, start):
    """curl_cffi 浏览器伪造直连 Yahoo chart API（境外 / GHA 更稳）-> [(date, close)]。

    连续失败抛 RuntimeError（区别于 yfinance 的静默返回空），保证不被记成"假成功"。
    """
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


def fetch_gold_history():
    """Yahoo Finance 拉取 COMEX 黄金期货（GC=F）历史日线收盘价 -> [(date, close)]"""
    rows = _yahoo_via_yfinance(GOLD_SYMBOL, GOLD_START)
    if not rows:
        rows = _yahoo_via_curl(GOLD_SYMBOL, GOLD_START)
    log.info("金价历史 %s -> %d 条", GOLD_SYMBOL, len(rows))
    return rows


def ensure_dxy_asset():
    """注册 DXY 资产，返回 asset_id"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM asset_categories WHERE code = 'fx'")
            row = cur.fetchone()
            if row:
                cat_id = row["id"]
            else:
                cur.execute(
                    "INSERT INTO asset_categories (code, name_zh, name_en, sort_order) "
                    "VALUES (%s, %s, %s, %s)", ("fx", "外汇", "Forex", 5))
                conn.commit()
                cur.execute("SELECT id FROM asset_categories WHERE code = 'fx'")
                cat_id = cur.fetchone()["id"]
            cur.execute("SELECT id FROM assets WHERE symbol = %s", (DXY_SYMBOL,))
            row = cur.fetchone()
            if row:
                return row["id"]
            cur.execute(
                "INSERT INTO assets (symbol, name_zh, name_en, category_id, sub_category, "
                "exchange, currency) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (DXY_SYMBOL, "美元指数", "US Dollar Index", cat_id, "外汇", "FOREX", "USD"))
            conn.commit()
            log.info("注册新资产: %s (美元指数)", DXY_SYMBOL)
            cur.execute("SELECT id FROM assets WHERE symbol = %s", (DXY_SYMBOL,))
            return cur.fetchone()["id"]


def fetch_dxy_history():
    """Yahoo Finance 拉取美元指数历史日线收盘价 -> [(date, close)]"""
    rows = _yahoo_via_yfinance(DXY_SYMBOL, DXY_START)
    if not rows:
        rows = _yahoo_via_curl(DXY_SYMBOL, DXY_START)
    log.info("DXY %s -> %d 条", DXY_SYMBOL, len(rows))
    return rows


# =====================================================================
# 写入
# =====================================================================
def upsert_prices(rows, source):
    if not rows:
        return 0
    payload = [(source, "USD", "OZ", d, v) for d, v in rows]
    with get_conn() as conn:
        with conn.cursor() as cur:
            return bulk_upsert(
                conn, cur, "gold_price_history",
                ["source", "currency", "unit", "price_date", "close_price"],
                payload, ["source", "price_date"], ["close_price"])


def upsert_dxy(asset_id, rows):
    if not rows:
        return 0
    payload = [(asset_id, d, v) for d, v in rows]
    with get_conn() as conn:
        with conn.cursor() as cur:
            return bulk_upsert(
                conn, cur, "asset_prices",
                ["asset_id", "trade_date", "close_price"],
                payload, ["asset_id", "trade_date"], ["close_price"])


# =====================================================================
def main():
    log.info("=" * 60)
    log.info("开始同步展示模块数据: 黄金决策")

    ensure_tables()
    total = 0
    errors = []

    steps = [
        ("金价历史(yfinance)", lambda: upsert_prices(fetch_gold_history(), "yfinance")),
        ("今日金价(gold-api)", lambda: upsert_prices(fetch_today_gold_price(), "gold-api")),
        ("美元指数 DXY", lambda: upsert_dxy(ensure_dxy_asset(), fetch_dxy_history())),
    ]
    for name, fn in steps:
        try:
            n = fn()
            total += n
            log.info("[%s] 写入 %d 条", name, n)
        except Exception as e:
            log.error("[%s] 失败: %s", name, e)
            errors.append("%s: %s" % (name, e))

    # 双因子模型用到的实际利率与通胀预期（FRED）
    _, ind_errors = sync_indicators("gold_decision", [("DFII10", "US"), ("T10YIE", "US")])
    errors.extend(ind_errors)

    status = "success" if not errors and total > 0 else ("partial" if total > 0 else "failed")
    msg = "gold_decision 写入 %d 行；失败 %d 项；%s" % (total, len(errors), "; ".join(errors[:5]))
    log.info(msg)
    write_sync_log("gold_decision", status, total, msg)


if __name__ == "__main__":
    main()

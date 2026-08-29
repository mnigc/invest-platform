#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示模块：黄金决策（/signals/gold，同时供组合信号板的黄金信号卡）

页面四块内容对应的数据：
  1. 双轴价格 + 收益率滚动相关  -> 金价历史（gold_price_history）+ 美元指数 DXY（asset_prices）
  2. 双因子定价残差              -> 金价 + DXY + DFII10 + T10YIE
  3. 相关性失效 / 残差极端事件研究 -> 同上（历史序列越长越好）
  4. 央行购金                    -> gold_reserve_changes

数据源:
  - 金价历史:   本地 gold_price.xlsx（source=LOCAL-XLSX）
  - 今日金价:   gold-api.com（source=gold-api）
  - 央行购金:   本地 gold_changes.xlsx（IMF/世界黄金协会月度变动）
  - DXY:        Yahoo Finance（DX-Y.NYB）
  - DFII10/T10YIE: FRED（走 indicators 注册表）
写入表: gold_price_history, gold_reserve_changes, asset_prices, assets,
        indicators, indicator_data, data_sync_logs
用法:
    python3 sync_gold_decision.py
"""
import os
import re
import datetime

import yfinance as yf

from sync_base import (
    _setup_logger, get_conn, write_sync_log, with_retry, safe_dec, bulk_upsert,
)
from indicators import sync_indicators


log = _setup_logger("sync_gold_decision")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_CHANGES_XLSX = os.path.join(SCRIPT_DIR, "gold_changes.xlsx")
LOCAL_PRICE_XLSX = os.path.join(SCRIPT_DIR, "gold_price.xlsx")

GOLD_API_URL = "https://api.gold-api.com/price/XAU"
DXY_SYMBOL = "DX-Y.NYB"
DXY_START = "2010-01-01"
HTTP_TIMEOUT = 30

# 主要央行中文名（仅用于 gold_reserve_changes.country_name_cn 可读性）
CN_NAME = {
    "China, P.R.: Mainland": "中国", "China": "中国",
    "United States": "美国", "Germany": "德国", "Italy": "意大利", "France": "法国",
    "Russia": "俄罗斯", "Switzerland": "瑞士", "India": "印度", "Japan": "日本",
    "Turkey": "土耳其", "Netherlands, The": "荷兰", "Poland": "波兰",
    "Uzbekistan, Rep. of": "乌兹别克斯坦", "Kazakhstan, Rep. of": "哈萨克斯坦",
    "Saudi Arabia": "沙特阿拉伯", "United Kingdom": "英国", "Spain": "西班牙",
    "Austria": "奥地利", "Thailand": "泰国", "Belgium": "比利时", "Singapore": "新加坡",
    "Taiwan Province of China": "中国台湾", "Korea, Rep. of": "韩国",
}


# =====================================================================
# 建表
# =====================================================================
def ensure_tables():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS gold_reserve_changes (
                    id BIGSERIAL PRIMARY KEY,
                    country_name VARCHAR(120) NOT NULL,
                    country_name_cn VARCHAR(120),
                    period_date DATE NOT NULL,
                    change_tonnes NUMERIC(18,4) NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    CONSTRAINT uk_gold_change_country_period UNIQUE (country_name, period_date)
                )
            """)
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
# 本地 xlsx 解析
# =====================================================================
def _require_pandas():
    try:
        import pandas as pd
        return pd
    except Exception:
        log.error("缺少 pandas，请安装: pip install pandas openpyxl")
        return None


def _pick_col(cols, keywords):
    lowered = {str(c).strip().lower(): c for c in cols}
    for kw in keywords:
        for low, orig in lowered.items():
            if kw in low:
                return orig
    return None


def _parse_yyyymm(val):
    if val is None:
        return None
    if isinstance(val, (datetime.datetime, datetime.date)):
        return val.strftime("%Y-%m-01")
    s = str(val).strip()
    if not s or s.lower() in ("nan", "none", "nat"):
        return None
    m = re.search(r"(\d{4})[-/年.](\d{1,2})", s)
    if m:
        return "%04d-%02d-01" % (int(m.group(1)), int(m.group(2)))
    m = re.search(r"([A-Za-z]{3,})[\s,]+(\d{4})", s)
    if m:
        months = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
                  "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
        mm = months.get(m.group(1).lower()[:3])
        if mm:
            return "%04d-%02d-01" % (int(m.group(2)), mm)
    if s.isdigit() and len(s) == 4:
        return s + "-01-01"
    return None


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


def parse_changes_xlsx(path):
    """央行购金月度变动：国家 + 各月变动列 -> [(country, cn, period, tonnes)]"""
    if not os.path.isfile(path):
        log.warning("央行购金文件不存在，跳过: %s", path)
        return []
    pd = _require_pandas()
    if pd is None:
        return []
    df = pd.read_excel(path, sheet_name=0, header=0, engine="openpyxl")
    if df is None or df.empty:
        log.warning("央行购金 xlsx 为空")
        return []

    cols = list(df.columns)
    country_col = _pick_col(cols, ["country", "国家", "name", "名称"]) or cols[0]
    month_cols = []
    for c in cols:
        if c == country_col:
            continue
        period = _parse_yyyymm(c)
        if period:
            month_cols.append((c, period))
    if not month_cols:
        log.warning("未识别到月份列，跳过央行购金")
        return []

    rows = []
    for _, r in df.iterrows():
        raw = r.get(country_col) if hasattr(r, "get") else r[country_col]
        country = str(raw).strip() if raw is not None else ""
        if not country or country.lower() in ("nan", "none", "", "country", "国家", "world", "total", "合计"):
            continue
        cn = CN_NAME.get(country, "")
        for col, period in month_cols:
            v = safe_dec(r.get(col) if hasattr(r, "get") else r[col], 4)
            if v is None or float(v) == 0:
                continue
            rows.append((country, cn, period, float(v)))
    log.info("央行购金变动 -> %d 条", len(rows))
    return rows


def parse_price_xlsx(path):
    """本地金价历史：日期 + 价格 -> [(date, price)]"""
    if not os.path.isfile(path):
        log.warning("金价文件不存在，跳过: %s", path)
        return []
    pd = _require_pandas()
    if pd is None:
        return []
    df = pd.read_excel(path, sheet_name=0, header=0, engine="openpyxl")
    if df is None or df.empty:
        log.warning("金价 xlsx 为空")
        return []

    cols = list(df.columns)
    date_col = _pick_col(cols, ["date", "日期", "time", "year", "period"]) or cols[0]
    price_col = _pick_col(cols, ["price", "close", "usd", "金价", "美元", "value", "spot"])
    if price_col is None and len(cols) >= 2:
        price_col = cols[1]
    if price_col is None:
        log.warning("无法识别金价列")
        return []

    rows = []
    for _, r in df.iterrows():
        d = _parse_date(r.get(date_col) if hasattr(r, "get") else r[date_col])
        if not d:
            continue
        price = safe_dec(r.get(price_col) if hasattr(r, "get") else r[price_col], 4)
        if price is None or float(price) <= 0:
            continue
        rows.append((d, float(price)))
    log.info("本地金价历史 -> %d 条", len(rows))
    return rows


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
                # psycopg2 不支持 lastrowid，插入后重新查询
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
    def _download():
        return yf.download(DXY_SYMBOL, start=DXY_START, progress=False,
                           auto_adjust=False, prepost=False)

    df = with_retry(_download, timeout=60, max_retry=4)
    if df is None or getattr(df, "empty", True):
        log.warning("Yahoo 未返回 %s 数据", DXY_SYMBOL)
        return []

    if isinstance(df.columns, __import__("pandas").MultiIndex):
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
        log.warning("%s 未找到 Close 列: %s", DXY_SYMBOL, list(df.columns))
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
    log.info("DXY 历史 -> %d 条", len(rows))
    return rows


# =====================================================================
# 写入
# =====================================================================
def upsert_changes(rows):
    if not rows:
        return 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            return bulk_upsert(
                conn, cur, "gold_reserve_changes",
                ["country_name", "country_name_cn", "period_date", "change_tonnes"],
                rows, ["country_name", "period_date"], ["change_tonnes", "country_name_cn"])


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
        ("央行购金", lambda: upsert_changes(parse_changes_xlsx(LOCAL_CHANGES_XLSX))),
        ("金价历史(本地)", lambda: upsert_prices(parse_price_xlsx(LOCAL_PRICE_XLSX), "LOCAL-XLSX")),
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

#!/usr/bin/env python3
"""Sync Global Liquidity indicators from FRED.
Series:
  - FED_BALANCE_SHEET  -> WALCL        (weekly, Fed total assets, millions)
  - FED_RRP            -> RRPONTSYD    (daily, overnight reverse repo, billions)
  - FED_TGA            -> WTREGEN      (weekly, Treasury General Account, millions)
  - SOFR               -> SOFR         (daily, secured overnight financing rate, %)
  - ECB_BALANCE_SHEET  -> ECBASSETSW   (weekly, ECB total assets, millions EUR)
  - BOJ_BALANCE_SHEET  -> JPNASSETS    (monthly, BOJ total assets, 100M JPY)
Table: indicators, indicator_data, data_sync_logs
Usage:
    python3 fetch_global_liquidity.py           # full backfill
    python3 fetch_global_liquidity.py --daily   # incremental (last 7 days)
"""
import os
import sys
import time
from datetime import date, timedelta

import requests

from sync_base import _setup_logger, get_conn, write_sync_log, with_retry, safe_dec


FRED_API_KEY = os.environ.get("FRED_API_KEY", "DEMO_KEY")
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"

SLEEP_BETWEEN = 0.5

LIQUIDITY_INDICATORS = [
    ("FED_BALANCE_SHEET", "美联储总资产", "Fed Total Assets", "WALCL", "全球流动性", "央行资产负债表", "百万美元", "weekly"),
    ("FED_RRP", "美联储隔夜逆回购", "Fed O/N Reverse Repo", "RRPONTSYD", "全球流动性", "美联储流动性工具", "十亿美元", "daily"),
    ("FED_TGA", "TGA账户余额", "Treasury General Account", "WTREGEN", "全球流动性", "美联储流动性工具", "百万美元", "weekly"),
    ("SOFR", "担保隔夜融资利率", "SOFR", "SOFR", "全球流动性", "货币市场利率", "%", "daily"),
    ("ECB_BALANCE_SHEET", "欧央行总资产", "ECB Total Assets", "ECBASSETSW", "全球流动性", "央行资产负债表", "百万欧元", "weekly"),
    ("BOJ_BALANCE_SHEET", "日本央行总资产", "BOJ Total Assets", "JPNASSETS", "全球流动性", "央行资产负债表", "百亿日元", "monthly"),
]

log = _setup_logger("fetch_global_liquidity")


def _fetch_fred(indicator_code, fred_id, start_date):
    params = {
        "series_id": fred_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "observation_start": start_date.strftime("%Y-%m-%d"),
        "sort_order": "desc",
        "limit": 2000,
    }
    try:
        r = with_retry(requests.get, FRED_URL, params=params, timeout=30)
    except Exception as e:
        log.warning("%s (%s) fetch failed: %s", indicator_code, fred_id, e)
        return {}
    try:
        data = r.json()
    except Exception:
        return {}

    obs = data.get("observations", [])
    result = {}
    for o in obs:
        if o.get("value") in (".", None, ""):
            continue
        val = safe_dec(o["value"])
        if val is not None:
            result[o["date"]] = float(val)
    log.info("%s (%s): %d rows", indicator_code, fred_id, len(result))
    return result


def ensure_indicators():
    with get_conn() as conn:
        with conn.cursor() as cur:
            for code, zh, en, fid, cat, sub, unit, freq in LIQUIDITY_INDICATORS:
                cur.execute(
                    "INSERT INTO indicators (code, region, name_zh, name_en, category, sub_category, unit, frequency, source, description, is_active) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                    "ON DUPLICATE KEY UPDATE name_zh=VALUES(name_zh), is_active=VALUES(is_active)",
                    (code, "GL", zh, en, cat, sub, unit, freq, "FRED", "%s (%s)" % (zh, en), 1))
        conn.commit()


def get_indicator_ids():
    with get_conn() as conn:
        with conn.cursor() as cur:
            codes = [r[0] for r in LIQUIDITY_INDICATORS]
            ph = ", ".join(["%s"] * len(codes))
            cur.execute("SELECT id, code FROM indicators WHERE code IN (%s)" % ph, codes)
            return {r["code"]: r["id"] for r in cur.fetchall()}


def upsert_data(indicator_id, rows):
    if not rows:
        return 0
    sql = "INSERT INTO indicator_data (indicator_id, period_date, value) VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE value=VALUES(value)"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, [(indicator_id, d, v) for d, v in rows])
            total = cur.rowcount if cur.rowcount else len(rows)
        conn.commit()
    return total


def main():
    log.info("=" * 60)

    daily = "--daily" in sys.argv
    today = date.today()
    lookback = timedelta(days=7 if daily else 365 * 5)

    ensure_indicators()
    ids = get_indicator_ids()
    if len(ids) != len(LIQUIDITY_INDICATORS):
        log.error("indicator creation failed, missing: %s", set([r[0] for r in LIQUIDITY_INDICATORS]) - set(ids.keys()))
        write_sync_log("global_liquidity", "failed", 0, "indicator creation failed")
        return

    total_written = 0
    errors = []
    start = today - lookback

    for code, zh, en, fid, cat, sub, unit, freq in LIQUIDITY_INDICATORS:
        try:
            time.sleep(SLEEP_BETWEEN)
            data = _fetch_fred(code, fid, start)
            if data:
                sorted_rows = [(d, v) for d, v in sorted(data.items()) if d >= start.strftime("%Y-%m-%d")]
                if sorted_rows:
                    n = upsert_data(ids[code], sorted_rows)
                    total_written += n
                    log.info("%s wrote %d rows (latest: %s)", code, n, sorted_rows[-1][0])
                else:
                    log.warning("%s no data in range", code)
            else:
                log.warning("%s empty response", code)
        except Exception as e:
            log.error("%s failed: %s", code, e)
            errors.append("%s: %s" % (code, e))

    status = "success" if not errors and total_written > 0 else ("partial" if total_written > 0 else "failed")
    msg = "total %d rows; errors %d" % (total_written, len(errors))
    log.info(msg)
    write_sync_log("global_liquidity", status, total_written, msg)


if __name__ == "__main__":
    main()
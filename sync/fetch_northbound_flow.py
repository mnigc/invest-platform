#!/usr/bin/env python3
"""Sync Cross-Border Capital Flow & USDCNY data.
Data sources:
  - Northbound/Southbound flow: akshare stock_hsgt_hist_em (eastmoney)
  - USDCNY: FRED DEXCHUS (onshore, proxy for USDCNH)
Tables: indicators, indicator_data, data_sync_logs
Usage:
    python3 fetch_northbound_flow.py           # full backfill
    python3 fetch_northbound_flow.py --daily   # incremental (last 7 days)
"""
import sys
import time
from datetime import date, timedelta

import requests

from sync_base import _setup_logger, get_conn, write_sync_log, with_retry, patch_cn_proxy, safe_dec


patch_cn_proxy()


MAX_RETRY = 4
HTTP_TIMEOUT = 60
SLEEP_BETWEEN = 0.8

FLOW_INDICATORS = {
    "NORTHBOUND_FLOW": ("北向资金净流入", "Northbound Net Flow", "资金流向", "沪深港通", "百万元", "daily", "akshare(em)"),
    "SOUTHBOUND_FLOW": ("南向资金净流入", "Southbound Net Flow", "资金流向", "沪深港通", "百万元", "daily", "akshare(em)"),
    "USDCNY":          ("美元兑人民币", "USD/CNY", "汇率", "人民币汇率", "汇率", "daily", "FRED"),
}

log = _setup_logger("fetch_northbound_flow")


def _fetch_hsgt_hist(symbol):
    import akshare as ak
    df = ak.stock_hsgt_hist_em(symbol=symbol)
    if df is None or df.empty:
        return {}

    result = {}
    for _, row in df.iterrows():
        try:
            raw_date = row.get("日期")
            if raw_date is None:
                continue
            date_str = str(raw_date)[:10]
            if len(date_str) != 10 or date_str[4] != "-":
                continue

            val = safe_dec(row.get("当日成交净买额"), 2)
            if val is not None:
                result[date_str] = float(val)
        except Exception:
            continue

    log.info("fetched %d rows from %s", len(result), symbol)
    return result


def _fetch_usdcny_fred():
    today_str = date.today().strftime("%Y-%m-%d")
    start_str = (date.today() - timedelta(days=365 * 5)).strftime("%Y-%m-%d")

    url = "https://fred.stlouisfed.org/graph/fredgraph.csv"
    params = {"id": "DEXCHUS", "cosd": start_str, "coed": today_str}
    r = with_retry(requests.get, url, params=params, timeout=HTTP_TIMEOUT, max_retry=MAX_RETRY)
    r.raise_for_status()

    result = {}
    for line in r.text.strip().split("\n")[1:]:
        parts = line.split(",")
        if len(parts) != 2 or parts[1] == ".":
            continue
        date_str = parts[0]
        val = safe_dec(parts[1], 6)
        if val is not None:
            result[date_str] = float(val)

    log.info("fetched %d rows from FRED DEXCHUS", len(result))
    return result


def ensure_indicators():
    with get_conn() as conn:
        with conn.cursor() as cur:
            for code, (zh, en, cat, sub, unit, freq, src) in FLOW_INDICATORS.items():
                cur.execute(
                    "INSERT INTO indicators (code, region, name_zh, name_en, category, sub_category, unit, frequency, source, description, is_active) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                    "ON DUPLICATE KEY UPDATE name_zh=VALUES(name_zh), is_active=VALUES(is_active)",
                    (code, "CN", zh, en, cat, sub, unit, freq, src, "%s(%s)" % (zh, en), 1),
                )
        conn.commit()


def get_indicator_ids():
    with get_conn() as conn:
        with conn.cursor() as cur:
            codes = list(FLOW_INDICATORS.keys())
            ph = ", ".join(["%s"] * len(codes))
            cur.execute("SELECT id, code FROM indicators WHERE code IN (%s)" % ph, codes)
            return {r["code"]: r["id"] for r in cur.fetchall()}


def upsert_indicator_data(indicator_id, rows):
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
    if len(ids) != len(FLOW_INDICATORS):
        log.error("indicator creation failed, missing: %s", set(FLOW_INDICATORS.keys()) - set(ids.keys()))
        write_sync_log("northbound_flow", "failed", 0, "indicator creation failed")
        return

    total_written = 0
    errors = []
    start_date = (today - lookback).strftime("%Y-%m-%d")

    try:
        north_data = with_retry(_fetch_hsgt_hist, "北向资金", timeout=HTTP_TIMEOUT, max_retry=MAX_RETRY)
        if north_data:
            rows = [(d, v) for d, v in sorted(north_data.items()) if d >= start_date]
            n = upsert_indicator_data(ids["NORTHBOUND_FLOW"], rows)
            total_written += n
            log.info("NORTHBOUND_FLOW wrote %d rows (latest: %s)", n, rows[-1][0] if rows else "none")
        else:
            log.warning("NORTHBOUND_FLOW no data")
    except Exception as e:
        log.error("northbound fetch failed: %s", e)
        errors.append("northbound: %s" % e)

    time.sleep(SLEEP_BETWEEN)

    try:
        south_data = with_retry(_fetch_hsgt_hist, "南向资金", timeout=HTTP_TIMEOUT, max_retry=MAX_RETRY)
        if south_data:
            rows = [(d, v) for d, v in sorted(south_data.items()) if d >= start_date]
            n = upsert_indicator_data(ids["SOUTHBOUND_FLOW"], rows)
            total_written += n
            log.info("SOUTHBOUND_FLOW wrote %d rows (latest: %s)", n, rows[-1][0] if rows else "none")
        else:
            log.warning("SOUTHBOUND_FLOW no data")
    except Exception as e:
        log.error("southbound fetch failed: %s", e)
        errors.append("southbound: %s" % e)

    time.sleep(SLEEP_BETWEEN)

    try:
        fx_data = with_retry(_fetch_usdcny_fred)
        if fx_data:
            rows = [(d, v) for d, v in sorted(fx_data.items()) if d >= start_date]
            n = upsert_indicator_data(ids["USDCNY"], rows)
            total_written += n
            log.info("USDCNY wrote %d rows (latest: %s)", n, rows[-1][0] if rows else "none")
        else:
            log.warning("USDCNY no data")
    except Exception as e:
        log.error("USDCNY fetch failed: %s", e)
        errors.append("USDCNY: %s" % e)

    status = "success" if not errors and total_written > 0 else ("partial" if total_written > 0 else "failed")
    msg = "total %d rows; errors %d" % (total_written, len(errors))
    log.info(msg)
    write_sync_log("northbound_flow", status, total_written, msg)


if __name__ == "__main__":
    main()

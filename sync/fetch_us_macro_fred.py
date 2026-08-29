#!/usr/bin/env python3
"""同步美国宏观经济指标（GDP / CPI / PPI / 失业率 / 联邦基金利率 / 美债收益率 等）。
数据源: FRED 官方 REST API（海外/国内均稳定）
写入表: indicator_data, data_sync_logs
用法:
    python3 fetch_us_macro_fred.py
"""
import os
import time
from datetime import datetime, timedelta

import requests

from sync_base import _setup_logger, get_conn, write_sync_log, with_retry, safe_dec


FRED_API_KEY = os.environ.get("FRED_API_KEY", "DEMO_KEY")
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"

SLEEP_BETWEEN = 0.5

FRED_MAP = {
    "GDP": "GDP",
    "CPI": "CPIAUCSL",
    "PPI": "PPIACO",
    "UNRATE": "UNRATE",
    "FEDFUNDS": "FEDFUNDS",
    "DGS1": "DGS1",
    "DGS2": "DGS2",
    "DGS3": "DGS3",
    "DGS5": "DGS5",
    "DGS7": "DGS7",
    "DGS10": "DGS10",
    "DGS20": "DGS20",
    "DGS30": "DGS30",
    "DGS1MO": "DGS1MO",
    "DGS3MO": "DGS3MO",
    "DGS6MO": "DGS6MO",
    "DEXUSEU": "DEXUSEU",
    "PCE": "PCE",
    "UMCSENT": "UMCSENT",
    "RSXFS": "RSXFS",
    "VIXCLS": "VIXCLS",
}

log = _setup_logger("fetch_us_macro_fred")


def _http_get_fred(params):
    r = requests.get(FRED_URL, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def fetch_series(indicator_id, code, series_id, last_date=None):
    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY or "DEMO_KEY",
        "file_type": "json",
        "sort_order": "asc",
    }
    if last_date:
        try:
            start = (datetime.strptime(str(last_date)[:10], "%Y-%m-%d") - timedelta(days=180)).strftime("%Y-%m-%d")
            params["observation_start"] = start
        except Exception:
            pass

    data = with_retry(_http_get_fred, params)
    observations = data.get("observations", []) if data else []
    if not observations:
        return 0

    rows = []
    for obs in observations:
        val_str = str(obs.get("value", "")).strip()
        if val_str in ("", ".", "None", "nan"):
            continue
        period = obs.get("date")
        if not period:
            continue
        val = safe_dec(val_str, 6)
        if val is None:
            continue
        rows.append((indicator_id, period, val))

    if not rows:
        return 0

    sql = (
        "INSERT INTO indicator_data (indicator_id, period_date, value, updated_at) "
        "VALUES (%s, %s, %s, NOW()) "
        "ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()"
    )
    inserted = 0
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.executemany(sql, rows)
                inserted = cur.rowcount if cur.rowcount else len(rows)
            conn.commit()
    except Exception as e:
        log.warning("批量写入失败（退化为逐行写入）: %s", e)
        for r in rows:
            try:
                with get_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(sql, r)
                    conn.commit()
                    inserted += 1
            except Exception as e2:
                log.warning("  逐行写入 %s (%s) %s 失败: %s", code, series_id, r[1], e2)
    return inserted


def main():
    log.info("=" * 60)
    log.info("开始同步美国宏观指标 (FRED)")

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                codes = list(FRED_MAP.keys())
                placeholders = ",".join(["%s"] * len(codes))
                cur.execute(
                    "SELECT id, code, name_zh FROM indicators "
                    "WHERE is_active = 1 AND code IN (%s) ORDER BY code" % placeholders,
                    codes,
                )
                indicators = cur.fetchall()
    except Exception as e:
        log.error("读取 indicators 表失败: %s", e)
        write_sync_log("indicator_data", "failed", 0, "read indicators: " + str(e))
        return

    log.info("待同步指标: %d 个", len(indicators))

    errors = []
    total = 0

    for ind in indicators:
        code = ind["code"]
        name = ind.get("name_zh") or code
        series_id = FRED_MAP.get(code)
        if not series_id:
            continue

        last_date = None
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT MAX(period_date) AS d FROM indicator_data WHERE indicator_id = %s",
                        (ind["id"],),
                    )
                    r = cur.fetchone() or {}
                    last_date = r.get("d")
        except Exception as e:
            log.warning("查 last_date 失败: %s", e)

        try:
            inserted = fetch_series(ind["id"], code, series_id, last_date)
            total += inserted
            log.info("%s (%s = %s) 写入 %d 行", code, name, series_id, inserted)
        except Exception as e:
            log.warning("%s (%s) 抓取/写入失败: %s", code, name, e)
            errors.append("%s: %s" % (code, e))

        time.sleep(SLEEP_BETWEEN)

    if errors and total > 0:
        status = "partial"
    elif total > 0:
        status = "success"
    else:
        status = "failed"
    msg = "共写入 %d 行；失败 %d 个；前 5 条: %s" % (total, len(errors), "; ".join(errors[:5]))
    log.info(msg)
    write_sync_log("indicator_data(FRED)", status, total, msg)


if __name__ == "__main__":
    main()
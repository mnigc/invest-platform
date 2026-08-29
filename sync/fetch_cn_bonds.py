#!/usr/bin/env python3
"""Sync China Treasury Bond Yields via akshare bond_zh_us_rate.
Data source: akshare -> bond_zh_us_rate (China/US treasury yields comparison)
Tables: indicators, indicator_data, data_sync_logs
Usage:
    python3 fetch_cn_bonds.py           # default: backfill ~90 days
    python3 fetch_cn_bonds.py --daily   # incremental: last 7 days only

NOTE: bond_zh_us_rate provides these CN tenors: 2Y, 5Y, 10Y, 30Y.
      It does NOT provide 1Y, 3M, 6M, 7Y, 20Y from this source.
"""
import sys
import time
from datetime import date, timedelta
from decimal import Decimal

from sync_base import _setup_logger, get_conn, write_sync_log, with_retry, patch_cn_proxy, safe_dec


patch_cn_proxy()


MAX_RETRY = 4
HTTP_TIMEOUT = 60
SLEEP_BETWEEN = 0.8

CN_BOND_INDICATORS = {
    "CN_TREASURY_2Y":  ("中国2年期国债收益率", "2Y", "中国国债收益率2年"),
    "CN_TREASURY_5Y":  ("中国5年期国债收益率", "5Y", "中国国债收益率5年"),
    "CN_TREASURY_10Y": ("中国10年期国债收益率", "10Y", "中国国债收益率10年"),
    "CN_TREASURY_30Y": ("中国30年期国债收益率", "30Y", "中国国债收益率30年"),
}

log = _setup_logger("fetch_cn_bonds")


def _fetch_bond_yield():
    import akshare as ak
    df = with_retry(ak.bond_zh_us_rate, timeout=HTTP_TIMEOUT, max_retry=MAX_RETRY)

    if df is None or df.empty:
        log.warning("bond_zh_us_rate returned empty dataframe")
        return {}

    col_to_code = {v[2]: k for k, v in CN_BOND_INDICATORS.items()}

    result = {}
    for _, row in df.iterrows():
        try:
            raw_date = row.get("日期")
            if raw_date is None:
                continue
            date_str = str(raw_date)[:10]
            if len(date_str) == 8 and date_str.isdigit():
                date_str = "%s-%s-%s" % (date_str[:4], date_str[4:6], date_str[6:8])
            elif len(date_str) != 10 or date_str[4] != "-":
                continue

            day_data = {}
        except Exception:
            continue

        for col_name, code in col_to_code.items():
            if col_name not in row.index:
                continue
            v = safe_dec(row[col_name], 6)
            if v is not None:
                day_data[code] = v

        if day_data:
            result[date_str] = day_data

    log.info("fetched %d trading days of CN bond data", len(result))
    return result


def ensure_indicators():
    with get_conn() as conn:
        with conn.cursor() as cur:
            for code, (name_zh, mat, _) in CN_BOND_INDICATORS.items():
                cur.execute(
                    "INSERT INTO indicators (code, region, name_zh, name_en, category, sub_category, unit, frequency, source, description, is_active) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                    "ON DUPLICATE KEY UPDATE name_zh=VALUES(name_zh), description=VALUES(description), is_active=VALUES(is_active)",
                    (code, "CN", name_zh, "China Treasury %s Yield" % mat,
                     "利率", "国债收益率", "%", "daily", "akshare(bond_zh_us_rate)",
                     "中国%s国债到期收益率" % mat, 1),
                )
        conn.commit()


def get_indicator_ids():
    with get_conn() as conn:
        with conn.cursor() as cur:
            codes = list(CN_BOND_INDICATORS.keys())
            placeholders = ", ".join(["%s"] * len(codes))
            cur.execute("SELECT id, code FROM indicators WHERE code IN (%s)" % placeholders, codes)
            return {r["code"]: r["id"] for r in cur.fetchall()}


def upsert_indicator_data(indicator_id, rows):
    if not rows:
        return 0
    sql = (
        "INSERT INTO indicator_data (indicator_id, period_date, value) VALUES (%s, %s, %s) "
        "ON DUPLICATE KEY UPDATE value=VALUES(value)"
    )
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
    start = today - timedelta(days=7 if daily else 365 * 5)
    log.info("syncing CN treasury yields (%s ~ %s)", start, today)

    ensure_indicators()
    ids = get_indicator_ids()
    if len(ids) != len(CN_BOND_INDICATORS):
        log.error("indicator creation failed, missing: %s",
                 set(CN_BOND_INDICATORS.keys()) - set(ids.keys()))
        write_sync_log("cn_bonds", "failed", 0, "indicator creation failed")
        return

    try:
        data = _fetch_bond_yield()
    except Exception as e:
        log.error("fetch failed: %s", e)
        write_sync_log("cn_bonds", "failed", 0, str(e))
        return

    total = 0
    errors = []
    for code, (name_zh, mat, _) in CN_BOND_INDICATORS.items():
        indicator_id = ids[code]
        rows = []
        for date_str, day_data in data.items():
            if start.strftime("%Y-%m-%d") <= date_str <= today.strftime("%Y-%m-%d") and code in day_data:
                rows.append((date_str, day_data[code]))
        rows.sort(key=lambda x: x[0])
        if rows:
            try:
                n = upsert_indicator_data(indicator_id, rows)
                total += n
                log.info("%s (%s) wrote %d rows", code, name_zh, n)
            except Exception as e:
                log.warning("%s write failed: %s", code, e)
                errors.append("%s: %s" % (code, e))
        else:
            log.warning("%s no data", code)
            errors.append("%s: no data" % code)
        time.sleep(SLEEP_BETWEEN)

    status = "success" if not errors and total > 0 else ("partial" if total > 0 else "failed")
    msg = "total %d rows; failed %d" % (total, len(errors))
    log.info(msg)
    write_sync_log("cn_bonds", status, total, msg)


if __name__ == "__main__":
    main()

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
import os, sys, time, logging, threading
from datetime import date, timedelta, datetime
from decimal import Decimal, ROUND_HALF_UP

import pymysql
import requests

DB_HOST = "204.44.121.43"
DB_PORT = 3306
DB_USER = "mnigc"
DB_PASSWORD = "woaiyinyue.4"
DB_NAME = "invest_platform"

MAX_RETRY = 4
HTTP_TIMEOUT = 60
SLEEP_BETWEEN = 0.8


def _setup_logger(name):
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    logger.addHandler(ch)
    try:
        logs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
        os.makedirs(logs_dir, exist_ok=True)
        fh = logging.FileHandler(
            os.path.join(logs_dir, "%s_%s.log" % (name, datetime.now().strftime("%Y%m%d"))), encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    except Exception:
        pass
    return logger


log = _setup_logger("fetch_northbound_flow")

# ── Indicator definitions ──
FLOW_INDICATORS = {
    "NORTHBOUND_FLOW": ("北向资金净流入", "Northbound Net Flow", "资金流向", "沪深港通", "百万元", "daily", "akshare(em)"),
    "SOUTHBOUND_FLOW": ("南向资金净流入", "Southbound Net Flow", "资金流向", "沪深港通", "百万元", "daily", "akshare(em)"),
    "USDCNY":          ("美元兑人民币", "USD/CNY", "汇率", "人民币汇率", "汇率", "daily", "FRED"),
}


def get_conn():
    return pymysql.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10)


def safe_dec(v, digits=6):
    if v is None:
        return None
    try:
        fv = float(v)
        if not (fv == fv):  # NaN
            return None
        if abs(fv) > 1e15:
            return None
        return Decimal(str(fv)).quantize(Decimal("1").scaleb(-digits), rounding=ROUND_HALF_UP)
    except Exception:
        return None


def write_sync_log(sync_type, status, records_count, error_message=""):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cur.execute(
                    "INSERT INTO data_sync_logs (sync_type, target_code, status, records_count, error_message, started_at, finished_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (sync_type, "", status, records_count, error_message, now, now),
                )
            conn.commit()
    except Exception as e:
        log.warning("write_sync_log failed: %s", e)


def with_retry(fn, *args, **kwargs):
    last_err = None
    for attempt in range(1, MAX_RETRY + 1):
        holder, err_holder = [], []

        def _run():
            try:
                holder.append(fn(*args, **kwargs))
            except Exception as e:
                err_holder.append(e)

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        t.join(HTTP_TIMEOUT)
        if t.is_alive():
            last_err = Exception("request timeout after %ds" % HTTP_TIMEOUT)
        elif err_holder:
            last_err = err_holder[0]
        else:
            return holder[0] if holder else None
        wait = min(2 ** (attempt - 1), 15)
        log.warning("attempt %d/%d failed: %s, retry in %ds", attempt, MAX_RETRY, last_err, wait)
        time.sleep(wait)
    raise last_err if last_err else RuntimeError("unknown error")


# ── Fetch functions ──
def _fetch_hsgt_hist(symbol):
    """Fetch northbound or southbound history via akshare.
    Returns: {date_str: net_buy_amount_million}
    """
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
    """Fetch USDCNY (onshore) from FRED DEXCHUS.
    Returns: {date_str: rate}
    """
    today_str = date.today().strftime("%Y-%m-%d")
    start_str = (date.today() - timedelta(days=365 * 5)).strftime("%Y-%m-%d")

    url = "https://fred.stlouisfed.org/graph/fredgraph.csv"
    params = {"id": "DEXCHUS", "cosd": start_str, "coed": today_str}
    r = with_retry(requests.get, url, params=params)
    r.raise_for_status()

    result = {}
    for line in r.text.strip().split("\n")[1:]:  # skip header
        parts = line.split(",")
        if len(parts) != 2 or parts[1] == ".":
            continue
        date_str = parts[0]
        val = safe_dec(parts[1], 6)
        if val is not None:
            result[date_str] = float(val)

    log.info("fetched %d rows from FRED DEXCHUS", len(result))
    return result


# ── DB helpers ──
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


# ── Main ──
def main():
    log.info("=" * 60)

    # Clear proxy env
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        os.environ.pop(k, None)

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

    # ── 1. Northbound flow ──
    try:
        north_data = with_retry(_fetch_hsgt_hist, "北向资金")
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

    # ── 2. Southbound flow ──
    try:
        south_data = with_retry(_fetch_hsgt_hist, "南向资金")
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

    # ── 3. USDCNY from FRED ──
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

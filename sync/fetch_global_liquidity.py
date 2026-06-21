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

FRED_API_KEY = "671a9677b4cd70b6e85452f33a2c54ab"
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"

MAX_RETRY = 4
HTTP_TIMEOUT = 30
SLEEP_BETWEEN = 0.5


def _setup_logger(name):
    logger = logging.getLogger(name)
    if logger.handlers: return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    logger.addHandler(ch)
    try:
        logs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
        os.makedirs(logs_dir, exist_ok=True)
        fh = logging.FileHandler(os.path.join(logs_dir, "%s_%s.log" % (name, datetime.now().strftime("%Y%m%d"))), encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    except: pass
    return logger

log = _setup_logger("fetch_global_liquidity")

# ── Indicator definitions: (code, name_zh, name_en, fred_id, category, sub, unit, freq) ──
LIQUIDITY_INDICATORS = [
    ("FED_BALANCE_SHEET", "美联储总资产", "Fed Total Assets", "WALCL", "全球流动性", "央行资产负债表", "百万美元", "weekly"),
    ("FED_RRP", "美联储隔夜逆回购", "Fed O/N Reverse Repo", "RRPONTSYD", "全球流动性", "美联储流动性工具", "十亿美元", "daily"),
    ("FED_TGA", "TGA账户余额", "Treasury General Account", "WTREGEN", "全球流动性", "美联储流动性工具", "百万美元", "weekly"),
    ("SOFR", "担保隔夜融资利率", "SOFR", "SOFR", "全球流动性", "货币市场利率", "%", "daily"),
    ("ECB_BALANCE_SHEET", "欧央行总资产", "ECB Total Assets", "ECBASSETSW", "全球流动性", "央行资产负债表", "百万欧元", "weekly"),
    ("BOJ_BALANCE_SHEET", "日本央行总资产", "BOJ Total Assets", "JPNASSETS", "全球流动性", "央行资产负债表", "百亿日元", "monthly"),
]


def get_conn():
    return pymysql.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10)

def safe_dec(v, digits=6):
    if v is None: return None
    try:
        fv = float(v)
        if not (fv == fv): return None
        if abs(fv) > 1e15: return None
        return Decimal(str(fv)).quantize(Decimal("1").scaleb(-digits), rounding=ROUND_HALF_UP)
    except: return None

def write_sync_log(sync_type, status, records_count, error_message=""):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cur.execute(
                    "INSERT INTO data_sync_logs (sync_type, target_code, status, records_count, error_message, started_at, finished_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (sync_type, "", status, records_count, error_message, now, now))
            conn.commit()
    except Exception as e: log.warning("write_sync_log failed: %s", e)


def with_retry(fn, *args, **kwargs):
    last_err = None
    for attempt in range(1, MAX_RETRY + 1):
        holder, err_holder = [], []
        def _run():
            try: holder.append(fn(*args, **kwargs))
            except Exception as e: err_holder.append(e)
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


# ── FRED API ──
def _fetch_fred(indicator_code, fred_id, start_date):
    """Fetch FRED series and return {date_str: value}. Returns empty dict on failure."""
    params = {
        "series_id": fred_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "observation_start": start_date.strftime("%Y-%m-%d"),
        "sort_order": "desc",
        "limit": 2000,
    }
    try:
        r = with_retry(requests.get, FRED_URL, params=params, timeout=HTTP_TIMEOUT)
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
        if o.get("value") in (".", None, ""): continue
        val = safe_dec(o["value"])
        if val is not None:
            result[o["date"]] = float(val)
    log.info("%s (%s): %d rows", indicator_code, fred_id, len(result))
    return result


# ── DB helpers ──
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
    if not rows: return 0
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
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        os.environ.pop(k, None)

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

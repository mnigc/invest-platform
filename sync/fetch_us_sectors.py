#!/usr/bin/env python3
"""Sync US S&P 500 sector ETF daily prices via yfinance.
Tickers: XLF, XLK, XLV, XLI, XLP, XLE, XLU, XLB, XLY, XLC, XLRE
Writes to indicator_data table.
"""
import os, sys, time, logging, threading
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

import pymysql
import yfinance as yf

DB_HOST = "204.44.121.43"
DB_PORT = 3306
DB_USER = "mnigc"
DB_PASSWORD = "woaiyinyue.4"
DB_NAME = "invest_platform"

YF_TICKERS = {
    "US_SECTOR_XLF": "XLF",
    "US_SECTOR_XLK": "XLK",
    "US_SECTOR_XLV": "XLV",
    "US_SECTOR_XLI": "XLI",
    "US_SECTOR_XLP": "XLP",
    "US_SECTOR_XLE": "XLE",
    "US_SECTOR_XLU": "XLU",
    "US_SECTOR_XLB": "XLB",
    "US_SECTOR_XLY": "XLY",
    "US_SECTOR_XLC": "XLC",
    "US_SECTOR_XLRE": "XLRE",
}

MAX_RETRY = 3
TIMEOUT = 60
SLEEP_BETWEEN = 1.0

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
        log_file = os.path.join(logs_dir, f"{name}_{datetime.now().strftime('%Y%m%d')}.log")
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    except: pass
    return logger

log = _setup_logger("fetch_us_sectors")

def get_conn():
    return pymysql.connect(host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor, connect_timeout=10)

def with_retry(fn, *args, **kwargs):
    last_err = None
    for attempt in range(1, MAX_RETRY + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            last_err = e
            wait = min(2 ** (attempt - 1), 15)
            log.warning("第 %d/%d 次失败: %s，%ds 后重试", attempt, MAX_RETRY, last_err, wait)
            time.sleep(wait)
    raise last_err if last_err else RuntimeError("未知错误")

def fetch_ticker(ticker, start_date=None):
    """Fetch daily OHLCV for a ticker, return [(date, adjusted_close), ...]"""
    if start_date:
        df = yf.download(ticker, start=start_date, progress=False, auto_adjust=True)
    else:
        df = yf.download(ticker, period="max", progress=False, auto_adjust=True)

    if df is None or df.empty:
        return []

    out = []
    for idx in df.index:
        date_str = str(idx.date())
        # Use Adj Close if available, else Close
        close = None
        for col in ['Adj Close', 'Close']:
            if col in df.columns:
                v = df.loc[idx, col]
                if v is not None and not pd.isna(v):
                    close = float(v)
                    break
        if close is not None and close > 0:
            out.append((date_str, Decimal(str(close)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)))
    return out

import pandas as pd

def main():
    log.info("=" * 60)
    log.info("开始同步美国行业板块 ETF (yfinance)")

    # Get indicator IDs
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                codes = list(YF_TICKERS.keys())
                placeholders = ",".join(["%s"] * len(codes))
                cur.execute(
                    f"SELECT id, code FROM indicators WHERE code IN ({placeholders}) AND is_active = 1",
                    codes
                )
                rows = cur.fetchall()
    except Exception as e:
        log.error("读取 indicators 失败: %s", e)
        return

    id_map = {r["code"]: r["id"] for r in rows}
    log.info("找到 %d 个板块指标", len(id_map))

    total = 0
    errors = []

    for code, ticker in YF_TICKERS.items():
        if code not in id_map:
            log.warning("%s - 未找到 DB 记录，跳过", code)
            errors.append(f"{code}: no DB entry")
            continue

        ind_id = id_map[code]

        # Get last synced date
        last_date = None
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT MAX(period_date) AS d FROM indicator_data WHERE indicator_id = %s", (ind_id,))
                    r = cur.fetchone() or {}
                    last_date = r.get("d")
        except: pass

        try:
            if last_date:
                start = (last_date - timedelta(days=5)).strftime("%Y-%m-%d")
            else:
                start = "2010-01-01"
            points = with_retry(fetch_ticker, ticker, start)
            if not points:
                log.warning("%s (%s) - 无数据", code, ticker)
                continue

            sql = ("INSERT INTO indicator_data (indicator_id, period_date, value, updated_at) "
                   "VALUES (%s, %s, %s, NOW()) "
                   "ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()")
            rows_data = [(ind_id, p[0], p[1]) for p in points]
            inserted = 0
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.executemany(sql, rows_data)
                    inserted = cur.rowcount if cur.rowcount else len(rows_data)
                conn.commit()
            total += inserted
            log.info("%s (%s) - 写入 %d 行", code, ticker, inserted)
        except Exception as e:
            log.warning("%s (%s) - 失败: %s", code, ticker, e)
            errors.append(f"{code}: {e}")

        time.sleep(SLEEP_BETWEEN)

    status = "success" if not errors else ("partial" if total > 0 else "failed")
    msg = f"共写入 {total} 行；失败 {len(errors)} 个"
    log.info(msg)
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cur.execute(
                    "INSERT INTO data_sync_logs (sync_type, target_code, status, records_count, error_message, started_at, finished_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    ("indicator_data(SECTORS)", "", status, total, msg, now, now),
                )
            conn.commit()
    except: pass

if __name__ == "__main__":
    main()

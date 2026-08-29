#!/usr/bin/env python3
"""Sync US S&P 500 sector ETF daily prices via yfinance.
Tickers: XLF, XLK, XLV, XLI, XLP, XLE, XLU, XLB, XLY, XLC, XLRE
Writes to indicator_data table.
"""
import time
from datetime import timedelta
from decimal import Decimal

import pandas as pd
import yfinance as yf

from sync_base import _setup_logger, get_conn, write_sync_log, with_retry


YF_TICKERS = {
    "US_SECTOR_XLF": ("XLF", "金融"),
    "US_SECTOR_XLK": ("XLK", "科技"),
    "US_SECTOR_XLV": ("XLV", "医疗"),
    "US_SECTOR_XLI": ("XLI", "工业"),
    "US_SECTOR_XLP": ("XLP", "必需消费"),
    "US_SECTOR_XLE": ("XLE", "能源"),
    "US_SECTOR_XLU": ("XLU", "公用事业"),
    "US_SECTOR_XLB": ("XLB", "材料"),
    "US_SECTOR_XLY": ("XLY", "可选消费"),
    "US_SECTOR_XLC": ("XLC", "通讯服务"),
    "US_SECTOR_XLRE": ("XLRE", "房地产"),
}

MAX_RETRY = 3
TIMEOUT = 60
SLEEP_BETWEEN = 1.0

log = _setup_logger("fetch_us_sectors")


def fetch_ticker(ticker, start_date=None):
    if start_date:
        df = yf.download(ticker, start=start_date, progress=False, auto_adjust=True)
    else:
        df = yf.download(ticker, period="max", progress=False, auto_adjust=True)

    if df is None or df.empty:
        return []

    out = []
    for idx in df.index:
        date_str = str(idx.date())
        close = None
        for col in ['Adj Close', 'Close']:
            if col in df.columns:
                v = df.loc[idx, col]
                if v is not None and not pd.isna(v):
                    close = float(v)
                    break
        if close is not None and close > 0:
            out.append((date_str, Decimal(str(close)).quantize(Decimal("0.01"))))
    return out


def ensure_indicators():
    with get_conn() as conn:
        with conn.cursor() as cur:
            for code, (ticker, name_cn) in YF_TICKERS.items():
                cur.execute(
                    "INSERT INTO indicators (code, region, name_zh, name_en, category, sub_category, unit, frequency, source, description, is_active) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                    "ON DUPLICATE KEY UPDATE name_zh=VALUES(name_zh), description=VALUES(description)",
                    (code, "US", f"{name_cn}板块ETF", f"S&P 500 {name_cn} Sector ETF ({ticker})",
                     "资产", "美股板块", "USD", "daily", "yfinance", f"S&P 500 {name_cn}板块ETF价格 ({ticker})", 1),
                )
        conn.commit()


def main():
    log.info("=" * 60)
    log.info("开始同步美国行业板块 ETF (yfinance)")

    ensure_indicators()

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
        write_sync_log("indicator_data(SECTORS)", "failed", 0, "read indicators: " + str(e))
        return

    id_map = {r["code"]: r["id"] for r in rows}
    log.info("找到 %d 个板块指标", len(id_map))

    total = 0
    errors = []

    for code, (ticker, name_cn) in YF_TICKERS.items():
        if code not in id_map:
            log.warning("%s - 未找到 DB 记录，跳过", code)
            errors.append(f"{code}: no DB entry")
            continue

        ind_id = id_map[code]

        last_date = None
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT MAX(period_date) AS d FROM indicator_data WHERE indicator_id = %s", (ind_id,))
                    r = cur.fetchone() or {}
                    last_date = r.get("d")
        except:
            pass

        try:
            if last_date:
                start = (last_date - timedelta(days=5)).strftime("%Y-%m-%d")
            else:
                start = "2010-01-01"
            points = with_retry(fetch_ticker, ticker, start, timeout=TIMEOUT, max_retry=MAX_RETRY)
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
    write_sync_log("indicator_data(SECTORS)", status, total, msg)


if __name__ == "__main__":
    main()

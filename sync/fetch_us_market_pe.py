#!/usr/bin/env python3
"""同步标普 500 市盈率 (Trailing PE)。
数据源: Yahoo Finance (SPX = ^GSPC 的 info.trailingPE)
写入表: indicator_data (指标 code = SP500_PE), data_sync_logs
用法:
    python3 fetch_us_market_pe.py
"""
import os
import sys
import time
import logging
import threading
from datetime import datetime, date
from decimal import Decimal, ROUND_HALF_UP

import pymysql
import yfinance as yf


DB_HOST = "204.44.121.43"
DB_PORT = 3306
DB_USER = "mnigc"
DB_PASSWORD = "woaiyinyue.4"
DB_NAME = "invest_platform"

MAX_RETRY = 4
TIMEOUT = 30
SPX_SYMBOL = "^GSPC"


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
        log_file = os.path.join(logs_dir, "%s_%s.log" % (name, datetime.now().strftime("%Y%m%d")))
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    except Exception as e:
        print("日志文件初始化失败（忽略）:", e)
    return logger

log = _setup_logger("fetch_us_market_pe")


def get_conn():
    return pymysql.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
    )


def write_sync_log(sync_type, status, records_count, error_message=""):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cur.execute(
                    "INSERT INTO data_sync_logs (sync_type, target_code, status, records_count, error_message, started_at, finished_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (sync_type, "SP500_PE", status, records_count, error_message, now, now),
                )
            conn.commit()
    except Exception as e:
        log.warning("写入 data_sync_logs 失败: %s", e)


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
        t.join(TIMEOUT)
        if t.is_alive():
            last_err = Exception("HTTP 请求超过 %ds" % TIMEOUT)
        elif err_holder:
            last_err = err_holder[0]
        else:
            return holder[0] if holder else None
        wait = min(2 ** (attempt - 1), 15)
        log.warning("第 %d/%d 次失败: %s，%ds 后重试", attempt, MAX_RETRY, last_err, wait)
        time.sleep(wait)
    raise last_err if last_err else RuntimeError("未知错误")


def main():
    log.info("=" * 60)
    log.info("开始同步 S&P 500 Trailing PE")

    indicator_id = None
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM indicators WHERE code = %s AND is_active = 1 LIMIT 1",
                    ("SP500_PE",),
                )
                row = cur.fetchone() or {}
                indicator_id = row.get("id")
    except Exception as e:
        log.error("读取 indicators 表失败: %s", e)
        write_sync_log("indicator_data", "failed", 0, "read indicators: " + str(e))
        return

    if not indicator_id:
        log.warning("未找到 SP500_PE 指标，请先在 indicators 表插入该指标")
        write_sync_log("indicator_data", "failed", 0, "SP500_PE indicator missing")
        return
    log.info("indicator id=%s", indicator_id)

    def _fetch_pe():
        t = yf.Ticker(SPX_SYMBOL)
        info = t.info
        return info.get("trailingPE") if info else None

    try:
        trailing_pe = with_retry(_fetch_pe)
    except Exception as e:
        log.warning("抓取失败: %s", e)
        write_sync_log("indicator_data", "failed", 0, "fetch: " + str(e))
        return

    if trailing_pe is None:
        log.warning("Yahoo 未返回 trailingPE")
        write_sync_log("indicator_data", "failed", 0, "no trailingPE returned")
        return

    try:
        val = Decimal(str(trailing_pe)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    except Exception as e:
        log.warning("数值转换失败: %s (原始值=%s)", e, trailing_pe)
        write_sync_log("indicator_data", "failed", 0, "parse: " + str(e))
        return

    today = date.today().strftime("%Y-%m-%d")
    log.info("S&P 500 PE @ %s = %s", today, val)

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO indicator_data (indicator_id, period_date, value, updated_at) "
                    "VALUES (%s, %s, %s, NOW()) "
                    "ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()",
                    (indicator_id, today, val),
                )
            conn.commit()
        log.info("写入成功")
        write_sync_log("indicator_data", "success", 1, "SP500_PE = %s" % val)
    except Exception as e:
        log.warning("写入失败: %s", e)
        write_sync_log("indicator_data", "failed", 0, "write: " + str(e))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""同步美股核心资产历史日线价格。

当前目标: S&P 500 (^GSPC), 用于市场制式回测。
数据源: Yahoo Finance (yfinance)
写入表: asset_prices, data_sync_logs

用法:
    python3 fetch_us_asset_prices.py
"""
import os
import sys
import time
import logging
import threading
from datetime import datetime

import pymysql
import yfinance as yf


# ============== 数据库连接（生产环境） ==============
DB_HOST = "204.44.121.43"
DB_PORT = 3306
DB_USER = "mnigc"
DB_PASSWORD = "woaiyinyue.4"
DB_NAME = "invest_platform"


# ============== 运行参数 ==============
MAX_RETRY = 4
TIMEOUT = 60
START_DATE = "2010-01-01"

# (symbol, 描述)
TARGETS = [
    ("^GSPC", "S&P 500"),
]


# ============== 日志 ==============
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


log = _setup_logger("fetch_us_asset_prices")


# ============== 数据库辅助 ==============
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
                    (sync_type, "", status, records_count, error_message, now, now),
                )
            conn.commit()
    except Exception as e:
        log.warning("写入 data_sync_logs 失败: %s", e)


def init_table(conn):
    sql = """
    CREATE TABLE IF NOT EXISTS asset_prices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        asset_id INT NOT NULL,
        trade_date DATE NOT NULL,
        close_price DECIMAL(14, 4) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_asset_date (asset_id, trade_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()


# ============== 通用 with_retry ==============
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
            last_err = Exception("调用超过 %ds" % TIMEOUT)
        elif err_holder:
            last_err = err_holder[0]
        else:
            return holder[0] if holder else None
        wait = min(2 ** (attempt - 1), 15)
        log.warning("第 %d/%d 次失败: %s，%ds 后重试", attempt, MAX_RETRY, last_err, wait)
        time.sleep(wait)
    raise last_err if last_err else RuntimeError("未知错误")


# ============== 抓取 ==============
def fetch_history(symbol):
    def _download():
        return yf.download(
            symbol,
            start=START_DATE,
            progress=False,
            auto_adjust=False,
            prepost=False,
        )

    df = with_retry(_download)
    if df is None or df.empty:
        return []
    df = df.reset_index()
    # 兼容 yfinance 返回的多级列名
    close_col = "Close"
    if close_col not in df.columns:
        close_col = next((c for c in df.columns if isinstance(c, tuple) and "Close" in c), None)
    if close_col is None:
        raise RuntimeError("未找到 Close 列: %s" % list(df.columns))

    rows = []
    for _, row in df.iterrows():
        date = row["Date"]
        if hasattr(date, "to_pydatetime"):
            date = date.to_pydatetime().strftime("%Y-%m-%d")
        else:
            date = str(date)[:10]
        close = row[close_col]
        try:
            close_val = float(close)
            if close_val > 0:
                rows.append((date, close_val))
        except Exception:
            continue
    return rows


# ============== 主流程 ==============
def sync_symbol(conn, symbol, desc):
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM assets WHERE symbol = %s", (symbol,))
        row = cur.fetchone()
    if not row:
        log.warning("未在 assets 表中找到 %s，跳过", symbol)
        return 0

    asset_id = row["id"]
    log.info("开始同步 %s (%s) 历史日线...", desc, symbol)
    rows = fetch_history(symbol)
    if not rows:
        log.warning("未获取到 %s 数据", symbol)
        return 0

    inserted = 0
    with conn.cursor() as cur:
        for trade_date, close_price in rows:
            cur.execute(
                """
                INSERT INTO asset_prices (asset_id, trade_date, close_price)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE close_price = VALUES(close_price)
                """,
                (asset_id, trade_date, close_price),
            )
            inserted += cur.rowcount
    conn.commit()
    log.info("%s 写入完成: %d 条", symbol, inserted)
    return inserted


def main():
    log.info("=" * 60)
    log.info("开始同步美股核心资产历史日线")

    total = 0
    try:
        with get_conn() as conn:
            init_table(conn)
            for symbol, desc in TARGETS:
                try:
                    total += sync_symbol(conn, symbol, desc)
                    time.sleep(2)
                except Exception as e:
                    log.error("同步 %s 失败: %s", symbol, e)

        msg = "共写入 %d 条价格记录" % total
        log.info("同步完成: %s", msg)
        write_sync_log("us_asset_prices", "success", total, msg)
    except Exception as e:
        log.error("同步失败: %s", e)
        write_sync_log("us_asset_prices", "failed", total, str(e))
        raise


if __name__ == "__main__":
    main()

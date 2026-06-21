#!/usr/bin/env python3
"""同步美国资产快照（美股指数 / ETF / 商品 / 外汇）。
数据源: Yahoo Finance (yfinance)
写入表: asset_snapshots, data_sync_logs
用法:
    python3 fetch_us_assets.py
"""
import os
import sys
import time
import logging
import threading
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

import pymysql
import yfinance as yf


# ============== 数据库连接（生产环境） ==============
DB_HOST = "204.44.121.43"
DB_PORT = 3306
DB_USER = "mnigc"
DB_PASSWORD = "woaiyinyue.4"
DB_NAME = "invest_platform"

# ============== 运行参数 ==============
MAX_RETRY = 4              # 每个 symbol 最多重试次数
TIMEOUT = 30               # 单次请求超时（秒）
SLEEP_BETWEEN = 2.0        # 每个资产之间间隔（秒），防止被 Yahoo 限流


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

log = _setup_logger("fetch_us_assets")


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


# ============== 抓取辅助：指数回退重试 + 超时 ==============
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
            last_err = Exception("调用 %s 超过 %ds" % (getattr(fn, "__name__", "fn"), TIMEOUT))
        elif err_holder:
            last_err = err_holder[0]
        else:
            return holder[0] if holder else None
        wait = min(2 ** (attempt - 1), 15)
        log.warning("第 %d/%d 次失败: %s，%ds 后重试", attempt, MAX_RETRY, last_err, wait)
        time.sleep(wait)
    raise last_err if last_err else RuntimeError("未知错误")


# ============== 抓取 Yahoo: 最新价格 + 涨跌 ==============
def _yf_fetch_one(symbol):
    t = yf.Ticker(symbol)
    hist = t.history(period="5d")
    if hist is None or hist.empty:
        return None
    closes = hist["Close"].dropna()
    if closes is None or closes.empty or len(closes) < 1:
        return None
    current = Decimal(str(closes.iloc[-1])).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    prev = (Decimal(str(closes.iloc[-2])).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
            if len(closes) >= 2 else None)
    change_pct = None
    if prev and prev > 0:
        change_pct = (current / prev - Decimal("1")).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    vol = None
    if "Volume" in hist.columns:
        v = hist["Volume"].dropna()
        if not v.empty:
            try:
                vol = int(v.iloc[-1])
            except Exception:
                vol = None
    return {"price": current, "change_pct": change_pct, "volume": vol}


def main():
    log.info("=" * 60)
    log.info("开始同步美国资产 (Yahoo Finance)")

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, symbol, name_zh, sub_category FROM assets WHERE is_active = 1 ORDER BY symbol"
                )
                assets = cur.fetchall()
        log.info("资产表共 %d 条", len(assets))
    except Exception as e:
        log.error("读取资产表失败: %s", e)
        write_sync_log("asset_snapshot", "failed", 0, "read assets: " + str(e))
        return

    errors = []
    success_count = 0

    for asset in assets:
        symbol = asset["symbol"]
        name = asset.get("name_zh") or symbol
        try:
            data = with_retry(_yf_fetch_one, symbol)
        except Exception as e:
            log.warning("%s (%s) 抓取失败: %s", symbol, name, e)
            errors.append("%s: %s" % (symbol, e))
            time.sleep(SLEEP_BETWEEN)
            continue

        if not data or data.get("price") is None:
            log.warning("%s (%s) - 无价格数据，跳过", symbol, name)
            errors.append("%s: no data" % symbol)
            time.sleep(SLEEP_BETWEEN)
            continue

        price = data["price"]
        change_pct = data.get("change_pct")
        volume = data.get("volume") or 0

        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO asset_snapshots (asset_id, last_price, change_percent, volume, updated_at) "
                        "VALUES (%s, %s, %s, %s, NOW()) "
                        "ON DUPLICATE KEY UPDATE "
                        "last_price = VALUES(last_price), change_percent = VALUES(change_percent), "
                        "volume = VALUES(volume), updated_at = NOW()",
                        (asset["id"], price, change_pct, volume),
                    )
                conn.commit()
            success_count += 1
            log.info("%s (%s) OK: price=%s, change=%s, vol=%s",
                     symbol, name, price, change_pct, volume)
        except Exception as e:
            log.warning("%s (%s) 写入失败: %s", symbol, name, e)
            errors.append("%s: write: %s" % (symbol, e))
        time.sleep(SLEEP_BETWEEN)

    if errors and success_count > 0:
        status = "partial"
    elif success_count > 0:
        status = "success"
    else:
        status = "failed"
    msg = "成功 %d, 失败 %d; 前 5 条: %s" % (success_count, len(errors), "; ".join(errors[:5]))
    log.info(msg)
    write_sync_log("asset_snapshot", status, success_count, msg)


if __name__ == "__main__":
    main()

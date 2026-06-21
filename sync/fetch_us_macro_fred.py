#!/usr/bin/env python3
"""同步美国宏观经济指标（GDP / CPI / PPI / 失业率 / 联邦基金利率 / 美债收益率 等）。
数据源: FRED 官方 REST API（海外/国内均稳定）
写入表: indicator_data, data_sync_logs
用法:
    python3 fetch_us_macro_fred.py
"""
import os
import sys
import time
import logging
import threading
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

import pymysql
import requests


# ============== 数据库连接（生产环境） ==============
DB_HOST = "204.44.121.43"
DB_PORT = 3306
DB_USER = "mnigc"
DB_PASSWORD = "woaiyinyue.4"
DB_NAME = "invest_platform"

# ============== FRED API ==============
# 申请免费 key: https://fred.stlouisfed.org/docs/api/api_key.html
# 留空会退化为 DEMO_KEY，但数据会被截断
FRED_API_KEY = "671a9677b4cd70b6e85452f33a2c54ab"
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"

# ============== 运行参数 ==============
MAX_RETRY = 4
HTTP_TIMEOUT = 30
SLEEP_BETWEEN = 0.5

# indicators.code -> FRED series id
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

log = _setup_logger("fetch_us_macro_fred")


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
            last_err = Exception("HTTP 请求超过 %ds" % HTTP_TIMEOUT)
        elif err_holder:
            last_err = err_holder[0]
        else:
            return holder[0] if holder else None
        wait = min(2 ** (attempt - 1), 15)
        log.warning("第 %d/%d 次失败: %s，%ds 后重试", attempt, MAX_RETRY, last_err, wait)
        time.sleep(wait)
    raise last_err if last_err else RuntimeError("未知错误")


# ============== 抓取 FRED ==============
def _http_get_fred(params):
    r = requests.get(FRED_URL, params=params, timeout=HTTP_TIMEOUT)
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
        try:
            val = Decimal(val_str).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        except Exception:
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
                cur.execute(
                    "SELECT id, code, name_zh FROM indicators "
                    "WHERE is_active = 1 AND region = 'US' AND source = 'FRED' ORDER BY code"
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
            log.warning("%s (%s) - 没有配置 FRED series_id，跳过", code, name)
            errors.append("%s: no FRED mapping" % code)
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

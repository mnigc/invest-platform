#!/usr/bin/env python3
"""同步 A 股市场估值数据。

数据源: akshare
写入表: cn_valuation, data_sync_logs
用法:
    python3 fetch_cn_valuation.py
"""
import os
import sys
import time
import json
import logging
import threading
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

import pymysql


# ============== 数据库连接（生产环境） ==============
DB_HOST = "204.44.121.43"
DB_PORT = 3306
DB_USER = "mnigc"
DB_PASSWORD = "woaiyinyue.4"
DB_NAME = "invest_platform"


# ============== 运行参数 ==============
MAX_RETRY = 4
TIMEOUT = 30


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


log = _setup_logger("fetch_cn_valuation")


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
    CREATE TABLE IF NOT EXISTS cn_valuation (
        id INT AUTO_INCREMENT PRIMARY KEY,
        date DATE NOT NULL,
        overall_pe DECIMAL(10, 4),
        overall_pb DECIMAL(10, 4),
        overall_signal VARCHAR(20),
        industries_json JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_date (date)
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


# ============== 抓取辅助 ==============
def _safe_dec(v, digits=4):
    if v is None:
        return None
    s = str(v).strip()
    if s in ("", "nan", "NaN", "None", "-"):
        return None
    try:
        return Decimal(s).quantize(Decimal("1").scaleb(-digits), rounding=ROUND_HALF_UP)
    except Exception:
        return None


def fetch_market_pe():
    """全部 A 股平均市盈率 (TTM)"""
    import akshare as ak
    df = with_retry(ak.stock_market_pe_lg)
    if df is None or df.empty:
        return None, None

    cols = list(df.columns)
    # 列名：日期, 指数, 平均市盈率
    pe_col = next((c for c in cols if "平均市盈率" in c), None)
    if pe_col is None:
        pe_col = cols[-1]

    # 取最新一行
    latest = df.iloc[-1]
    pe = _safe_dec(latest.get(pe_col), 4)
    return pe, None


def fetch_industry_pe():
    """申万一级行业 PE/PB/股票家数"""
    import akshare as ak
    df = with_retry(ak.sw_index_first_info)
    if df is None or df.empty:
        return []

    cols = list(df.columns)
    # 列名：行业代码, 行业名称, 成份个数, 静态市盈率, TTM(滚动)市盈率, 市净率, 静态股息率
    name_col = next((c for c in cols if "行业名称" in c), cols[0])
    pe_col = next((c for c in cols if "TTM" in c and "市盈" in c), None)
    if pe_col is None:
        pe_col = next((c for c in cols if "市盈" in c), None)
    pb_col = next((c for c in cols if "市净" in c), None)
    count_col = next((c for c in cols if "成份个数" in c or "成分个数" in c), None)

    industries = []
    for _, row in df.iterrows():
        name = str(row.get(name_col, "")).strip()
        if not name:
            continue
        pe = _safe_dec(row.get(pe_col) if pe_col else None, 4)
        pb = _safe_dec(row.get(pb_col) if pb_col else None, 4)
        count = None
        if count_col:
            try:
                count = int(float(row.get(count_col, 0)))
            except Exception:
                count = None
        if pe is not None or pb is not None:
            industries.append({
                "name": name,
                "pe": float(pe) if pe is not None else None,
                "pb": float(pb) if pb is not None else None,
                "stockCount": count,
            })
    return industries


def signal_from_pe(pe):
    if pe is None:
        return "--"
    if pe < 15:
        return "低估"
    if pe < 20:
        return "中性偏低"
    if pe < 25:
        return "中性"
    if pe < 30:
        return "中性偏高"
    return "高估"


# ============== 主流程 ==============
def main():
    log.info("=" * 60)
    log.info("开始同步 A 股估值数据")

    try:
        with get_conn() as conn:
            init_table(conn)

            overall_pe, overall_pb = fetch_market_pe()
            industries = fetch_industry_pe()

            if overall_pe is None and not industries:
                raise RuntimeError("未能获取任何估值数据")

            signal = signal_from_pe(overall_pe)
            today = datetime.now().strftime("%Y-%m-%d")

            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO cn_valuation (date, overall_pe, overall_pb, overall_signal, industries_json)
                    VALUES (%s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        overall_pe = VALUES(overall_pe),
                        overall_pb = VALUES(overall_pb),
                        overall_signal = VALUES(overall_signal),
                        industries_json = VALUES(industries_json)
                    """,
                    (today, overall_pe, overall_pb, signal, json.dumps(industries, ensure_ascii=False)),
                )
            conn.commit()

            msg = "全市场PE=%s, 行业数=%d" % (overall_pe, len(industries))
            log.info("写入完成: %s", msg)
            write_sync_log("cn_valuation", "success", len(industries) + 1, msg)
    except Exception as e:
        log.error("同步失败: %s", e)
        write_sync_log("cn_valuation", "failed", 0, str(e))
        raise


if __name__ == "__main__":
    main()

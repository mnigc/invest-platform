#!/usr/bin/env python3
"""
同步行业/风格/综合指数日线数据
用法:
  python3 sync_style_index.py           # 拉1年数据
  python3 sync_style_index.py --daily   # 仅拉昨日数据
"""

import sys
import os
import time
import logging
from datetime import datetime, date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Any

import pymysql
import akshare as ak

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
logger = logging.getLogger("sync_style_index")

DB_HOST = os.environ.get("DB_HOST", "204.44.121.43")
DB_PORT = int(os.environ.get("DB_PORT", "3306"))
DB_USER = os.environ.get("DB_USER", "mnigc")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "woaiyinyue.4")
DB_NAME = os.environ.get("DB_NAME", "invest_platform")

TODAY = date.today().strftime("%Y%m%d")
YESTERDAY = (date.today() - timedelta(days=1)).strftime("%Y%m%d")
ONE_YEAR_AGO = (date.today() - timedelta(days=365)).strftime("%Y%m%d")

SW_L1 = [
    ("801010", "农林牧渔"), ("801020", "基础化工"), ("801030", "钢铁"),
    ("801040", "有色金属"), ("801050", "电子"), ("801080", "汽车"),
    ("801110", "家用电器"), ("801120", "食品饮料"), ("801130", "纺织服饰"),
    ("801140", "轻工制造"), ("801150", "医药生物"), ("801160", "公用事业"),
    ("801170", "交通运输"), ("801180", "房地产"), ("801200", "商贸零售"),
    ("801210", "社会服务"), ("801230", "银行"), ("801240", "非银金融"),
    ("801250", "综合"), ("801710", "建筑材料"), ("801720", "建筑装饰"),
    ("801730", "电力设备"), ("801740", "国防军工"), ("801750", "计算机"),
    ("801760", "传媒"), ("801770", "通信"), ("801780", "煤炭"),
    ("801790", "石油石化"), ("801880", "环保"), ("801950", "美容护理"),
]

STYLE = [
    ("399364", "大盘价值"), ("399365", "大盘成长"),
    ("399366", "中盘价值"), ("399367", "中盘成长"),
    ("399368", "小盘价值"), ("399369", "小盘成长"),
]

MAIN = [
    ("000001", "上证综指"), ("399001", "深证成指"), ("399006", "创业板指"),
    ("000688", "科创50"), ("899050", "北证50"),
]


def get_conn():
    return pymysql.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
    )


def log_sync(sync_type, status, records_count=0, error_message=""):
    started_at = finished_at = time.strftime("%Y-%m-%d %H:%M:%S")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO data_sync_logs (sync_type,status,records_count,error_message,started_at,finished_at) VALUES (%s,%s,%s,%s,%s,%s)",
                (sync_type, status, records_count, error_message, started_at, finished_at),
            )
            conn.commit()
    finally:
        conn.close()


def init_table():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS index_daily (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    index_code VARCHAR(20) NOT NULL,
                    index_name VARCHAR(50) NOT NULL,
                    category VARCHAR(20) NOT NULL,
                    trade_date DATE NOT NULL,
                    open_price DECIMAL(12,4),
                    high_price DECIMAL(12,4),
                    low_price DECIMAL(12,4),
                    close_price DECIMAL(12,4),
                    volume BIGINT,
                    amount DECIMAL(18,2),
                    change_pct DECIMAL(8,4),
                    turnover_rate DECIMAL(8,4),
                    UNIQUE KEY idx_code_date (index_code, trade_date),
                    INDEX idx_category (category),
                    INDEX idx_trade_date (trade_date)
                )
            """)
        conn.commit()
    finally:
        conn.close()


def safe_decimal(v):
    if v is None:
        return None
    try:
        if str(v) in ("nan", "NaN", "None", ""):
            return None
        return Decimal(str(v)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    except:
        return None


def safe_int(v):
    if v is None:
        return None
    try:
        return int(v)
    except:
        return None


def _run_with_timeout(fn, args=(), kwargs=None, timeout=20):
    """在线程中运行函数，超时返回 None（防止 API 卡死）"""
    import threading
    result = [None]
    exc = [None]

    def worker():
        try:
            result[0] = fn(*args, **(kwargs or {}))
        except Exception as e:
            exc[0] = e

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    t.join(timeout)
    if t.is_alive():
        logger.warning(f"  API 请求超时（>{timeout}s）")
        return None
    if exc[0]:
        raise exc[0]
    return result[0]


def fetch_index(code, start_date, end_date):
    """获取指数日线（腾讯源优先，失败回退东财）"""

    def _try_eastmoney(code, start_date, end_date):
        df = _run_with_timeout(
            ak.index_zh_a_hist,
            kwargs={"symbol": code, "period": "daily", "start_date": start_date, "end_date": end_date},
            timeout=20,
        )
        if df is not None and not df.empty:
            return df
        return None

    def try_eastmoney(code, start_date, end_date):
        for attempt in range(2):
            if attempt > 0:
                time.sleep(3)
            try:
                df = _try_eastmoney(code, start_date, end_date)
                if df is not None:
                    return df
            except Exception as e:
                logger.warning(f"  东财尝试 {attempt+1}/2 失败: {e}")
        return None

    # 申万行业指数(801xxx)腾讯不支持，直接走东财
    if code.startswith("801"):
        return try_eastmoney(code, start_date, end_date)

    # 其他指数：先试腾讯，再试东财
    tx_prefix = "sh" if not code.startswith("399") else "sz"
    tx_symbol = f"{tx_prefix}{code}"

    for attempt in range(2):
        if attempt > 0:
            time.sleep(2)
        try:
            df = _run_with_timeout(
                ak.stock_zh_index_daily_tx,
                kwargs={"symbol": tx_symbol, "start_date": start_date, "end_date": end_date},
                timeout=15,
            )
            if df is not None and not df.empty:
                df = df.rename(columns={
                    "date": "日期", "open": "开盘", "close": "收盘",
                    "high": "最高", "low": "最低", "amount": "成交量",
                })
                close_vals = df["收盘"].astype(float)
                df["涨跌幅"] = close_vals.pct_change() * 100
                df["涨跌幅"] = df["涨跌幅"].fillna(0)
                return df
        except Exception as e:
            logger.warning(f"  腾讯尝试 {attempt+1}/2 失败: {e}")

    return try_eastmoney(code, start_date, end_date)


def save_df(cur, df, code, name, category):
    count = 0
    for _, row in df.iterrows():
        try:
            td = str(row.get("日期", ""))
            if not td or "-" not in td:
                continue
            cur.execute(
                """INSERT INTO index_daily
                   (index_code,index_name,category,trade_date,open_price,high_price,low_price,close_price,volume,amount,change_pct,turnover_rate)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON DUPLICATE KEY UPDATE
                   open_price=VALUES(open_price),high_price=VALUES(high_price),low_price=VALUES(low_price),
                   close_price=VALUES(close_price),volume=VALUES(volume),amount=VALUES(amount),
                   change_pct=VALUES(change_pct),turnover_rate=VALUES(turnover_rate)""",
                (code, name, category, td,
                 safe_decimal(row.get("开盘")), safe_decimal(row.get("最高")),
                 safe_decimal(row.get("最低")), safe_decimal(row.get("收盘")),
                 safe_int(row.get("成交量")), safe_decimal(row.get("成交额")),
                 safe_decimal(row.get("涨跌幅")), safe_decimal(row.get("换手率"))),
            )
            count += 1
        except:
            continue
    return count


def main():
    daily_only = "--daily" in sys.argv
    start_date = YESTERDAY if daily_only else ONE_YEAR_AGO
    end_date = TODAY

    init_table()
    total = 0

    for label, items, cat in [
        ("申万一级行业指数", SW_L1, "sw_l1"),
        ("风格指数", STYLE, "style"),
        ("主要综合指数", MAIN, "main"),
    ]:
        logger.info("=" * 50)
        logger.info(f"开始同步 {label}")
        for code, name in items:
            logger.info(f"  正在获取 {name} ({code})...")
            df = fetch_index(code, start_date, end_date)
            if df is None:
                logger.warning(f"  {name} ({code}): 跳过（获取失败）")
                continue
            conn = get_conn()
            try:
                with conn.cursor() as cur:
                    count = save_df(cur, df, code, name, cat)
                    total += count
                conn.commit()
                logger.info(f"  {name} ({code}): {count} 条")
            finally:
                conn.close()
            time.sleep(0.5)

    logger.info(f"同步完成，共 {total} 条数据")
    log_sync("index_daily", "success", total, f"同步了 {len(SW_L1)+len(STYLE)+len(MAIN)} 个指数")


if __name__ == "__main__":
    main()

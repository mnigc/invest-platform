#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""同步商品期货期限结构数据。

数据源: Yahoo Finance (yfinance)
写入表: commodity_curves, data_sync_logs

使用方式:
    python sync/fetch_commodity_curves.py
"""

import os, sys, time, logging, datetime as dt
import pymysql
import yfinance as yf
import pandas as pd

# ============================================================
# 数据库连接
# ============================================================
DB_HOST = "204.44.121.43"
DB_PORT = 3306
DB_USER = "mnigc"
DB_PASSWORD = "woaiyinyue.4"
DB_NAME = "invest_platform"

# ============================================================
# 商品定义
# 合约代码格式: {ROOT}{MONTH_CODE}{2DIGIT_YEAR}.{EXCHANGE}
# 月度代码: F=1,G=2,H=3,J=4,K=5,M=6,N=7,Q=8,U=9,V=10,X=11,Z=12
# 交易所: NYM=NYMEX(CL,NG), CMX=COMEX(GC,HG), CBT=CBOT(C,W,S)
# ============================================================
MONTH_CODES = {1:'F',2:'G',3:'H',4:'J',5:'K',6:'M',7:'N',8:'Q',9:'U',10:'V',11:'X',12:'Z'}

# code -> (name_cn, yahoo_root, exchange, active_months, contract_count)
COMMODITIES = {
    'CL': {'name_cn': 'WTI原油', 'root': 'CL', 'exch': 'NYM', 'months': list(range(1,13)), 'count': 12},
    'NG': {'name_cn': '天然气',   'root': 'NG', 'exch': 'NYM', 'months': list(range(1,13)), 'count': 12},
    'HG': {'name_cn': '铜',       'root': 'HG', 'exch': 'CMX', 'months': [3,5,7,9,12],     'count': 10},
    'GC': {'name_cn': '黄金',     'root': 'GC', 'exch': 'CMX', 'months': [2,4,6,8,10,12],  'count': 10},
    'C':  {'name_cn': '玉米',     'root': 'ZC', 'exch': 'CBT', 'months': [3,5,7,9,12],     'count': 8},
    'W':  {'name_cn': '小麦',     'root': 'ZW', 'exch': 'CBT', 'months': [3,5,7,9,12],     'count': 8},
    'S':  {'name_cn': '大豆',     'root': 'ZS', 'exch': 'CBT', 'months': [1,3,5,7,8,9,11], 'count': 8},
}

def generate_contracts(code, info):
    """Generate (month_label, ticker, contract_code) for each contract."""
    today = dt.date.today()
    y, m = today.year, today.month
    root = info['root']
    exch = info['exch']
    count = info['count']
    months = info['months']
    contracts = []
    seen = set()
    while len(contracts) < count:
        if m in months:
            mc = MONTH_CODES[m]
            year_suffix = str(y)[-2:]
            contract_code = f"{code}{mc}{year_suffix}"
            ticker_code = f"{root}{mc}{year_suffix}"
            pair = (code, contract_code)
            if pair not in seen:
                seen.add(pair)
                month_label = f"{y}-{m:02d}"
                ticker = f"{ticker_code}.{exch}"
                contracts.append((month_label, ticker, contract_code))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return contracts

# ============================================================
# 日志
# ============================================================
logger = logging.getLogger("fetch_commodity_curves")
logger.setLevel(logging.INFO)
_fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
_ch = logging.StreamHandler(sys.stdout)
_ch.setFormatter(_fmt)
logger.addHandler(_ch)
try:
    _log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch_commodity_curves.log")
    _fh = logging.FileHandler(_log_path, encoding="utf-8")
    _fh.setFormatter(_fmt)
    logger.addHandler(_fh)
except Exception:
    pass

# ============================================================
# 数据库辅助
# ============================================================
def get_conn():
    return pymysql.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
    )

def ensure_tables():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS commodity_curves (
                    id          INT AUTO_INCREMENT PRIMARY KEY,
                    commodity   VARCHAR(10) NOT NULL,
                    contract    VARCHAR(20) NOT NULL,
                    month_label VARCHAR(7)  NOT NULL,
                    price       DECIMAL(16,4),
                    snapshot_date DATE NOT NULL,
                    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uk_curve (commodity, contract, snapshot_date),
                    KEY idx_date (snapshot_date),
                    KEY idx_commodity (commodity)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            logger.info("[OK] commodity_curves table ready")

def write_sync_log(sync_type, status, records_count, error_message=""):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO data_sync_logs (sync_type, status, records_count, error_message, started_at, finished_at) "
                    "VALUES (%s, %s, %s, %s, NOW(), NOW())",
                    (sync_type, status, records_count, error_message)
                )
            conn.commit()
    except Exception as e:
        logger.warning("Log write failed: %s", e)

# ============================================================
# 主流程
# ============================================================
def main():
    logger.info("=" * 60)
    logger.info("Start syncing commodity curve data")
    logger.info("=" * 60)

    ensure_tables()

    today = dt.date.today()
    total_records = 0
    errors = []

    # 查出今天已拉取的合约，跳过
    existing = set()
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT commodity, contract FROM commodity_curves WHERE snapshot_date = %s",
                    (today,)
                )
                for row in cur.fetchall():
                    existing.add((row['commodity'], row['contract']))
        if existing:
            logger.info("[INC] %d contracts already have today's data, will skip", len(existing))
    except Exception as e:
        logger.warning("  query existing records failed: %s", e)

    for code, info in COMMODITIES.items():
        logger.info("--- %s (%s) ---", info['name_cn'], code)
        contracts = generate_contracts(code, info)
        # 过滤掉今日已存在的
        to_fetch = [(ml, tk, cc) for ml, tk, cc in contracts if (code, cc) not in existing]
        if not to_fetch:
            logger.info("  all %d contracts already synced today, skip", len(contracts))
            continue
        skipped = len(contracts) - len(to_fetch)
        if skipped:
            logger.info("  %d already synced, %d to fetch", skipped, len(to_fetch))
        tickers = [c[1] for c in to_fetch]

        # 一次批量下载所有合约
        try:
            df = yf.download(tickers, period="5d", group_by="ticker", progress=False, threads=False)
        except Exception as e:
            logger.warning("  download failed: %s", e)
            errors.append(f"{code}: {e}")
            time.sleep(2)
            continue

        if df is None or df.empty:
            logger.warning("  %s: empty response", code)
            time.sleep(2)
            continue

        rows = []
        for month_label, ticker, contract_code in to_fetch:
            try:
                if len(tickers) == 1:
                    close = df['Close']
                else:
                    close = df[ticker]['Close']
                if close is None or close.empty:
                    logger.warning("  [SKIP] %s no close data", ticker)
                    continue
                last_price = close.dropna().iloc[-1]
                if last_price <= 0:
                    logger.warning("  [SKIP] %s invalid price: %.2f", ticker, last_price)
                    continue
                rows.append((code, contract_code, month_label, float(last_price), today))
                logger.info("  [OK] %s = %.2f", contract_code, last_price)
            except Exception as e:
                logger.warning("  [SKIP] %s: %s", ticker, e)

        if rows:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    for r in rows:
                        cur.execute(
                            "INSERT INTO commodity_curves (commodity, contract, month_label, price, snapshot_date) "
                            "VALUES (%s, %s, %s, %s, %s) "
                            "ON DUPLICATE KEY UPDATE price = VALUES(price)",
                            r
                        )
                conn.commit()
            total_records += len(rows)
            logger.info("  wrote %d rows", len(rows))
        else:
            logger.warning("  %s: no valid data", code)
            errors.append(f"{code}: no valid data")

        time.sleep(2)

    status = "success" if not errors else "partial"
    err_msg = "; ".join(str(e) for e in errors[:10]) if errors else ""
    if len(errors) > 10:
        err_msg += f"... total {len(errors)} errors"
    write_sync_log("commodity_curves", status, total_records, err_msg)

    logger.info("=" * 60)
    logger.info("Done: %d records", total_records)
    if errors:
        logger.warning("Errors: %d", len(errors))
    logger.info("=" * 60)


if __name__ == "__main__":
    main()

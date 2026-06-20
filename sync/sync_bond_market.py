#!/usr/bin/env python3
"""
同步美国国债收益率曲线 + 股权风险溢价(ERP)
用法: python3 sync_bond_market.py
"""

import sys
import os
import time
import logging
from datetime import datetime, date, timedelta
from decimal import Decimal

import pymysql
import requests
import yfinance as yf

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
logger = logging.getLogger("sync_bond_market")

DB_HOST = os.environ.get("DB_HOST", "204.44.121.43")
DB_PORT = int(os.environ.get("DB_PORT", "3306"))
DB_USER = os.environ.get("DB_USER", "mnigc")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "woaiyinyue.4")
DB_NAME = os.environ.get("DB_NAME", "invest_platform")
FRED_API_KEY = os.environ.get("FRED_API_KEY", "671a9677b4cd70b6e85452f33a2c54ab")
FRED_DELAY = 0.3

CURVE_SERIES = ["DGS1MO", "DGS3MO", "DGS6MO", "DGS1", "DGS2", "DGS3", "DGS5", "DGS7", "DGS10", "DGS20", "DGS30"]


def get_conn():
    return pymysql.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor
    )


def get_indicator_id(code):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM indicators WHERE code = %s AND is_active = TRUE", (code,))
            row = cur.fetchone()
            return row["id"] if row else None
    finally:
        conn.close()


def get_last_date(indicator_id):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(period_date) as max_date FROM indicator_data WHERE indicator_id = %s", (indicator_id,))
            row = cur.fetchone()
            if row and row["max_date"]:
                if isinstance(row["max_date"], (datetime, date)):
                    return row["max_date"].strftime("%Y-%m-%d")
                return row["max_date"]
            return None
    finally:
        conn.close()


def upsert_data(indicator_id, period_date, value):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO indicator_data (indicator_id, period_date, value, updated_at) VALUES (%s, %s, %s, NOW()) "
                "ON DUPLICATE KEY UPDATE value=VALUES(value), updated_at=NOW()",
                (indicator_id, period_date, value)
            )
            conn.commit()
    finally:
        conn.close()


def fetch_fred_series(series_id, indicator_id):
    last_date = get_last_date(indicator_id)
    params = {"series_id": series_id, "api_key": FRED_API_KEY, "file_type": "json", "sort_order": "asc"}
    if last_date:
        params["observation_start"] = (datetime.strptime(last_date, "%Y-%m-%d") - timedelta(days=90)).strftime("%Y-%m-%d")

    resp = requests.get("https://api.stlouisfed.org/fred/series/observations", params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    inserted = 0
    for obs in data.get("observations", []):
        val_str = obs.get("value", "").strip()
        if val_str in ("", "."):
            continue
        try:
            val = Decimal(val_str)
        except:
            continue
        period = obs.get("date")
        if not period:
            continue
        upsert_data(indicator_id, period, val)
        inserted += 1
    return inserted


def sync_yield_curve():
    logger.info("=" * 50)
    logger.info("同步美国国债收益率曲线 (FRED)")
    total = 0
    for code in CURVE_SERIES:
        ind_id = get_indicator_id(code)
        if not ind_id:
            logger.warning(f"  {code}: 数据库未找到指标记录，跳过")
            continue
        try:
            count = fetch_fred_series(code, ind_id)
            total += count
            logger.info(f"  {code}: 新增/更新 {count} 条")
        except Exception as e:
            logger.warning(f"  {code}: {e}")
        time.sleep(FRED_DELAY)
    logger.info(f"收益率曲线同步完成，共 {total} 条数据")


def sync_pe_data():
    """
    通过 yfinance 获取 S&P 500 的 trailing PE 数据，
    写入 SP500_PE 指标（按周记录）。
    """
    logger.info("同步 S&P 500 PE 数据 (Yahoo Finance)")
    ind_id = get_indicator_id("SP500_PE")
    if not ind_id:
        logger.warning("  指标 SP500_PE 不存在，跳过 PE 同步。请先执行数据库迁移")
        return

    try:
        sp500 = yf.Ticker("^GSPC")
        info = sp500.info
        trailing_pe = info.get("trailingPE")
        if trailing_pe is None:
            logger.warning("  Yahoo Finance 未返回 trailing PE")
            return

        today = date.today().strftime("%Y-%m-%d")
        upsert_data(ind_id, today, Decimal(str(trailing_pe)))
        logger.info(f"  SP500 PE: {trailing_pe} ({today})")
    except Exception as e:
        logger.warning(f"  获取 PE 失败: {e}")


def main():
    logger.info("=== 开始同步：债券市场数据 ===")
    sync_yield_curve()
    sync_pe_data()
    logger.info("=== 全部完成 ===")


if __name__ == "__main__":
    main()

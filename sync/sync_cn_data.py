#!/usr/bin/env python3
"""
同步中国经济数据 (GDP/CPI/PPI/PMI/零售)
用法: python3 sync_cn_data.py
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
logger = logging.getLogger("sync_cn_data")

DB_HOST = os.environ.get("DB_HOST", "204.44.121.43")
DB_PORT = int(os.environ.get("DB_PORT", "3306"))
DB_USER = os.environ.get("DB_USER", "mnigc")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "woaiyinyue.4")
DB_NAME = os.environ.get("DB_NAME", "invest_platform")

YEAR_MAP = {'一': '1', '二': '2', '三': '3', '四': '4', '1': '1', '2': '2', '3': '3', '4': '4'}


def get_conn():
    return pymysql.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor
    )


def log_sync(sync_type, status, records_count=0, error_message=""):
    started_at = finished_at = time.strftime("%Y-%m-%d %H:%M:%S")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO data_sync_logs (sync_type, status, records_count, error_message, started_at, finished_at) VALUES (%s, %s, %s, %s, %s, %s)",
                (sync_type, status, records_count, error_message, started_at, finished_at)
            )
            conn.commit()
    finally:
        conn.close()


def get_cn_indicators():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, code, name_zh, name_en, category, sub_category, unit, frequency, source FROM indicators WHERE is_active = TRUE AND region = 'CN' ORDER BY category, sub_category, id")
            return cur.fetchall()
    finally:
        conn.close()


def safe_decimal(v: Any) -> Optional[Decimal]:
    if v is None:
        return None
    try:
        if str(v) in ('nan', 'NaN', 'None', ''):
            return None
        return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except:
        return None


def upsert_indicator_data_safe(cur, indicator_id: int, period_date: str, value: Decimal) -> bool:
    if value is None:
        return False
    try:
        cur.execute(
            "INSERT INTO indicator_data (indicator_id, period_date, value, updated_at) VALUES (%s, %s, %s, NOW()) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()",
            (indicator_id, period_date, value)
        )
        return True
    except Exception as e:
        logger.error(f"插入指标 {indicator_id} 日期 {period_date} 失败: {e}")
        return False


def parse_gdp_date(s: str) -> Optional[str]:
    s = s.strip().replace('\u3000', '')
    if '第' in s and '季' in s:
        parts = s.split('第')
        year = parts[0].replace('年', '')
        q = parts[1].replace('季度', '').replace('季', '').replace('1-4', '4').replace('1-3', '3').replace('1-2', '2')
        q_num = int(YEAR_MAP.get(q, q))
        month = str(q_num * 3).zfill(2)
        return f"{year}-{month}-01"
    return None


def parse_cn_month(s: str) -> Optional[str]:
    s = s.strip().replace('\u3000', '')
    s = s.replace('月份', '').replace('月', '')
    parts = s.split('年')
    if len(parts) == 2:
        return f"{parts[0]}-{parts[1].zfill(2)}-01"
    return None


def sync_gdp(conn, indicator_id: int) -> int:
    logger.info("  GDP 同步中...")
    try:
        df = ak.macro_china_gdp()
        count = 0
        cur = conn.cursor()
        for _, row in df.iterrows():
            d = parse_gdp_date(str(row.iloc[0]))
            v = safe_decimal(row.iloc[1])
            if d and v and upsert_indicator_data_safe(cur, indicator_id, d, v):
                count += 1
        conn.commit()
        logger.info(f"    GDP: {count} records")
        return count
    except Exception as e:
        logger.error(f"  GDP 同步失败: {e}")
        return 0


def sync_cpi(conn, indicator_id: int) -> int:
    logger.info("  CPI 同步中...")
    try:
        df = ak.macro_china_cpi_yearly()
        count = 0
        cur = conn.cursor()
        for _, row in df.iterrows():
            d = row.iloc[1]
            if isinstance(d, (datetime, date)):
                d = d.strftime('%Y-%m-%d')
            else:
                continue
            v = safe_decimal(row.iloc[2])
            if v and upsert_indicator_data_safe(cur, indicator_id, d, v):
                count += 1
        conn.commit()
        logger.info(f"    CPI: {count} records")
        return count
    except Exception as e:
        logger.error(f"  CPI 同步失败: {e}")
        return 0


def sync_ppi(conn, indicator_id: int) -> int:
    logger.info("  PPI 同步中...")
    try:
        df = ak.macro_china_ppi_yearly()
        count = 0
        cur = conn.cursor()
        for _, row in df.iterrows():
            d = row.iloc[1]
            if isinstance(d, (datetime, date)):
                d = d.strftime('%Y-%m-%d')
            else:
                continue
            v = safe_decimal(row.iloc[2])
            if v and upsert_indicator_data_safe(cur, indicator_id, d, v):
                count += 1
        conn.commit()
        logger.info(f"    PPI: {count} records")
        return count
    except Exception as e:
        logger.error(f"  PPI 同步失败: {e}")
        return 0


def sync_pmi(conn, indicator_id: int) -> int:
    logger.info("  PMI 同步中...")
    try:
        df = ak.macro_china_pmi()
        count = 0
        cur = conn.cursor()
        for _, row in df.iterrows():
            d = parse_cn_month(str(row.iloc[0]))
            v = safe_decimal(row.iloc[1])
            if d and v and upsert_indicator_data_safe(cur, indicator_id, d, v):
                count += 1
        conn.commit()
        logger.info(f"    PMI: {count} records")
        return count
    except Exception as e:
        logger.error(f"  PMI 同步失败: {e}")
        return 0


def sync_retail(conn, indicator_id: int) -> int:
    logger.info("  零售同步中...")
    try:
        df = ak.macro_china_consumer_goods_retail()
        count = 0
        cur = conn.cursor()
        for _, row in df.iterrows():
            d = parse_cn_month(str(row.iloc[0]))
            v = safe_decimal(row.iloc[1])
            if d and v and upsert_indicator_data_safe(cur, indicator_id, d, v):
                count += 1
        conn.commit()
        logger.info(f"    零售: {count} records")
        return count
    except Exception as e:
        logger.error(f"  零售同步失败: {e}")
        return 0


def main():
    conn = None
    try:
        conn = get_conn()
        indicators = get_cn_indicators()
        logger.info(f"共 {len(indicators)} 个中国指标")

        total = 0
        for ind in indicators:
            code = ind['code']
            fetcher = {
                'GDP': lambda c, i: sync_gdp(c, i),
                'CPI': lambda c, i: sync_cpi(c, i),
                'PPI': lambda c, i: sync_ppi(c, i),
                'PMI': lambda c, i: sync_pmi(c, i),
                'RETAIL': lambda c, i: sync_retail(c, i),
            }.get(code)

            if not fetcher:
                logger.warning(f"  跳过 {code}")
                continue

            try:
                count = fetcher(conn, ind['id'])
                total += count
            except Exception as e:
                logger.error(f"  {code} 失败: {e}")

        logger.info(f"同步完成，共 {total} 条数据")
        log_sync("indicator_data", "success", total, f"同步了 {len(indicators)} 个中国指标")
    except Exception as e:
        logger.error(f"中国经济数据同步失败: {e}")
        log_sync("indicator_data", "failed", 0, str(e))
        raise
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    main()

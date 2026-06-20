#!/usr/bin/env python3
"""
同步美股价格 (Yahoo Finance) + 经济指标 (FRED)
用法: python3 sync_assets_indicators.py
"""

import sys
import os
import time
import logging
from datetime import datetime, date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Dict, Any

import pymysql
import requests
import yfinance as yf

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
logger = logging.getLogger("sync_assets_indicators")

DB_HOST = os.environ.get("DB_HOST", "204.44.121.43")
DB_PORT = int(os.environ.get("DB_PORT", "3306"))
DB_USER = os.environ.get("DB_USER", "mnigc")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "woaiyinyue.4")
DB_NAME = os.environ.get("DB_NAME", "invest_platform")
FRED_API_KEY = os.environ.get("FRED_API_KEY", "671a9677b4cd70b6e85452f33a2c54ab")
YAHOO_DELAY = 2.0
FRED_DELAY = 0.3

FRED_SERIES_MAP = {
    "GDP": "GDP", "CPI": "CPIAUCSL", "PPI": "PPIACO", "UNRATE": "UNRATE",
    "FEDFUNDS": "FEDFUNDS", "DGS10": "DGS10", "VIXCLS": "VIXCLS",
    "DEXUSEU": "DEXUSEU", "PCE": "PCE", "UMCSENT": "UMCSENT", "RSXFS": "RSXFS",
    # Sprint 2: 债券市场 & 宏观风险
    "DFII10": "DFII10", "T5YIE": "T5YIE", "T10YIE": "T10YIE",
    "CFNAI": "CFNAI", "BAMLC0A4CBBB": "BAMLC0A4CBBB",
    # 收益率曲线各期限
    "DGS1MO": "DGS1MO", "DGS3MO": "DGS3MO", "DGS6MO": "DGS6MO",
    "DGS1": "DGS1", "DGS2": "DGS2", "DGS3": "DGS3",
    "DGS5": "DGS5", "DGS7": "DGS7", "DGS20": "DGS20", "DGS30": "DGS30",
}


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


def upsert_asset_snapshot(asset_id, last_price, change_percent, volume=None):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO asset_snapshots (asset_id, last_price, change_percent, volume, updated_at) VALUES (%s, %s, %s, %s, NOW()) ON DUPLICATE KEY UPDATE last_price=VALUES(last_price), change_percent=VALUES(change_percent), volume=VALUES(volume), updated_at=NOW()",
                (asset_id, last_price, change_percent, volume)
            )
            conn.commit()
    finally:
        conn.close()


def upsert_indicator_data(indicator_id, period_date, value):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO indicator_data (indicator_id, period_date, value, updated_at) VALUES (%s, %s, %s, NOW()) ON DUPLICATE KEY UPDATE value=VALUES(value), updated_at=NOW()",
                (indicator_id, period_date, value)
            )
            conn.commit()
    finally:
        conn.close()


def get_assets():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol, name_zh, sub_category FROM assets WHERE is_active = TRUE")
            return cur.fetchall()
    finally:
        conn.close()


def get_indicators(source=None):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if source:
                cur.execute("SELECT id, code, name_zh, name_en, category, sub_category, unit, frequency, source FROM indicators WHERE is_active = TRUE AND source = %s ORDER BY category, sub_category, id", (source,))
            else:
                cur.execute("SELECT id, code, name_zh, name_en, category, sub_category, unit, frequency, source FROM indicators WHERE is_active = TRUE ORDER BY category, sub_category, id")
            return cur.fetchall()
    finally:
        conn.close()


def get_last_sync_date(indicator_id):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(period_date) as max_date FROM indicator_data WHERE indicator_id = %s", (indicator_id,))
            result = cur.fetchone()
            if result and result["max_date"]:
                if isinstance(result["max_date"], (datetime, date)):
                    return result["max_date"].strftime("%Y-%m-%d")
                return result["max_date"]
            return None
    finally:
        conn.close()


def fetch_yahoo_price(symbol: str) -> Optional[Dict[str, Any]]:
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="2d")
        if hist.empty:
            return None

        close_vals = hist["Close"].dropna()
        if len(close_vals) < 1:
            return None

        current = Decimal(str(close_vals.iloc[-1])).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        prev = Decimal(str(close_vals.iloc[-2])).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP) if len(close_vals) >= 2 else None

        change_pct = None
        if prev and prev > 0:
            change_pct = (current / prev) - Decimal("1")
            change_pct = change_pct.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)

        vol_series = hist["Volume"].dropna()
        volume = int(vol_series.iloc[-1]) if len(vol_series) > 0 else None
        trade_date = hist.index[-1].strftime("%Y-%m-%d")

        return {"price": current, "change_pct": change_pct, "prev_close": prev, "volume": volume, "trade_date": trade_date}
    except Exception as e:
        logger.warning(f"  yfinance {symbol} 失败: {e}")
        return None


def sync_assets():
    logger.info("=" * 50)
    logger.info("开始同步资产价格 (Yahoo Finance)")
    assets = get_assets()
    logger.info(f"数据库中有 {len(assets)} 个活跃资产")

    synced = skipped = 0
    errors = []

    for asset in assets:
        symbol = asset["symbol"]
        try:
            data = fetch_yahoo_price(symbol)
            if not data:
                skipped += 1
                continue
            upsert_asset_snapshot(asset["id"], data["price"], data["change_pct"], data.get("volume"))
            synced += 1
            logger.info(f"  {symbol} ({asset['name_zh']}): {data['price']}")
        except Exception as e:
            err = f"{symbol}: {e}"
            errors.append(err)
            logger.warning(f"  {err}")
        time.sleep(YAHOO_DELAY)

    msg = f"成功 {synced}, 跳过 {skipped}, 失败 {len(errors)}"
    if errors:
        msg += f"; 前3条错误: {'; '.join(errors[:3])}"
    log_sync("asset_snapshot", "success" if synced > 0 else "partial", synced, msg)
    logger.info(msg)
    logger.info("资产价格同步完成")


def fetch_fred_series(indicator_id: int, series_id: str, frequency: str) -> int:
    last_date = get_last_sync_date(indicator_id)

    params = {"series_id": series_id, "api_key": FRED_API_KEY, "file_type": "json", "sort_order": "asc"}
    if last_date:
        start = (datetime.strptime(last_date, "%Y-%m-%d") - timedelta(days=90)).strftime("%Y-%m-%d")
        params["observation_start"] = start

    url = "https://api.stlouisfed.org/fred/series/observations"
    try:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.error(f"FRED 请求失败 {series_id}: {e}")
        raise

    observations = data.get("observations", [])
    if not observations:
        return 0

    inserted = 0
    for obs in observations:
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
        upsert_indicator_data(indicator_id, period, val)
        inserted += 1
    return inserted


def sync_indicators():
    if not FRED_API_KEY:
        logger.warning("=" * 50)
        logger.warning("跳过 FRED 同步：未设置 FRED_API_KEY")
        logger.warning("免费申请地址：https://fred.stlouisfed.org/docs/api/api_key.html")
        return

    logger.info("=" * 50)
    logger.info("开始同步宏观经济数据 (FRED)")
    indicators = get_indicators("FRED")
    logger.info(f"数据库中有 {len(indicators)} 个 FRED 指标")

    synced = 0
    for ind in indicators:
        code = ind["code"]
        if code not in FRED_SERIES_MAP:
            logger.warning(f"  {code} ({ind['name_zh']}): 跳过，FRED 无此数据源")
            continue
        series_id = FRED_SERIES_MAP[code]
        try:
            count = fetch_fred_series(ind["id"], series_id, ind["frequency"])
            synced += count
            logger.info(f"  {code} ({ind['name_zh']}): 新增/更新 {count} 条")
        except Exception as e:
            logger.warning(f"  {code}: {e}")
        time.sleep(FRED_DELAY)

    log_sync("indicator_data", "success", synced, f"同步了 {len(indicators)} 个指标")
    logger.info(f"宏观经济同步完成，共 {synced} 条数据")


if __name__ == "__main__":
    logger.info("=== 开始同步：美股 + 经济指标 ===")
    sync_assets()
    sync_indicators()
    logger.info("=== 全部完成 ===")

#!/usr/bin/env python3
"""同步美国资产快照（美股指数 / ETF / 商品 / 外汇）。
数据源: Yahoo Finance (yfinance)
写入表: asset_snapshots, data_sync_logs
用法:
    python3 fetch_us_assets.py
"""
import time
from decimal import Decimal

import yfinance as yf

from sync_base import _setup_logger, get_conn, write_sync_log, with_retry


MAX_RETRY = 4
TIMEOUT = 30
SLEEP_BETWEEN = 2.0

log = _setup_logger("fetch_us_assets")


def _yf_fetch_one(symbol):
    t = yf.Ticker(symbol)
    hist = t.history(period="5d")
    if hist is None or hist.empty:
        return None
    closes = hist["Close"].dropna()
    if closes is None or closes.empty or len(closes) < 1:
        return None
    current = Decimal(str(closes.iloc[-1])).quantize(Decimal("0.000001"))
    prev = (Decimal(str(closes.iloc[-2])).quantize(Decimal("0.000001"))
            if len(closes) >= 2 else None)
    change_pct = None
    if prev and prev > 0:
        change_pct = (current / prev - Decimal("1")).quantize(Decimal("0.000001"))
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
            data = with_retry(_yf_fetch_one, symbol, timeout=TIMEOUT, max_retry=MAX_RETRY)
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

#!/usr/bin/env python3
"""同步标普 500 市盈率 (Trailing PE)。
数据源: Yahoo Finance (SPX = ^GSPC 的 info.trailingPE)
写入表: indicator_data (指标 code = SP500_PE), data_sync_logs
用法:
    python3 fetch_us_market_pe.py
"""
from datetime import date
from decimal import Decimal

import yfinance as yf

from sync_base import _setup_logger, get_conn, write_sync_log, with_retry


MAX_RETRY = 4
TIMEOUT = 30
SPX_SYMBOL = "^GSPC"

log = _setup_logger("fetch_us_market_pe")


def main():
    log.info("=" * 60)
    log.info("开始同步 S&P 500 Trailing PE")

    indicator_id = None
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM indicators WHERE code = %s AND is_active = 1 LIMIT 1",
                    ("SP500_PE",),
                )
                row = cur.fetchone() or {}
                indicator_id = row.get("id")
    except Exception as e:
        log.error("读取 indicators 表失败: %s", e)
        write_sync_log("indicator_data", "failed", 0, "read indicators: " + str(e))
        return

    if not indicator_id:
        log.warning("未找到 SP500_PE 指标，请先在 indicators 表插入该指标")
        write_sync_log("indicator_data", "failed", 0, "SP500_PE indicator missing")
        return
    log.info("indicator id=%s", indicator_id)

    def _fetch_pe():
        t = yf.Ticker(SPX_SYMBOL)
        info = t.info
        if info:
            for key in ["trailingPE", "forwardPE"]:
                val = info.get(key)
                if val is not None:
                    return val
        return None

    try:
        trailing_pe = with_retry(_fetch_pe, timeout=TIMEOUT, max_retry=MAX_RETRY)
    except Exception as e:
        log.warning("抓取失败: %s", e)
        write_sync_log("indicator_data", "failed", 0, "fetch: " + str(e))
        return

    if trailing_pe is None:
        log.warning("Yahoo 未返回 trailingPE 或 forwardPE")
        write_sync_log("indicator_data", "failed", 0, "no PE data returned")
        return

    try:
        val = Decimal(str(trailing_pe)).quantize(Decimal("0.000001"))
    except Exception as e:
        log.warning("数值转换失败: %s (原始值=%s)", e, trailing_pe)
        write_sync_log("indicator_data", "failed", 0, "parse: " + str(e))
        return

    today = date.today().strftime("%Y-%m-%d")
    log.info("S&P 500 PE @ %s = %s", today, val)

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO indicator_data (indicator_id, period_date, value, updated_at) "
                    "VALUES (%s, %s, %s, NOW()) "
                    "ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()",
                    (indicator_id, today, val),
                )
            conn.commit()
        log.info("写入成功")
        write_sync_log("indicator_data", "success", 1, "SP500_PE = %s" % val)
    except Exception as e:
        log.warning("写入失败: %s", e)
        write_sync_log("indicator_data", "failed", 0, "write: " + str(e))


if __name__ == "__main__":
    main()

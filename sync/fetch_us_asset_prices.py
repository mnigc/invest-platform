#!/usr/bin/env python3
"""同步美股核心资产历史日线价格。
当前目标: S&P 500 (^GSPC), 用于市场制式回测。
数据源: Yahoo Finance (yfinance)
写入表: asset_prices, data_sync_logs
用法:
    python3 fetch_us_asset_prices.py
"""
import time

import yfinance as yf

from sync_base import _setup_logger, get_conn, write_sync_log, with_retry


MAX_RETRY = 4
TIMEOUT = 60
START_DATE = "2010-01-01"

TARGETS = [
    ("^GSPC", "S&P 500"),
]

log = _setup_logger("fetch_us_asset_prices")


def init_table(conn):
    sql = """
    CREATE TABLE IF NOT EXISTS asset_prices (
        id BIGSERIAL PRIMARY KEY,
        asset_id BIGINT NOT NULL,
        trade_date DATE NOT NULL,
        close_price NUMERIC(18, 6) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT uk_asset_date UNIQUE (asset_id, trade_date)
    )
    """
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()


def fetch_history(symbol):
    def _download():
        return yf.download(
            symbol,
            start=START_DATE,
            progress=False,
            auto_adjust=False,
            prepost=False,
        )

    df = with_retry(_download, timeout=TIMEOUT, max_retry=MAX_RETRY)
    if df is None or df.empty:
        return []
    df = df.reset_index()

    close_col = "Close"
    if close_col not in df.columns:
        close_col = next((c for c in df.columns if isinstance(c, tuple) and "Close" in c), None)
    if close_col is None:
        raise RuntimeError("未找到 Close 列: %s" % list(df.columns))

    rows = []
    for _, row in df.iterrows():
        date = row["Date"]
        if hasattr(date, "to_pydatetime"):
            date = date.to_pydatetime().strftime("%Y-%m-%d")
        else:
            date = str(date)[:10]
        close = row[close_col]
        try:
            close_val = float(close)
            if close_val > 0:
                rows.append((date, close_val))
        except Exception:
            continue
    return rows


def sync_symbol(conn, symbol, desc):
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM assets WHERE symbol = %s", (symbol,))
        row = cur.fetchone()
    if not row:
        log.warning("未在 assets 表中找到 %s，跳过", symbol)
        return 0

    asset_id = row["id"]
    log.info("开始同步 %s (%s) 历史日线...", desc, symbol)
    rows = fetch_history(symbol)
    if not rows:
        log.warning("未获取到 %s 数据", symbol)
        return 0

    inserted = 0
    with conn.cursor() as cur:
        for trade_date, close_price in rows:
            cur.execute(
                """
                INSERT INTO asset_prices (asset_id, trade_date, close_price)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE close_price = VALUES(close_price)
                """,
                (asset_id, trade_date, close_price),
            )
            inserted += cur.rowcount
    conn.commit()
    log.info("%s 写入完成: %d 条", symbol, inserted)
    return inserted


def main():
    log.info("=" * 60)
    log.info("开始同步美股核心资产历史日线")

    total = 0
    try:
        with get_conn() as conn:
            init_table(conn)
            for symbol, desc in TARGETS:
                try:
                    total += sync_symbol(conn, symbol, desc)
                    time.sleep(2)
                except Exception as e:
                    log.error("同步 %s 失败: %s", symbol, e)

        msg = "共写入 %d 条价格记录" % total
        log.info("同步完成: %s", msg)
        write_sync_log("us_asset_prices", "success", total, msg)
    except Exception as e:
        log.error("同步失败: %s", e)
        write_sync_log("us_asset_prices", "failed", total, str(e))
        raise


if __name__ == "__main__":
    main()

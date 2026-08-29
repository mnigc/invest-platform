#!/usr/bin/env python3
"""同步全球汇率数据（美元指数 DXY + 主要货币对）。
数据源: Yahoo Finance (yfinance)
写入表: asset_prices, asset_snapshots, data_sync_logs
用法:
    python3 fetch_forex.py
"""
import time

import pandas as pd
import yfinance as yf

from sync_base import _setup_logger, get_conn, write_sync_log, with_retry


MAX_RETRY = 4
TIMEOUT = 60
START_DATE = "2010-01-01"
SLEEP_BETWEEN = 2.0

FOREX_SYMBOLS = [
    ("DX-Y.NYB", "美元指数", "USD"),
    ("EURUSD=X", "欧元/美元", "EUR"),
    ("USDJPY=X", "美元/日元", "JPY"),
    ("GBPUSD=X", "英镑/美元", "GBP"),
    ("USDCNH=X", "美元/离岸人民币", "CNH"),
    ("USDCHF=X", "美元/瑞郎", "CHF"),
    ("AUDUSD=X", "澳元/美元", "AUD"),
    ("USDCAD=X", "美元/加元", "CAD"),
    ("KRW=X", "美元/韩元", "KRW"),
]

log = _setup_logger("fetch_forex")


def ensure_assets(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM asset_categories WHERE code = 'fx'")
        row = cur.fetchone()
        if not row:
            cur.execute(
                "INSERT INTO asset_categories (code, name_zh, name_en, sort_order) VALUES (%s, %s, %s, %s)",
                ("fx", "外汇", "Forex", 5),
            )
            conn.commit()
            fx_cat_id = cur.lastrowid
        else:
            fx_cat_id = row["id"]

    for symbol, name_zh, currency in FOREX_SYMBOLS:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM assets WHERE symbol = %s", (symbol,))
            row = cur.fetchone()
            if not row:
                cur.execute(
                    "INSERT INTO assets (symbol, name_zh, name_en, category_id, sub_category, exchange, currency) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (symbol, name_zh, name_zh, fx_cat_id, "外汇", "FOREX", currency),
                )
                conn.commit()
                log.info("注册新资产: %s (%s)", symbol, name_zh)


def _normalize_df(df):
    OHLCV_KEYWORDS = {'open', 'high', 'low', 'close', 'adj close', 'adjclose', 'volume'}
    if isinstance(df.columns, pd.MultiIndex):
        best_level = None
        best_score = 0
        for level_idx in range(len(df.columns[0])):
            level_names = {str(c[level_idx]).strip().lower() for c in df.columns}
            score = len(level_names & OHLCV_KEYWORDS)
            if score > best_score:
                best_score = score
                best_level = level_idx
        if best_level is not None:
            df.columns = [str(c[best_level]).strip() for c in df.columns]
        else:
            df.columns = [str(c[-1]).strip() for c in df.columns]

    col_names = [str(c).strip() for c in df.columns]
    if 'close' not in [c.lower() for c in col_names]:
        if len(df.columns) >= 4:
            df.columns = ['Open', 'High', 'Low', 'Close', 'Adj Close', 'Volume'][:len(df.columns)]

    return df


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

    df = _normalize_df(df)
    df = df.reset_index()

    date_col = None
    for c in df.columns:
        col_str = str(c).lower()
        if col_str == 'date' or col_str.startswith('date'):
            date_col = c
            break
    if date_col is None:
        date_col = df.columns[0]

    close_col = None
    for c in df.columns:
        col_str = str(c).lower()
        if col_str == 'close':
            close_col = c
            break
    if close_col is None:
        raise RuntimeError("未找到 Close 列: %s" % list(df.columns))

    rows = []
    for _, row in df.iterrows():
        try:
            date_val = row[date_col]
            if hasattr(date_val, 'to_pydatetime'):
                date = date_val.to_pydatetime().strftime('%Y-%m-%d')
            elif hasattr(date_val, 'strftime'):
                date = date_val.strftime('%Y-%m-%d')
            else:
                date = str(date_val)[:10]

            close_val = row[close_col]
            if hasattr(close_val, 'iloc'):
                close_val = float(close_val.iloc[0])
            else:
                close_val = float(close_val)

            if close_val > 0:
                rows.append((date, close_val))
        except Exception:
            continue
    return rows


def sync_history(conn, asset_id, symbol, desc):
    log.info("开始同步 %s (%s) 历史日线...", desc, symbol)
    rows = fetch_history(symbol)
    if not rows:
        log.warning("未获取到 %s 数据", symbol)
        return 0

    inserted = 0
    with conn.cursor() as cur:
        for trade_date, close_price in rows:
            cur.execute(
                "INSERT INTO asset_prices (asset_id, trade_date, close_price) "
                "VALUES (%s, %s, %s) "
                "ON DUPLICATE KEY UPDATE close_price = VALUES(close_price)",
                (asset_id, trade_date, close_price),
            )
            inserted += cur.rowcount
    conn.commit()
    log.info("%s 写入完成: %d 条", symbol, inserted)
    return inserted


def sync_snapshot(conn, asset_id, symbol, desc):
    try:
        t = yf.Ticker(symbol)
        hist = t.history(period="5d")
        if hist is None or hist.empty:
            return None

        hist = _normalize_df(hist)

        col_names = [str(c).strip().lower() for c in hist.columns]
        if 'close' not in col_names:
            if len(hist.columns) >= 4:
                hist.columns = ['Open', 'High', 'Low', 'Close', 'Adj Close', 'Volume'][:len(hist.columns)]
            else:
                hist.columns = ['Close'] * len(hist.columns)

        closes = hist["Close"].dropna()
        if len(closes) < 1:
            return None
        current = float(closes.iloc[-1])
        prev = float(closes.iloc[-2]) if len(closes) >= 2 else None
        change_pct = None
        if prev and prev > 0:
            change_pct = (current / prev - 1) * 100

        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO asset_snapshots (asset_id, last_price, change_percent, volume, updated_at) "
                "VALUES (%s, %s, %s, 0, NOW()) "
                "ON DUPLICATE KEY UPDATE "
                "last_price = VALUES(last_price), change_percent = VALUES(change_percent), "
                "updated_at = NOW()",
                (asset_id, current, change_pct),
            )
        conn.commit()
        log.info("%s 快照: price=%s, change=%.4f%%", symbol, current, change_pct or 0)
        return current
    except Exception as e:
        log.warning("%s 快照失败: %s", symbol, e)
        return None


def main():
    log.info("=" * 60)
    log.info("开始同步全球汇率数据")

    total = 0
    try:
        with get_conn() as conn:
            ensure_assets(conn)

            with conn.cursor() as cur:
                cur.execute(
                    "SELECT a.id, a.symbol, a.name_zh FROM assets a "
                    "JOIN asset_categories c ON c.id = a.category_id "
                    "WHERE c.code = 'fx' AND a.is_active = 1 ORDER BY a.symbol"
                )
                assets = cur.fetchall()

            if not assets:
                log.warning("未找到汇率资产，请先运行 ensure_assets")
                return

            for asset in assets:
                try:
                    total += sync_history(conn, asset["id"], asset["symbol"], asset["name_zh"])
                    time.sleep(SLEEP_BETWEEN)
                except Exception as e:
                    log.error("同步 %s 失败: %s", asset["symbol"], e)

            for asset in assets:
                try:
                    sync_snapshot(conn, asset["id"], asset["symbol"], asset["name_zh"])
                    time.sleep(SLEEP_BETWEEN)
                except Exception as e:
                    log.error("快照 %s 失败: %s", asset["symbol"], e)

        msg = "共写入 %d 条价格记录" % total
        log.info("同步完成: %s", msg)
        write_sync_log("forex", "success", total, msg)
    except Exception as e:
        log.error("同步失败: %s", e)
        write_sync_log("forex", "failed", total, str(e))
        raise


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""同步中国市场指数日线（主要指数 / 风格指数）。
数据源: 优先 Yahoo Finance，失败兜底 akshare(东方财富)。
写入表: index_daily, data_sync_logs
用法:
    python3 fetch_cn_indices.py           # 默认补最近 90 天的数据
    python3 fetch_cn_indices.py --daily   # 只补最近 7 天（日常跑快一些）
    python3 fetch_cn_indices.py --full    # 全量同步（从2019年开始，用于首次同步或补全历史数据）
"""
import sys
import time
from datetime import date, timedelta
from decimal import Decimal

import pandas as pd
import yfinance as yf

from sync_base import _setup_logger, get_conn, write_sync_log, with_retry, patch_cn_proxy, safe_dec, safe_int


patch_cn_proxy()


MAX_RETRY = 4
TIMEOUT = 30
SLEEP_YAHOO = 1.5
SLEEP_AKSHARE = 3.0

MAIN_INDICES = [
    ("000001", "上证指数", "main", "000001.SS"),
    ("000016", "上证50", "main", "000016.SS"),
    ("000300", "沪深300", "main", "000300.SS"),
    ("000852", "中证1000", "main", "000852.SS"),
    ("000688", "科创50", "main", "000688.SS"),
    ("399001", "深证成指", "main", "399001.SZ"),
    ("399006", "创业板指", "main", "399006.SZ"),
]

log = _setup_logger("fetch_cn_indices")


def _yf_history(yf_symbol, start_date, end_date):
    t = yf.Ticker(yf_symbol)
    hist = t.history(start=start_date, end=end_date, auto_adjust=False)
    return hist


def _ak_em_history(code, start_date, end_date):
    import akshare as ak
    df = ak.index_zh_a_hist(symbol=code, period="daily", start_date=start_date, end_date=end_date)
    return df


def rows_from_yf(hist, code, name, cat):
    if hist is None or hist.empty:
        return []
    rows = []
    closes = hist["Close"].astype(float)
    pct = closes.pct_change(fill_method=None) * 100.0
    for idx, (ts, row) in enumerate(hist.iterrows()):
        close_price = safe_dec(row.get("Close"), 4)
        if close_price is None:
            continue
        try:
            trade_date = ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else str(ts)[:10]
        except Exception:
            trade_date = str(ts)[:10]
        rows.append((
            code, name, cat, trade_date,
            safe_dec(row.get("Open"), 4),
            safe_dec(row.get("High"), 4),
            safe_dec(row.get("Low"), 4),
            close_price,
            safe_int(row.get("Volume")),
            None,
            safe_dec(pct.iloc[idx], 4) if idx else safe_dec(0.0, 4),
            None,
        ))
    return rows


def rows_from_ak(df, code, name, cat):
    if df is None or df.empty:
        return []
    rows = []
    for _, row in df.iterrows():
        try:
            cell = row.get("日期") if "日期" in df.columns else row.iloc[0]
            trade_date = str(cell)[:10]
            if len(trade_date) == 8 and trade_date.isdigit():
                trade_date = "%s-%s-%s" % (trade_date[:4], trade_date[4:6], trade_date[6:8])
        except Exception:
            continue
        close_price = safe_dec(row.get("收盘"), 4)
        if close_price is None:
            continue
        if "涨跌幅" in df.columns:
            change = row.get("涨跌幅")
        elif "涨跌幅(%)" in df.columns:
            change = row.get("涨跌幅(%)")
        else:
            change = None
        if change is not None:
            try:
                change_val = Decimal(str(float(change)) / 100.0).quantize(Decimal("0.000001"))
            except Exception:
                change_val = None
        else:
            change_val = None
        rows.append((
            code, name, cat, trade_date,
            safe_dec(row.get("开盘"), 4),
            safe_dec(row.get("最高"), 4),
            safe_dec(row.get("最低"), 4),
            close_price,
            safe_int(row.get("成交量")),
            safe_dec(row.get("成交额"), 2) if "成交额" in df.columns else None,
            change_val,
            None,
        ))
    return rows


def upsert_rows(rows):
    if not rows:
        return 0
    sql = (
        "INSERT INTO index_daily (index_code, index_name, category, trade_date, open_price, high_price, low_price, close_price, volume, amount, change_pct, turnover_rate) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
        "ON DUPLICATE KEY UPDATE "
        "open_price=VALUES(open_price), high_price=VALUES(high_price), low_price=VALUES(low_price), "
        "close_price=VALUES(close_price), volume=VALUES(volume), amount=VALUES(amount), "
        "change_pct=VALUES(change_pct), turnover_rate=VALUES(turnover_rate)"
    )
    total = 0
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.executemany(sql, rows)
                total = cur.rowcount if cur.rowcount else len(rows)
            conn.commit()
    except Exception as e:
        log.warning("批量写入失败（退化为逐行写入）: %s", e)
        for r in rows:
            try:
                with get_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(sql, r)
                    conn.commit()
                    total += 1
            except Exception as e2:
                log.warning("  写入 %s %s 失败: %s", r[0], r[3], e2)
    return total


def main():
    log.info("=" * 60)

    daily = "--daily" in sys.argv
    full = "--full" in sys.argv
    today = date.today()
    if full:
        start = date(2019, 1, 1)
        log.info("全量同步中国指数日线 (%s ~ %s)", start, today)
    else:
        start = today - timedelta(days=7 if daily else 90)
        log.info("开始同步中国指数日线 (%s ~ %s)", start, today)

    total = 0
    errors = []

    for code, name, cat, yf_sym in MAIN_INDICES:
        rows = []
        yf_rows = []
        ak_rows = []
        source = "none"

        try:
            hist = with_retry(
                _yf_history, yf_sym, start.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d"),
                timeout=TIMEOUT, max_retry=MAX_RETRY,
            )
            yf_rows = rows_from_yf(hist, code, name, cat)
            log.info("%s (%s) Yahoo 返回 %d 行", code, name, len(yf_rows))
        except Exception as e:
            log.warning("%s (%s) Yahoo 失败: %s", code, name, e)

        if len(yf_rows) < 2:
            log.info("%s (%s) Yahoo 数据不足 (%d 行)，改用 akshare(东财) 兜底", code, name, len(yf_rows))
            try:
                hist2 = with_retry(
                    _ak_em_history, code,
                    start.strftime("%Y%m%d"), today.strftime("%Y%m%d"),
                    timeout=TIMEOUT, max_retry=MAX_RETRY,
                )
                ak_rows = rows_from_ak(hist2, code, name, cat)
                log.info("%s (%s) akshare 返回 %d 行", code, name, len(ak_rows))
            except Exception as e:
                log.warning("%s (%s) akshare 也失败: %s", code, name, e)

        rows = ak_rows if len(ak_rows) >= len(yf_rows) else yf_rows
        if rows:
            source = "akshare" if rows is ak_rows else "yahoo"

        if rows:
            n = upsert_rows(rows)
            total += n
            log.info("%s (%s) 使用 %s 写入 %d 行", code, name, source, n)
        else:
            log.warning("%s (%s) 最终无数据", code, name)
            errors.append("%s: no data" % code)
        time.sleep(SLEEP_YAHOO)

    if errors and total > 0:
        status = "partial"
    elif total > 0:
        status = "success"
    else:
        status = "failed"
    msg = "共写入 %d 行；失败 %d 个；前 5 条: %s" % (total, len(errors), "; ".join(errors[:5]))
    log.info(msg)
    write_sync_log("index_daily", status, total, msg)


if __name__ == "__main__":
    main()

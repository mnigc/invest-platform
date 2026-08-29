#!/usr/bin/env python3
"""展示模块：国家队资金（/tracking/etf-flow，同时供组合信号板资金流信号卡）

页面需要两块数据：
  1. ETF 日线行情 + 交易所份额 -> 净申赎、申赎/成交额比率（宽基资金流）
  2. 沪深300 日线（index_daily）-> 大额申赎后的事件研究基准
     （/api/v1/etf-flow/event-study.json 要求至少 40 个交易日的配对数据）

数据源:
    - ETF 行情: akshare fund_etf_hist_em (东财)
    - 上交所份额: akshare fund_etf_scale_sse(单日)
    - 深交所份额: akshare fund_scale_daily_szse(区间,<=6个月)
    - 拆分折算: akshare fund_cf_em(用于剔除假申赎)
    - 沪深300: Yahoo Finance 优先，akshare 兜底
写入表: etf_master, etf_daily, etf_shares, index_daily, data_sync_logs
用法:
    python3 sync_etf_flow.py --daily            # 只补最近几天(日常任务)
    python3 sync_etf_flow.py --full [--since 20230101]  # 回补历史
    python3 sync_etf_flow.py --init             # 建表
"""
import sys
import time
import argparse
from datetime import date, datetime, timedelta

import yfinance as yf

from sync_base import (_setup_logger, get_conn, write_sync_log, with_retry,
                       patch_cn_proxy, safe_dec, safe_int, bulk_upsert)

patch_cn_proxy()

log = _setup_logger("sync_etf_flow")

SLEEP = 0.6
SHARE_BACKFILL_LIMIT_DAYS = 720  # 上交所份额逐日回补上限(交易日)

# 事件研究基准指数（/api/v1/etf-flow/event-study.json 读取 index_daily 的 000300）
BENCHMARK_INDEX = ("000300", "沪深300", "main", "000300.SS")
INDEX_START = "2019-01-01"

# code, name, exchange, track_index, category
ETF_LIST = [
    ("510300", "沪深300ETF华泰柏瑞", "SH", "沪深300", "broad"),
    ("510310", "沪深300ETF易方达", "SH", "沪深300", "broad"),
    ("510330", "沪深300ETF华夏", "SH", "沪深300", "broad"),
    ("159919", "沪深300ETF嘉实", "SZ", "沪深300", "broad"),
    ("510050", "上证50ETF华夏", "SH", "上证50", "broad"),
    ("510500", "中证500ETF南方", "SH", "中证500", "broad"),
    ("159922", "中证500ETF嘉实", "SZ", "中证500", "broad"),
    ("512100", "中证1000ETF南方", "SH", "中证1000", "broad"),
    ("159845", "中证1000ETF汇添富", "SZ", "中证1000", "broad"),
    ("560010", "中证1000ETF易方达", "SH", "中证1000", "broad"),
    ("588000", "科创50ETF华夏", "SH", "科创50", "broad"),
    ("588080", "科创板50ETF易方达", "SH", "科创50", "broad"),
    ("159915", "创业板ETF易方达", "SZ", "创业板指", "broad"),
    ("159952", "创业板ETF广发", "SZ", "创业板指", "broad"),
    ("563360", "中证A500ETF国泰", "SH", "中证A500", "broad"),
    ("159338", "中证A500ETF嘉实", "SZ", "中证A500", "broad"),
    ("510880", "红利ETF", "SH", "上证红利", "broad"),
    ("515180", "红利低波50ETF", "SH", "红利低波", "broad"),
    ("159905", "深红利ETF", "SZ", "深证红利", "broad"),
    ("512760", "半导体ETF国泰", "SH", "国证半导体芯片", "sector"),
    ("512480", "半导体ETF联安", "SH", "中华半导体芯片", "sector"),
    ("515030", "新能源车ETF", "SH", "新能源汽车", "sector"),
    ("515790", "光伏ETF", "SH", "中证光伏产业", "sector"),
    ("512690", "酒ETF", "SH", "中证酒", "sector"),
    ("515170", "食品饮料ETF", "SH", "中证食品饮料", "sector"),
    ("512010", "医药ETF", "SH", "沪深300医药卫生", "sector"),
    ("159928", "消费ETF", "SZ", "中证主要消费", "sector"),
    ("512800", "银行ETF", "SH", "中证银行", "sector"),
    ("512000", "券商ETF", "SH", "中证全指证券公司", "sector"),
    ("512660", "军工ETF", "SH", "中证军工", "sector"),
    ("512400", "有色金属ETF", "SH", "中证有色金属", "sector"),
    ("513100", "纳指ETF", "SH", "纳斯达克100", "cross"),
    ("513500", "标普500ETF", "SH", "标普500", "cross"),
]

DDL = [
    """CREATE TABLE IF NOT EXISTS etf_master (
        code VARCHAR(10) PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        exchange VARCHAR(4) NOT NULL,
        track_index VARCHAR(60),
        category VARCHAR(20) DEFAULT 'broad',
        is_active SMALLINT DEFAULT 1,
        updated_at TIMESTAMPTZ DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS etf_daily (
        code VARCHAR(10) NOT NULL,
        trade_date DATE NOT NULL,
        open NUMERIC(12,4), high NUMERIC(12,4), low NUMERIC(12,4),
        close NUMERIC(12,4), volume NUMERIC(20,2), amount NUMERIC(20,2),
        turnover NUMERIC(10,4), change_pct NUMERIC(10,4),
        CONSTRAINT uk_etf_daily UNIQUE (code, trade_date)
    )""",
    """CREATE TABLE IF NOT EXISTS etf_shares (
        code VARCHAR(10) NOT NULL,
        trade_date DATE NOT NULL,
        shares_10k NUMERIC(20,4) NOT NULL,
        is_converted SMALLINT DEFAULT 0,
        CONSTRAINT uk_etf_shares UNIQUE (code, trade_date)
    )""",
    """CREATE TABLE IF NOT EXISTS index_daily (
        id BIGSERIAL PRIMARY KEY,
        index_code VARCHAR(20) NOT NULL,
        index_name VARCHAR(60),
        category VARCHAR(20),
        trade_date DATE NOT NULL,
        open_price NUMERIC(12,4),
        high_price NUMERIC(12,4),
        low_price NUMERIC(12,4),
        close_price NUMERIC(12,4),
        volume NUMERIC(20,2),
        amount NUMERIC(20,2),
        change_pct NUMERIC(10,6),
        turnover_rate NUMERIC(10,4),
        updated_at TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT uk_index_daily UNIQUE (index_code, trade_date)
    )""",
]


def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            for ddl in DDL:
                cur.execute(ddl)
            cur.execute("DELETE FROM etf_master")
            for code, name, exch, idx, cat in ETF_LIST:
                cur.execute(
                    "INSERT INTO etf_master (code, name, exchange, track_index, category) VALUES (%s,%s,%s,%s,%s)",
                    (code, name, exch, idx, cat),
                )
        conn.commit()
    log.info("etf_master 初始化完成: %d 只", len(ETF_LIST))


def fetch_quotes(code, start, end):
    """ETF 日线行情。返回 [(trade_date, open, high, low, close, volume, amount, turnover, change_pct)]"""
    import akshare as ak
    df = with_retry(
        ak.fund_etf_hist_em,
        symbol=code,
        period="daily",
        start_date=start.strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
        adjust="",
        timeout=45,
    )
    if df is None or df.empty:
        return []
    rows = []
    for _, r in df.iterrows():
        try:
            rows.append((
                str(r["日期"])[:10],
                safe_dec(r.get("开盘")), safe_dec(r.get("最高"), 4),
                safe_dec(r.get("最低"), 4), safe_dec(r.get("收盘"), 4),
                safe_dec(r.get("成交量"), 2), safe_dec(r.get("成交额"), 2),
                safe_dec(r.get("换手率"), 4), safe_dec(r.get("涨跌幅"), 4),
            ))
        except Exception as e:
            log.warning("[%s] 行情行解析失败: %s", code, e)
    return rows


def fetch_sse_shares(date_str):
    """上交所单日全市场 ETF 份额。返回 [(code, shares_10k, stat_date)]"""
    import akshare as ak
    df = with_retry(ak.fund_etf_scale_sse, date=date_str, timeout=60)
    if df is None or df.empty:
        return []
    out = []
    for _, r in df.iterrows():
        try:
            out.append((str(r["基金代码"]), safe_dec(r["基金份额"], 4), str(r["统计日期"])[:10]))
        except Exception:
            continue
    return out


def fetch_szse_shares(start, end):
    """深交所日频基金份额（区间,<=6个月）。返回 [(code, shares_10k, trade_date)]"""
    import akshare as ak
    df = with_retry(
        ak.fund_scale_daily_szse,
        start_date=start.strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
        symbol="ETF",
        timeout=60,
    )
    if df is None or df.empty:
        return []
    out = []
    for _, r in df.iterrows():
        try:
            out.append((str(r["基金代码"]), safe_dec(r["基金份额"], 4), str(r["日期"])[:10]))
        except Exception:
            continue
    return out


def fetch_conversions(year):
    """当年基金拆分折算列表。返回 {(code, date): factor 信息}"""
    import akshare as ak
    try:
        df = with_retry(ak.fund_cf_em, year=str(year), timeout=60)
    except Exception:
        return {}
    conv = {}
    if df is None or df.empty:
        return {}
    for _, r in df.iterrows():
        try:
            code = str(r["基金代码"])
            d = str(r["拆分折算日"])[:10]
            conv[(code, d)] = str(r.get("拆分类型", "")) + "/" + str(r.get("拆分折算", ""))
        except Exception:
            continue
    return conv


def trading_days_between(start, end, quotes_map):
    """利用某一 ETF 的行情日期近似交易日历（SH/SZ 日历一致）。"""
    days = set()
    for rows in quotes_map.values():
        for r in rows:
            days.add(r[0])
    return sorted([d for d in days if start.strftime("%Y-%m-%d") <= d <= end.strftime("%Y-%m-%d")])


def upsert_many(table, cols, rows):
    if not rows:
        return 0
    col_str = ", ".join(cols)
    ph = ", ".join(["%s"] * len(cols))
    upd = ", ".join([f"{c}=VALUES({c})" for c in cols if c not in ("code", "trade_date")])
    sql = f"INSERT INTO {table} ({col_str}) VALUES ({ph}) ON DUPLICATE KEY UPDATE {upd}"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, rows)
        conn.commit()
    return len(rows)


def sync_daily():
    today = date.today()
    q_start = today - timedelta(days=12)
    s_start = today - timedelta(days=10)
    total_quotes = total_shares = 0
    years = {today.year}
    conversions = {}
    for y in years:
        conversions.update(fetch_conversions(y))

    quotes_map = {}
    for code, name, exch, idx, cat in ETF_LIST:
        try:
            rows = fetch_quotes(code, q_start, today)
            quotes_map[code] = rows
            total_quotes += upsert_many("etf_daily", ["code","trade_date","open","high","low","close","volume","amount","turnover","change_pct"], rows)
            log.info("[%s %s] 行情 %d 条", code, name, len(rows))
        except Exception as e:
            log.warning("[%s] 行情失败: %s", code, e)
        time.sleep(SLEEP)

    # 份额：上交所逐日、深交所区间
    for code, name, exch, idx, cat in ETF_LIST:
        try:
            if exch == "SH":
                code_key = code
                rows = [(r[0], r[1], r[2]) for r in fetch_sse_shares(today.strftime("%Y%m%d")) if r[0] == code_key]
                share_rows = [(code, d, sh, 1 if (code, d) in conversions else 0) for (c, sh, d) in rows]
            else:
                rows = [(r[0], r[1], r[2]) for r in fetch_szse_shares(s_start, today) if r[0] == code]
                share_rows = [(code, d, sh, 1 if (code, d) in conversions else 0) for (c, sh, d) in rows]
            total_shares += upsert_many("etf_shares", ["code","trade_date","shares_10k","is_converted"], share_rows)
            log.info("[%s %s] 份额 %d 条", code, name, len(share_rows))
        except Exception as e:
            log.warning("[%s] 份额失败: %s", code, e)
        time.sleep(SLEEP)

    log.info("daily 完成: 行情 %d 条 / 份额 %d 条", total_quotes, total_shares)
    return total_quotes + total_shares


def sync_full(since_str):
    since = date(*map(int, since_str.split("-")))
    today = date.today()
    total_quotes = total_shares = 0

    years = {since.year + i for i in range(today.year - since.year + 1)}
    conversions = {}
    for y in years:
        conversions.update(fetch_conversions(y))
        time.sleep(SLEEP)

    quotes_map = {}
    for code, name, exch, idx, cat in ETF_LIST:
        try:
            rows = fetch_quotes(code, since, today)
            quotes_map[code] = rows
            total_quotes += upsert_many("etf_daily", ["code","trade_date","open","high","low","close","volume","amount","turnover","change_pct"], rows)
            log.info("[%s %s] 行情 %d 条", code, name, len(rows))
        except Exception as e:
            log.warning("[%s] 行情失败: %s", code, e)
        time.sleep(SLEEP)

    # 交易日历近似
    trade_days = trading_days_between(since, today, quotes_map)
    if not trade_days:
        log.warning("无交易日信息，份额回补跳过")
        return total_quotes

    # 上交所：逐日拉份额（近 SHARE_BACKFILL_LIMIT_DAYS 个交易日）
    sh_days = trade_days[-SHARE_BACKFILL_LIMIT_DAYS:]
    for d in sh_days:
        try:
            all_sse = fetch_sse_shares(d.replace("-", ""))
            share_rows = [(code, d, sh, 1 if (code, d) in conversions else 0)
                          for (code, sh, _s) in all_sse if code in {c for c, *_ in ETF_LIST}]
            total_shares += upsert_many("etf_shares", ["code","trade_date","shares_10k","is_converted"], share_rows)
        except Exception as e:
            log.warning("SSE %s 份额失败: %s", d, e)
        time.sleep(SLEEP)

    # 深交所：按 6 个月区间滚动拉取
    chunk = timedelta(days=175)
    cur = since
    while cur <= today:
        cur_end = min(cur + chunk, today)
        try:
            all_szse = fetch_szse_shares(cur, cur_end)
            share_rows = [(code, d, sh, 1 if (code, d) in conversions else 0)
                          for (code, sh, d) in all_szse if code in {c for c, *_ in ETF_LIST}]
            total_shares += upsert_many("etf_shares", ["code","trade_date","shares_10k","is_converted"], share_rows)
        except Exception as e:
            log.warning("SZSE %s~%s 份额失败: %s", cur, cur_end, e)
        time.sleep(SLEEP)
        cur = cur_end + timedelta(days=1)

    log.info("full 完成: 行情 %d 条 / 份额 %d 条", total_quotes, total_shares)
    return total_quotes + total_shares


def sync_benchmark_index(daily=True):
    """同步沪深300 日线 -> index_daily（大额申赎事件研究的收益基准）。

    akshare 优先（与本模块 ETF 数据同源），失败再用 Yahoo 兜底。
    """
    code, name, cat, yf_sym = BENCHMARK_INDEX
    today = date.today()
    start = (today - timedelta(days=30)) if daily else datetime.strptime(INDEX_START, "%Y-%m-%d").date()
    rows = []

    try:
        import akshare as ak
        df = with_retry(ak.index_zh_a_hist, symbol=code, period="daily",
                        start_date=start.strftime("%Y%m%d"), end_date=today.strftime("%Y%m%d"),
                        timeout=45, max_retry=3)
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                d = str(r.get("日期"))[:10]
                close = safe_dec(r.get("收盘"), 4)
                if not d or close is None:
                    continue
                rows.append((code, name, cat, d,
                             safe_dec(r.get("开盘"), 4), safe_dec(r.get("最高"), 4),
                             safe_dec(r.get("最低"), 4), close,
                             safe_int(r.get("成交量")), safe_dec(r.get("成交额"), 2),
                             safe_dec(r.get("涨跌幅"), 4), safe_dec(r.get("换手率"), 4)))
            log.info("[%s %s] akshare 指数日线 %d 行", code, name, len(rows))
    except Exception as e:
        log.warning("[%s] akshare 指数日线失败: %s", code, e)

    if not rows:
        try:
            hist = with_retry(
                lambda: yf.Ticker(yf_sym).history(start=start.strftime("%Y-%m-%d"),
                                                  end=today.strftime("%Y-%m-%d"),
                                                  auto_adjust=False),
                timeout=45, max_retry=3)
            if hist is not None and not hist.empty:
                closes = hist["Close"].astype(float)
                pct = closes.pct_change(fill_method=None) * 100.0
                for i, (ts, r) in enumerate(hist.iterrows()):
                    close = safe_dec(r.get("Close"), 4)
                    if close is None:
                        continue
                    d = ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else str(ts)[:10]
                    rows.append((code, name, cat, d,
                                 safe_dec(r.get("Open"), 4), safe_dec(r.get("High"), 4),
                                 safe_dec(r.get("Low"), 4), close,
                                 safe_int(r.get("Volume")), None,
                                 safe_dec(pct.iloc[i], 4) if i else safe_dec(0.0, 4), None))
                log.info("[%s %s] Yahoo 指数日线 %d 行", code, name, len(rows))
        except Exception as e:
            log.warning("[%s] Yahoo 指数日线失败: %s", code, e)

    if not rows:
        log.warning("%s 指数日线无数据", code)
        return 0

    cols = ["index_code", "index_name", "category", "trade_date", "open_price", "high_price",
            "low_price", "close_price", "volume", "amount", "change_pct", "turnover_rate"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            n = bulk_upsert(conn, cur, "index_daily", cols, rows,
                            ["index_code", "trade_date"],
                            [c for c in cols if c not in ("index_code", "trade_date")])
    log.info("[%s %s] 指数日线写入 %d 条", code, name, n)
    return n


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--daily", action="store_true", help="增量同步(最近若干天)")
    parser.add_argument("--full", action="store_true", help="全量回补")
    parser.add_argument("--since", default="2023-01-01", help="full 模式的起始日期")
    parser.add_argument("--init", action="store_true", help="初始化表与 ETF 清单")
    args = parser.parse_args()

    if args.init:
        init_db()
        return

    total = 0
    done = False
    if args.full:
        total = sync_full(args.since)
        total += sync_benchmark_index(daily=False)
        done = True
    if args.daily:
        total = sync_daily()
        total += sync_benchmark_index(daily=True)
        done = True
    if not done:
        parser.print_help()
        return

    write_sync_log("etf_flow", "success", total, "", "etf_flow")


if __name__ == "__main__":
    main()

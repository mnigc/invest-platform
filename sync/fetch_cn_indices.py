#!/usr/bin/env python3
"""同步中国市场指数日线（主要指数 / 风格指数）。
数据源: 优先 Yahoo Finance，失败兜底 akshare(东方财富)。
写入表: index_daily, data_sync_logs
用法:
    python3 fetch_cn_indices.py           # 默认补最近 90 天的数据
    python3 fetch_cn_indices.py --daily   # 只补最近 7 天（日常跑快一些）
"""
import os
import sys
import time
import logging
import threading
import datetime as _dt
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

# ===== 防止系统代理干扰国内站点（push2.eastmoney.com 等） + 伪装浏览器请求 =====
# 1) 在 import 第三方网络库之前清空代理相关环境变量，并强制 NO_PROXY=*
# 2) monkey-patch requests.get / requests.post 的默认参数，
#    - 显式 proxies={}（防止 urllib3 在 Windows 上再读注册表/系统代理）
#    - 伪装浏览器 User-Agent（降低被东财识别为爬虫的概率）
#    - 缩短超时 + 启用 keep-alive 重试
for _k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
    os.environ.pop(_k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

try:
    import requests as _req
    from requests.adapters import HTTPAdapter as _HTTPAdapter
    try:
        from urllib3.util.retry import Retry as _Retry
        _HAS_RETRY = True
    except Exception:
        _HAS_RETRY = False
    _req.packages.urllib3.disable_warnings()

    _DEFAULT_HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Connection": "keep-alive",
    }

    # 在重写之前先保存原始 get / post / Session，避免递归
    _orig_get = _req.get
    _orig_post = _req.post
    _orig_session_cls = _req.Session

    def _patched_get(url, params=None, headers=None, proxies=None, timeout=None, **kwargs):
        h = dict(_DEFAULT_HEADERS)
        if headers:
            h.update(headers)
        if timeout is None:
            timeout = (10, 20)
        return _orig_get(url, params=params, headers=h, proxies=proxies or {}, timeout=timeout, **kwargs)

    def _patched_post(url, data=None, headers=None, proxies=None, timeout=None, **kwargs):
        h = dict(_DEFAULT_HEADERS)
        if headers:
            h.update(headers)
        if timeout is None:
            timeout = (10, 20)
        return _orig_post(url, data=data, headers=h, proxies=proxies or {}, timeout=timeout, **kwargs)

    _req.get = _patched_get
    _req.post = _patched_post

    # 重写 Session：每次新建 Session 都会自动装上浏览器 UA + 连接池重试
    # akshare 内部经常自己建 Session，这样能覆盖到
    def _install_retry_session(*args, **kwargs):
        try:
            s = _orig_session_cls(*args, **kwargs)
            s.headers.update(_DEFAULT_HEADERS)
            if _HAS_RETRY:
                retry = _Retry(total=2, backoff_factor=0.5,
                               status_forcelist=(429, 500, 502, 503, 504),
                               allowed_methods=frozenset(["GET", "HEAD"]))
                adapter = _HTTPAdapter(max_retries=retry, pool_connections=5, pool_maxsize=10)
                s.mount("http://", adapter)
                s.mount("https://", adapter)
            return s
        except Exception:
            return _orig_session_cls(*args, **kwargs)

    _req.Session = _install_retry_session
except Exception:
    pass

import pandas as pd
import pymysql
import yfinance as yf


# ============== 数据库连接（生产环境） ==============
DB_HOST = "204.44.121.43"
DB_PORT = 3306
DB_USER = "mnigc"
DB_PASSWORD = "woaiyinyue.4"
DB_NAME = "invest_platform"

# ============== 运行参数 ==============
MAX_RETRY = 4
TIMEOUT = 30
SLEEP_YAHOO = 1.5      # 每次 Yahoo 后间隔
SLEEP_AKSHARE = 3.0    # 每次 akshare 后间隔（防止东财风控）

# ============== 主要指数 & 风格指数（先 Yahoo，失败兜底 akshare） ==============
# 格式: (指数代码, 中文名, category, Yahoo symbol)
# category 用于 index_daily 表该字段
MAIN_INDICES = [
    ("000001", "上证指数", "main", "000001.SS"),
    ("000016", "上证50", "main", "000016.SS"),
    ("000300", "沪深300", "main", "000300.SS"),
    ("000852", "中证1000", "main", "000852.SS"),
    ("000688", "科创50", "main", "000688.SS"),
    ("399001", "深证成指", "main", "399001.SZ"),
    ("399006", "创业板指", "main", "399006.SZ"),
]


# ============== 日志 ==============
def _setup_logger(name):
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    logger.addHandler(ch)
    try:
        logs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
        os.makedirs(logs_dir, exist_ok=True)
        log_file = os.path.join(logs_dir, "%s_%s.log" % (name, _dt.datetime.now().strftime("%Y%m%d")))
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    except Exception as e:
        print("日志文件初始化失败（忽略）:", e)
    return logger

log = _setup_logger("fetch_cn_indices")


# ============== 数据库辅助 ==============
def get_conn():
    return pymysql.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
    )


def write_sync_log(sync_type, status, records_count, error_message=""):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                now = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cur.execute(
                    "INSERT INTO data_sync_logs (sync_type, target_code, status, records_count, error_message, started_at, finished_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (sync_type, "", status, records_count, error_message, now, now),
                )
            conn.commit()
    except Exception as e:
        log.warning("写入 data_sync_logs 失败: %s", e)


# ============== 通用 with_retry ==============
def with_retry(fn, *args, **kwargs):
    last_err = None
    for attempt in range(1, MAX_RETRY + 1):
        holder, err_holder = [], []

        def _run():
            try:
                holder.append(fn(*args, **kwargs))
            except Exception as e:
                err_holder.append(e)

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        t.join(TIMEOUT)
        if t.is_alive():
            last_err = Exception("请求超过 %ds" % TIMEOUT)
        elif err_holder:
            last_err = err_holder[0]
        else:
            return holder[0] if holder else None
        wait = min(2 ** (attempt - 1), 15)
        log.warning("第 %d/%d 次失败: %s，%ds 后重试", attempt, MAX_RETRY, last_err, wait)
        time.sleep(wait)
    raise last_err if last_err else RuntimeError("未知错误")


# ============== 抓取 Yahoo（单 symbol） ==============
def _yf_history(yf_symbol, start_date, end_date):
    t = yf.Ticker(yf_symbol)
    hist = t.history(start=start_date, end=end_date, auto_adjust=False)
    return hist


# ============== 抓取 akshare（东财，按 code 取） ==============
def _ak_em_history(code, start_date, end_date):
    """东方财富源（akshare 封装）"""
    import akshare as ak  # 延迟导入；没装也不影响其它脚本
    df = ak.index_zh_a_hist(symbol=code, period="daily", start_date=start_date, end_date=end_date)
    return df


# ============== 归一化工具 ==============
def safe_dec(v, digits=6):
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass
    try:
        return Decimal(str(float(v))).quantize(
            Decimal("1").scaleb(-digits), rounding=ROUND_HALF_UP
        )
    except Exception:
        return None


def safe_int(v):
    if v is None:
        return None
    try:
        return int(float(v))
    except Exception:
        return None


# ============== 归一化 row 生成 ==============
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
            # 可能是 "20240101" 格式
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
                # akshare 一般给的是百分比值，例如 1.23 表示 1.23%，存入 decimal 要转成小数
                change_val = Decimal(str(float(change)) / 100.0).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
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


# ============== 批量写入 index_daily ==============
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


# ============== 主逻辑 ==============
def main():
    log.info("=" * 60)

    daily = "--daily" in sys.argv
    today = date.today()
    start = today - timedelta(days=7 if daily else 90)
    log.info("开始同步中国指数日线 (%s ~ %s)", start, today)

    total = 0
    errors = []

    # ----- 主要指数：优先 Yahoo，akshare 作为兜底 -----
    for code, name, cat, yf_sym in MAIN_INDICES:
        rows = []
        yf_rows = []
        ak_rows = []
        source = "none"

        # 1) Yahoo Finance（国外服务器稳定）
        try:
            hist = with_retry(
                _yf_history, yf_sym, start.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d"),
            )
            yf_rows = rows_from_yf(hist, code, name, cat)
            log.info("%s (%s) Yahoo 返回 %d 行", code, name, len(yf_rows))
        except Exception as e:
            log.warning("%s (%s) Yahoo 失败: %s", code, name, e)

        # 2) 如果 Yahoo 没取到数据或不足 2 行，兜底 akshare
        if len(yf_rows) < 2:
            log.info("%s (%s) Yahoo 数据不足 (%d 行)，改用 akshare(东财) 兜底", code, name, len(yf_rows))
            try:
                hist2 = with_retry(
                    _ak_em_history, code,
                    start.strftime("%Y%m%d"), today.strftime("%Y%m%d"),
                )
                ak_rows = rows_from_ak(hist2, code, name, cat)
                log.info("%s (%s) akshare 返回 %d 行", code, name, len(ak_rows))
            except Exception as e:
                log.warning("%s (%s) akshare 也失败: %s", code, name, e)

        # 优先用 akshare 结果（通常更完整），否则用 Yahoo
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

#!/usr/bin/env python3
"""同步中国宏观经济指标（GDP / CPI / PPI / PMI / 社会消费品零售总额）。
数据源: akshare（底层聚合国家统计局 / 国统局 / 中采 PMI 等）。
写入表: indicator_data, data_sync_logs
用法:
    python3 fetch_cn_macro.py
说明:
    NAS 在国内环境运行；akshare 直连东方财富/统计局即可。
"""
import os
import sys
import time
import logging
import threading
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

# ===== 防止系统代理干扰国内站点 + 伪装浏览器请求（同 fetch_cn_indices.py 逻辑） =====
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

import pymysql


# ============== 数据库连接（生产环境） ==============
DB_HOST = "204.44.121.43"
DB_PORT = 3306
DB_USER = "mnigc"
DB_PASSWORD = "woaiyinyue.4"
DB_NAME = "invest_platform"

# ============== 运行参数 ==============
MAX_RETRY = 4
TIMEOUT = 60           # 中国宏观数据接口有时候慢点，给长一点
SLEEP_BETWEEN = 3.0


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
        log_file = os.path.join(logs_dir, "%s_%s.log" % (name, datetime.now().strftime("%Y%m%d")))
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    except Exception as e:
        print("日志文件初始化失败（忽略）:", e)
    return logger

log = _setup_logger("fetch_cn_macro")


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
                now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cur.execute(
                    "INSERT INTO data_sync_logs (sync_type, target_code, status, records_count, error_message, started_at, finished_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (sync_type, "", status, records_count, error_message, now, now),
                )
            conn.commit()
    except Exception as e:
        log.warning("写入 data_sync_logs 失败: %s", e)


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
            last_err = Exception("调用超过 %ds" % TIMEOUT)
        elif err_holder:
            last_err = err_holder[0]
        else:
            return holder[0] if holder else None
        wait = min(2 ** (attempt - 1), 15)
        log.warning("第 %d/%d 次失败: %s，%ds 后重试", attempt, MAX_RETRY, last_err, wait)
        time.sleep(wait)
    raise last_err if last_err else RuntimeError("未知错误")


# ============== 各指标抓取函数 ==============
def _safe_dec(v, digits=6):
    if v is None:
        return None
    s = str(v).strip()
    if s in ("", "nan", "NaN", "None"):
        return None
    try:
        return Decimal(s).quantize(Decimal("1").scaleb(-digits), rounding=ROUND_HALF_UP)
    except Exception:
        return None


def _parse_period_date(s):
    """akshare 日期格式不统一，这里尝试几种格式"""
    if not s:
        return None
    s = str(s).strip()
    if not s:
        return None
    # 2024-01-01
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return s
    # 2024-01
    if len(s) == 7 and s[4] == "-":
        return s + "-01"
    # 20240101
    if len(s) == 8 and s.isdigit():
        return "%s-%s-%s" % (s[:4], s[4:6], s[6:8])
    # 2024年1季度 / 2024年1月 / 2024年1月1日
    if "年" in s:
        s = s.replace("年", "-").replace("月", "-").replace("日", "")
        # '2024-1季度' / '2024-1-' / '2024-1-'
        if "季度" in s:
            year, q = s.split("-", 1)
            q = q.replace("季度", "").strip()
            # 季度转成 3/6/9/12 月
            month_map = {"1": "03", "2": "06", "3": "09", "4": "12",
                         "一": "03", "二": "06", "三": "09", "四": "12"}
            m = month_map.get(q, "03")
            return "%s-%s-01" % (year.strip(), m)
        # 2024-1- / 2024-1-1
        parts = [x.strip() for x in s.split("-") if x.strip()]
        if len(parts) >= 2:
            year = parts[0]
            month = parts[1].zfill(2) if len(parts[1]) <= 2 else parts[1][:2]
            day = parts[2].zfill(2) if len(parts) > 2 and parts[2].isdigit() else "01"
            return "%s-%s-%s" % (year, month[:2], day[:2])
    return None


def _is_valid_date(s):
    """检查字符串是否是有效的日期格式 (YYYY-MM-DD 或 YYYY-MM)"""
    if not s or not isinstance(s, str):
        return False
    # YYYY-MM-DD
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        try:
            year, month, day = int(s[:4]), int(s[5:7]), int(s[8:10])
            return 1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31
        except ValueError:
            return False
    # YYYY-MM
    if len(s) == 7 and s[4] == "-":
        try:
            year, month = int(s[:4]), int(s[5:7])
            return 1900 <= year <= 2100 and 1 <= month <= 12
        except ValueError:
            return False
    return False


def fetch_gdp():
    """GDP（季度）: ak.macro_china_gdp()"""
    import akshare as ak
    df = with_retry(ak.macro_china_gdp)
    if df is None or df.empty:
        return []
    out = []
    for _, row in df.iterrows():
        period = None
        for key in row.index:
            val_str = str(row[key])
            # 先检查是否是有效日期
            if _is_valid_date(val_str):
                period = _parse_period_date(val_str)
                if period:
                    break
        if not period:
            continue
        # 其它列里找数值（GDP 累计值等）
        val = None
        for key in row.index:
            v = row[key]
            dv = _safe_dec(v, 2)
            if dv is not None and float(dv) > 0:
                val = dv
                break
        if val is not None:
            out.append((period, val))
    return out


def fetch_cpi():
    """CPI（月度）: ak.macro_china_cpi_yearly"""
    import akshare as ak
    df = with_retry(ak.macro_china_cpi_yearly)
    if df is None or df.empty:
        return []
    out = []
    for _, row in df.iterrows():
        period = None
        for key in row.index:
            val_str = str(row[key])
            if _is_valid_date(val_str):
                p = _parse_period_date(val_str)
                if p:
                    period = p
                    break
        if not period:
            continue
        # 第一个数值列，通常是 CPI 同比
        val = None
        for key in row.index:
            dv = _safe_dec(row[key], 2)
            if dv is not None and float(dv) != 0:
                val = dv
                break
        if val is not None:
            out.append((period, val))
    return out


def fetch_ppi():
    """PPI（月度）: ak.macro_china_ppi_yearly"""
    import akshare as ak
    df = with_retry(ak.macro_china_ppi_yearly)
    if df is None or df.empty:
        return []
    out = []
    for _, row in df.iterrows():
        period = None
        for key in row.index:
            val_str = str(row[key])
            if _is_valid_date(val_str):
                p = _parse_period_date(val_str)
                if p:
                    period = p
                    break
        if not period:
            continue
        val = None
        for key in row.index:
            dv = _safe_dec(row[key], 2)
            if dv is not None and float(dv) != 0:
                val = dv
                break
        if val is not None:
            out.append((period, val))
    return out


def fetch_pmi():
    """PMI（月度）: ak.macro_china_pmi"""
    import akshare as ak
    df = with_retry(ak.macro_china_pmi)
    if df is None or df.empty:
        return []
    out = []
    for _, row in df.iterrows():
        period = None
        for key in row.index:
            val_str = str(row[key])
            if _is_valid_date(val_str):
                p = _parse_period_date(val_str)
                if p:
                    period = p
                    break
        if not period:
            continue
        val = None
        for key in row.index:
            dv = _safe_dec(row[key], 2)
            if dv is not None and float(dv) > 0:
                val = dv
                break
        if val is not None:
            out.append((period, val))
    return out


def fetch_retail():
    """社会消费品零售总额（月度）: ak.macro_china_consumer_goods_retail"""
    import akshare as ak
    df = with_retry(ak.macro_china_consumer_goods_retail)
    if df is None or df.empty:
        return []
    out = []
    for _, row in df.iterrows():
        period = None
        for key in row.index:
            val_str = str(row[key])
            if _is_valid_date(val_str):
                p = _parse_period_date(val_str)
                if p:
                    period = p
                    break
        if not period:
            continue
        val = None
        for key in row.index:
            dv = _safe_dec(row[key], 2)
            if dv is not None and float(dv) > 0:
                val = dv
                break
        if val is not None:
            out.append((period, val))
    return out


FETCHERS = {
    "GDP": fetch_gdp,
    "CPI": fetch_cpi,
    "PPI": fetch_ppi,
    "PMI": fetch_pmi,
    "RETAIL": fetch_retail,
}


# ============== 写入 indicator_data ==============
def _bulk_write(indicator_id, points):
    if not points:
        return 0
    sql = (
        "INSERT INTO indicator_data (indicator_id, period_date, value, updated_at) "
        "VALUES (%s, %s, %s, NOW()) "
        "ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()"
    )
    rows = [(indicator_id, p[0], p[1]) for p in points]
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
                log.warning("  写入 %s 失败: %s", r[1], e2)
    return total


def main():
    log.info("=" * 60)
    log.info("开始同步中国宏观指标 (akshare)")

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, code, name_zh FROM indicators "
                    "WHERE is_active = 1 AND region = 'CN' AND source = 'akshare' ORDER BY code"
                )
                indicators = cur.fetchall()
    except Exception as e:
        log.error("读取 indicators 表失败: %s", e)
        write_sync_log("indicator_data", "failed", 0, "read indicators: " + str(e))
        return

    log.info("数据库里共 %d 个中国宏观指标", len(indicators))
    total = 0
    errors = []

    for ind in indicators:
        code = ind["code"]
        name = ind.get("name_zh") or code
        fn = FETCHERS.get(code)
        if fn is None:
            log.warning("%s (%s) - 暂未实现抓取函数，跳过", code, name)
            errors.append("%s: no fetcher" % code)
            continue

        try:
            points = fn()
            if not points:
                log.warning("%s (%s) - 无返回数据", code, name)
                errors.append("%s: no data" % code)
                time.sleep(SLEEP_BETWEEN)
                continue
            n = _bulk_write(ind["id"], points)
            total += n
            latest = points[-1] if points else ("-", "-")
            log.info("%s (%s) - 写入 %d 行；最新: %s = %s", code, name, n, latest[0], latest[1])
        except Exception as e:
            log.warning("%s (%s) - 同步失败: %s", code, name, e)
            errors.append("%s: %s" % (code, e))
        time.sleep(SLEEP_BETWEEN)

    if errors and total > 0:
        status = "partial"
    elif total > 0:
        status = "success"
    else:
        status = "failed"
    msg = "共写入 %d 行；失败 %d 个；前 5 条: %s" % (total, len(errors), "; ".join(errors[:5]))
    log.info(msg)
    write_sync_log("indicator_data(CN)", status, total, msg)


if __name__ == "__main__":
    main()

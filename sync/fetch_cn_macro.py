#!/usr/bin/env python3
"""同步中国宏观经济指标（GDP / CPI / PPI / PMI / 社会消费品零售总额）。
数据源: akshare（底层聚合国家统计局 / 国统局 / 中采 PMI 等）。
写入表: indicator_data, data_sync_logs
用法:
    python3 fetch_cn_macro.py
说明:
    NAS 在国内环境运行；akshare 直连东方财富/统计局即可。
"""
import time
from decimal import Decimal

from sync_base import _setup_logger, get_conn, write_sync_log, with_retry, patch_cn_proxy, safe_dec


patch_cn_proxy()


MAX_RETRY = 4
TIMEOUT = 60
SLEEP_BETWEEN = 3.0

log = _setup_logger("fetch_cn_macro")


def _parse_period_date(s):
    if not s:
        return None
    s = str(s).strip()
    if not s:
        return None
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return s
    if len(s) == 7 and s[4] == "-":
        return s + "-01"
    if len(s) == 8 and s.isdigit():
        return "%s-%s-%s" % (s[:4], s[4:6], s[6:8])
    if "年" in s:
        s = s.replace("年", "-").replace("月", "-").replace("日", "")
        if "季度" in s:
            year, q = s.split("-", 1)
            q = q.replace("季度", "").strip()
            month_map = {"1": "03", "2": "06", "3": "09", "4": "12",
                         "一": "03", "二": "06", "三": "09", "四": "12"}
            m = month_map.get(q, "03")
            return "%s-%s-01" % (year.strip(), m)
        parts = [x.strip() for x in s.split("-") if x.strip()]
        if len(parts) >= 2:
            year = parts[0]
            month = parts[1].zfill(2) if len(parts[1]) <= 2 else parts[1][:2]
            day = parts[2].zfill(2) if len(parts) > 2 and parts[2].isdigit() else "01"
            return "%s-%s-%s" % (year, month[:2], day[:2])
    return None


def _is_valid_date(s):
    if not s or not isinstance(s, str):
        return False
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        try:
            year, month, day = int(s[:4]), int(s[5:7]), int(s[8:10])
            return 1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31
        except ValueError:
            return False
    if len(s) == 7 and s[4] == "-":
        try:
            year, month = int(s[:4]), int(s[5:7])
            return 1900 <= year <= 2100 and 1 <= month <= 12
        except ValueError:
            return False
    return False


def fetch_gdp():
    import akshare as ak
    df = with_retry(ak.macro_china_gdp, timeout=TIMEOUT, max_retry=MAX_RETRY)
    if df is None or df.empty:
        return []
    out = []
    for _, row in df.iterrows():
        period = None
        for key in row.index:
            val_str = str(row[key])
            if _is_valid_date(val_str):
                period = _parse_period_date(val_str)
                if period:
                    break
        if not period:
            continue
        val = None
        for key in row.index:
            v = row[key]
            dv = safe_dec(v, 2)
            if dv is not None and float(dv) > 0:
                val = dv
                break
        if val is not None:
            out.append((period, val))
    return out


def fetch_cpi():
    import akshare as ak
    df = with_retry(ak.macro_china_cpi_yearly, timeout=TIMEOUT, max_retry=MAX_RETRY)
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
            dv = safe_dec(row[key], 2)
            if dv is not None and float(dv) != 0:
                val = dv
                break
        if val is not None:
            out.append((period, val))
    return out


def fetch_ppi():
    import akshare as ak
    df = with_retry(ak.macro_china_ppi_yearly, timeout=TIMEOUT, max_retry=MAX_RETRY)
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
            dv = safe_dec(row[key], 2)
            if dv is not None and float(dv) != 0:
                val = dv
                break
        if val is not None:
            out.append((period, val))
    return out


def fetch_pmi():
    import akshare as ak
    df = with_retry(ak.macro_china_pmi, timeout=TIMEOUT, max_retry=MAX_RETRY)
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
            dv = safe_dec(row[key], 2)
            if dv is not None and float(dv) > 0:
                val = dv
                break
        if val is not None:
            out.append((period, val))
    return out


def fetch_retail():
    import akshare as ak
    df = with_retry(ak.macro_china_consumer_goods_retail, timeout=TIMEOUT, max_retry=MAX_RETRY)
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
            dv = safe_dec(row[key], 2)
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
                codes = list(FETCHERS.keys())
                placeholders = ",".join(["%s"] * len(codes))
                cur.execute(
                    "SELECT id, code, name_zh FROM indicators "
                    "WHERE is_active = 1 AND code IN (%s) ORDER BY code" % placeholders,
                    codes,
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

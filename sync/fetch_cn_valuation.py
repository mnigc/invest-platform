#!/usr/bin/env python3
"""同步 A 股市场估值数据。
数据源: akshare
写入表: cn_valuation, data_sync_logs
用法:
    python3 fetch_cn_valuation.py
"""
import json
from datetime import datetime
from decimal import Decimal

from sync_base import _setup_logger, get_conn, write_sync_log, with_retry, patch_cn_proxy, safe_dec


patch_cn_proxy()


MAX_RETRY = 4
TIMEOUT = 30

log = _setup_logger("fetch_cn_valuation")


def init_table(conn):
    sql = """
    CREATE TABLE IF NOT EXISTS cn_valuation (
        id BIGSERIAL PRIMARY KEY,
        date DATE NOT NULL,
        overall_pe NUMERIC(10, 4),
        overall_pb NUMERIC(10, 4),
        overall_signal VARCHAR(20),
        industries_json JSONB,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT uk_cn_valuation_date UNIQUE (date)
    )
    """
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()


def fetch_market_pe():
    import akshare as ak
    df = with_retry(ak.stock_market_pe_lg, timeout=TIMEOUT, max_retry=MAX_RETRY)
    if df is None or df.empty:
        return None, None

    cols = list(df.columns)
    pe_col = next((c for c in cols if "平均市盈率" in c), None)
    if pe_col is None:
        pe_col = cols[-1]

    latest = df.iloc[-1]
    pe = safe_dec(latest.get(pe_col), 4)
    return pe, None


def fetch_industry_pe():
    import akshare as ak
    df = with_retry(ak.sw_index_first_info, timeout=TIMEOUT, max_retry=MAX_RETRY)
    if df is None or df.empty:
        return []

    cols = list(df.columns)
    name_col = next((c for c in cols if "行业名称" in c), cols[0])
    pe_col = next((c for c in cols if "TTM" in c and "市盈" in c), None)
    if pe_col is None:
        pe_col = next((c for c in cols if "市盈" in c), None)
    pb_col = next((c for c in cols if "市净" in c), None)
    count_col = next((c for c in cols if "成份个数" in c or "成分个数" in c), None)

    industries = []
    for _, row in df.iterrows():
        name = str(row.get(name_col, "")).strip()
        if not name:
            continue
        pe = safe_dec(row.get(pe_col) if pe_col else None, 4)
        pb = safe_dec(row.get(pb_col) if pb_col else None, 4)
        count = None
        if count_col:
            try:
                count = int(float(row.get(count_col, 0)))
            except Exception:
                count = None
        if pe is not None or pb is not None:
            industries.append({
                "name": name,
                "pe": float(pe) if pe is not None else None,
                "pb": float(pb) if pb is not None else None,
                "stockCount": count,
            })
    return industries


def signal_from_pe(pe):
    if pe is None:
        return "--"
    if pe < 15:
        return "低估"
    if pe < 20:
        return "中性偏低"
    if pe < 25:
        return "中性"
    if pe < 30:
        return "中性偏高"
    return "高估"


def main():
    log.info("=" * 60)
    log.info("开始同步 A 股估值数据")

    try:
        with get_conn() as conn:
            init_table(conn)

            overall_pe, overall_pb = fetch_market_pe()
            industries = fetch_industry_pe()

            if overall_pe is None and not industries:
                raise RuntimeError("未能获取任何估值数据")

            signal = signal_from_pe(overall_pe)
            today = datetime.now().strftime("%Y-%m-%d")

            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO cn_valuation (date, overall_pe, overall_pb, overall_signal, industries_json)
                    VALUES (%s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        overall_pe = VALUES(overall_pe),
                        overall_pb = VALUES(overall_pb),
                        overall_signal = VALUES(overall_signal),
                        industries_json = VALUES(industries_json)
                    """,
                    (today, overall_pe, overall_pb, signal, json.dumps(industries, ensure_ascii=False)),
                )
            conn.commit()

            msg = "全市场PE=%s, 行业数=%d" % (overall_pe, len(industries))
            log.info("写入完成: %s", msg)
            write_sync_log("cn_valuation", "success", len(industries) + 1, msg)
    except Exception as e:
        log.error("同步失败: %s", e)
        write_sync_log("cn_valuation", "failed", 0, str(e))
        raise


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""同步全球央行黄金储备变动数据。

数据源:
  - 默认: 从 CSV 文件导入（用户从世界黄金协会/WGC 下载）
  - 可选: 从 FRED API 获取（IMF 官方储备数据）
写入表: gold_reserve_changes
用法:
    # 从 CSV 导入（默认）
    python3 sync_gold_reserves.py --csv path/to/reserves.csv

    # 从 FRED API 获取（需要 FRED_API_KEY）
    python3 sync_gold_reserves.py --fred

    # CSV 格式: country_name,period_date,change_tonnes
    # 示例:
    #   China,2024-01-31,10.0
    #   Russia,2024-01-31,5.5
    #   Poland,2024-01-31,3.2
"""
import os
import sys
import csv
import argparse
import datetime
import requests

from sync_base import (
    _setup_logger, get_conn, write_sync_log, with_retry,
    bulk_upsert, patch_cn_proxy,
)

log = _setup_logger("sync_gold_reserves")

FRED_API_KEY = os.environ.get("FRED_API_KEY", "")
# FRED 系列: IMF 官方黄金储备（盎司）- 需要按国家查询
# 主要央行国家代码
MAJOR_COUNTRIES = {
    "US": "United States",
    "CN": "China",
    "RU": "Russia",
    "IN": "India",
    "PL": "Poland",
    "DE": "Germany",
    "FR": "France",
    "IT": "Italy",
    "JP": "Japan",
    "NL": "Netherlands",
    "CH": "Switzerland",
    "GB": "United Kingdom",
    "TR": "Turkey",
    "KZ": "Kazakhstan",
    "UZ": "Uzbekistan",
}

# 国家名称中英文映射
COUNTRY_NAME_CN = {
    "United States": "美国",
    "China": "中国",
    "Russia": "俄罗斯",
    "India": "印度",
    "Poland": "波兰",
    "Germany": "德国",
    "France": "法国",
    "Italy": "意大利",
    "Japan": "日本",
    "Netherlands": "荷兰",
    "Switzerland": "瑞士",
    "United Kingdom": "英国",
    "Turkey": "土耳其",
    "Kazakhstan": "哈萨克斯坦",
    "Uzbekistan": "乌兹别克斯坦",
}


def ensure_table():
    """确保 gold_reserve_changes 表存在"""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS gold_reserve_changes (
                    id BIGSERIAL PRIMARY KEY,
                    country_name VARCHAR(120) NOT NULL,
                    country_name_cn VARCHAR(120),
                    period_date DATE NOT NULL,
                    change_tonnes NUMERIC(18,4) NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    CONSTRAINT uk_gold_change_country_period UNIQUE (country_name, period_date)
                )
            """)
        conn.commit()


def parse_csv(csv_path):
    """解析 CSV 文件 -> [(country_name, country_name_cn, period_date, change_tonnes)]"""
    rows = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        # 支持多种列名
        for row in reader:
            # 尝试不同的列名
            country = row.get("country_name") or row.get("country") or row.get("Country") or ""
            date = row.get("period_date") or row.get("date") or row.get("Date") or ""
            change = row.get("change_tonnes") or row.get("change") or row.get("Change") or row.get("tonnes") or ""

            if not country or not date or not change:
                continue

            # 标准化日期格式
            try:
                if len(date) == 7:  # YYYY-MM
                    date = date + "-01"
                date = date[:10]  # 取 YYYY-MM-DD
            except Exception:
                continue

            try:
                change_val = float(change)
            except ValueError:
                continue

            country_cn = COUNTRY_NAME_CN.get(country, country)
            rows.append((country, country_cn, date, change_val))

    log.info("CSV 解析: %d 条记录", len(rows))
    return rows


def fetch_fred_gold_reserves():
    """从 FRED API 获取各国黄金储备数据（盎司），计算月度变化 -> [(country_name, country_name_cn, period_date, change_tonnes)]"""
    if not FRED_API_KEY:
        log.warning("未设置 FRED_API_KEY，无法从 FRED 获取数据")
        return []

    OUNCE_TO_GRAM = 31.1035
    GRAM_TO_TONNE = 1e-6

    rows = []
    for code, name in MAJOR_COUNTRIES.items():
        series_id = f"GOLDSTAL{code}"
        try:
            url = f"https://api.stlouisfed.org/fred/series/observations"
            params = {
                "series_id": series_id,
                "api_key": FRED_API_KEY,
                "file_type": "json",
                "sort_order": "asc",
                "limit": 1000,
            }
            r = with_retry(lambda: requests.get(url, params=params, timeout=30), timeout=30, max_retry=3)
            data = r.json()
            observations = data.get("observations", [])

            prev_ounces = None
            for obs in observations:
                date = obs.get("date", "")[:10]
                value_str = obs.get("value", ".")
                if value_str == "." or not date:
                    continue

                try:
                    ounces = float(value_str)
                except ValueError:
                    continue

                if prev_ounces is not None:
                    change_ounces = ounces - prev_ounces
                    change_tonnes = change_ounces * OUNCE_TO_GRAM * GRAM_TO_TONNE
                    if abs(change_tonnes) > 0.001:  # 过滤微小变动
                        country_cn = COUNTRY_NAME_CN.get(name, name)
                        rows.append((name, country_cn, date, round(change_tonnes, 4)))

                prev_ounces = ounces

            log.info("FRED %s (%s): %d 条变动", name, series_id, len([r for r in rows if r[0] == name]))

        except Exception as e:
            log.warning("FRED %s 获取失败: %s", name, e)
            continue

    log.info("FRED 总计: %d 条记录", len(rows))
    return rows


def upsert_reserves(rows):
    """批量写入 gold_reserve_changes"""
    if not rows:
        return 0
    payload = [(country, country_cn, date, change) for country, country_cn, date, change in rows]
    with get_conn() as conn:
        with conn.cursor() as cur:
            return bulk_upsert(
                conn, cur, "gold_reserve_changes",
                ["country_name", "country_name_cn", "period_date", "change_tonnes"],
                payload, ["country_name", "period_date"], ["change_tonnes", "country_name_cn"]
            )


def main():
    parser = argparse.ArgumentParser(description="同步全球央行黄金储备变动数据")
    parser.add_argument("--csv", type=str, help="CSV 文件路径")
    parser.add_argument("--fred", action="store_true", help="从 FRED API 获取数据")
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("开始同步: 全球央行黄金储备变动")

    ensure_table()
    total = 0
    errors = []

    if args.csv:
        # 从 CSV 导入
        try:
            rows = parse_csv(args.csv)
            n = upsert_reserves(rows)
            total += n
            log.info("[CSV 导入] 写入 %d 条", n)
        except Exception as e:
            log.error("[CSV 导入] 失败: %s", e)
            errors.append(str(e))
    elif args.fred:
        # 从 FRED API 获取
        patch_cn_proxy()  # 清理代理
        try:
            rows = fetch_fred_gold_reserves()
            n = upsert_reserves(rows)
            total += n
            log.info("[FRED] 写入 %d 条", n)
        except Exception as e:
            log.error("[FRED] 失败: %s", e)
            errors.append(str(e))
    else:
        log.info("未指定数据源，请使用 --csv 或 --fred 参数")
        log.info("示例: python3 sync_gold_reserves.py --csv reserves.csv")
        log.info("示例: python3 sync_gold_reserves.py --fred")
        return

    status = "success" if not errors and total > 0 else ("partial" if total > 0 else "failed")
    msg = "gold_reserves 写入 %d 行；失败 %d 项" % (total, len(errors))
    if errors:
        msg += "；" + "; ".join(errors[:3])
    log.info(msg)
    write_sync_log("gold_reserves", status, total, msg)


if __name__ == "__main__":
    main()

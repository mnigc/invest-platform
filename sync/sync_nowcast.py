#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示模块：Nowcast（亚特兰大 GDPNow / 圣路易斯联储 ENI）

按用户决策：只做取数 + 入库 + 对外 API，不挂导航、不挂页面、不挂 Banner。

数据源策略调整（plan v1 → 实施 v2）：
  计划版本原打算抓 GDPNow / NY Fed 的 XLSX 端点，但实测两个端点均返回 HTML
  落地页（结构变更后未修复）。FRED 上没有 NY Fed Staff Nowcast 的镜像。

  实施版本改用 FRED 已有 series：
    * GDPNow                → FRED: GDPNOW（亚特兰大 GDPNow 季度 SAAR %）
    * NY Fed Nowcast 代理    → FRED: STLENI（圣路易斯联储 ENI，季频，结构相近：
                               用月度经济数据发布内容预测当季 real GDP 增速）

  STLENI 不是 NY Fed Staff Nowcast 的直接镜像，但同属「用高频月数据预测当季
  GDP」的方法论家族，作为「第二源对照」仍然有意义。**绝不**把 STLENI 标注为
  「NY Fed」——前端显示「圣路易斯联储 ENI」。

写入表：nowcast_snapshots（首次同步时自建），data_sync_logs

降级：任一源拉取/解析失败只记 warning，不让任务整体失败。

用法:
    python3 sync_nowcast.py
"""
import sys
import json
from datetime import date, datetime

import requests

from sync_base import (
    _setup_logger, get_conn, write_sync_log, with_retry, patch_cn_proxy,
)
from indicators import sync_indicators


patch_cn_proxy()
log = _setup_logger("sync_nowcast")


# =====================================================================
# 表结构（首次同步时自建）
# =====================================================================
DDL = """
CREATE TABLE IF NOT EXISTS nowcast_snapshots (
    id BIGSERIAL PRIMARY KEY,
    source VARCHAR(20) NOT NULL,
    snapshot_date DATE NOT NULL,
    gdp_value NUMERIC(10, 4),
    raw_payload JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uk_nowcast_source_date UNIQUE (source, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_nowcast_source_date
    ON nowcast_snapshots (source, snapshot_date);
"""


def ensure_tables():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
        conn.commit()
    log.info("nowcast_snapshots 表结构已确认")


# =====================================================================
# 拉取：FRED JSON API
# =====================================================================
def fetch_fred_observations(series_id, limit=300):
    """拉取单条 FRED 序列的观测值（升序），按季度日期聚合保留所有非空观测。"""
    import os
    key = os.environ.get("FRED_API_KEY", "")
    if not key:
        raise RuntimeError("FRED_API_KEY 未设置")
    url = "https://api.stlouisfed.org/fred/series/observations"
    params = {
        "series_id": series_id,
        "api_key": key,
        "file_type": "json",
        "sort_order": "asc",
        "limit": str(limit),
    }
    r = with_retry(lambda: requests.get(url, params=params, timeout=20),
        timeout=20, max_retry=3)
    r.raise_for_status()
    rows = []
    for o in (r.json() or {}).get("observations", []):
        raw = str(o.get("value", "")).strip()
        if not raw or raw in (".", "NA", "NaN", "None"):
            continue
        try:
            v = float(raw)
        except ValueError:
            continue
        d = o.get("date")
        if not d:
            continue
        rows.append((date.fromisoformat(str(d)[:10]), v, {
            "series_id": series_id,
            "date": str(d)[:10],
            "value": v,
        }))
    return rows


def _upsert(source, rows):
    if not rows:
        return 0
    sql = (
        "INSERT INTO nowcast_snapshots "
        "(source, snapshot_date, gdp_value, raw_payload) "
        "VALUES (%s, %s, %s, %s) "
        "ON CONFLICT (source, snapshot_date) DO UPDATE SET "
        "gdp_value = EXCLUDED.gdp_value, "
        "raw_payload = EXCLUDED.raw_payload, "
        "updated_at = now()"
    )
    n = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            for d, v, payload in rows:
                try:
                    cur.execute(sql, (source, d, v, json.dumps(payload)))
                    n += 1
                except Exception as e:
                    log.warning("写入 %s/%s 失败: %s", source, d, e)
        conn.commit()
    return n


def sync_one(source_label, fred_series):
    try:
        rows = fetch_fred_observations(fred_series, limit=200)
    except Exception as e:
        log.warning("%s/%s 拉取失败: %s", source_label, fred_series, e)
        write_sync_log("nowcast", "partial", 0,
                       "%s: %s" % (source_label, e), source_label)
        return 0
    if not rows:
        log.warning("%s 无有效观测", source_label)
        write_sync_log("nowcast", "partial", 0,
                       "%s/%s: 无有效观测" % (source_label, fred_series),
                       source_label)
        return 0
    n = _upsert(source_label, rows)
    log.info("%s (%s) 写入 %d 条（最新 %s）",
             source_label, fred_series, n, rows[-1][0])
    write_sync_log("nowcast", "success", n,
                   "%s (%s): 写入 %d 条" % (source_label, fred_series, n),
                   source_label)
    return n


def main():
    log.info("=" * 60)
    log.info("开始同步: Nowcast（GDPNow + St. Louis Fed ENI via FRED）")

    ensure_tables()

    total = 0
    try:
        total += sync_one("GDPNow", "GDPNOW")
    except Exception as e:
        log.warning("GDPNow 整体失败: %s", e)

    try:
        total += sync_one("NYFed", "STLENI")  # 第二源对照，圣路易斯联储 ENI
    except Exception as e:
        log.warning("STLENI 整体失败: %s", e)

    log.info("Nowcast 同步完成，共写入 %d 条", total)


if __name__ == "__main__":
    main()
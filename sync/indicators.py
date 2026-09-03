#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示指标注册表 + 通用同步引擎（FRED）。

同步脚本按「展示模块」组织（sync_regime / sync_gold_decision /
sync_global_liquidity），每个脚本只声明自己
需要的指标 key=(code, region)；真正的取数逻辑集中在本文件：

  * 指标定义（中文名/单位/频率/数据源）自动 UPSERT 进 `indicators` 表
  * 依据 `indicator_data` 已有最新日期做增量拉取（--full 可全量回补）
  * 同一次 run_sync 进程内，跨模块共用的指标（DGS10 / VIXCLS / DFII10 …）只拉一次

用法:
    from indicators import sync_indicators
    sync_indicators("regime", [("CPI", "US"), ("VIXCLS", "US")])
"""
import os
import re
import time
from datetime import date, datetime, timedelta

import requests

from sync_base import (
    _setup_logger, get_conn, write_sync_log, with_retry, safe_dec,
    patch_cn_proxy, bulk_upsert,
)


patch_cn_proxy()


FRED_API_KEY = os.environ.get("FRED_API_KEY", "DEMO_KEY")
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"

SLEEP_BETWEEN = 0.5          # 每次请求之间的间隔（FRED 限流保护）
DEFAULT_START = "2000-01-01"  # 库里无数据时的全量起点
OVERLAP_DAYS = 30            # 增量拉取时向前重叠的天数（吸收历史数据修订）

log = _setup_logger("indicators")

# 同一次进程内已同步过的指标 key，用于跨模块去重
_SYNCED = set()


# =====================================================================
# 指标注册表：key = (code, region)
#   source = "fred"    -> spec["series"] 为 FRED series id
# =====================================================================
INDICATORS = {
    # ── 美国宏观 / 市场（FRED）──
    ("CPI", "US"): dict(zh="居民消费价格指数", en="CPI", cat="经济数据", sub="通胀",
                        unit="指数", freq="monthly", source="fred", series="CPIAUCSL"),
    ("FEDFUNDS", "US"): dict(zh="联邦基金利率", en="Fed Funds Rate", cat="货币", sub="政策利率",
                             unit="%", freq="monthly", source="fred", series="FEDFUNDS"),
    ("DGS10", "US"): dict(zh="美债收益率 10Y", en="US Treasury 10Y", cat="利率",
                          sub="美债收益率", unit="%", freq="daily", source="fred", series="DGS10"),
    ("DGS2", "US"): dict(zh="美债收益率 2Y", en="US Treasury 2Y", cat="利率",
                         sub="美债收益率", unit="%", freq="daily", source="fred", series="DGS2"),
    ("VIXCLS", "US"): dict(zh="VIX 恐慌指数", en="VIX", cat="市场", sub="波动率",
                           unit="点", freq="daily", source="fred", series="VIXCLS"),
    ("CFNAI", "US"): dict(zh="芝加哥联储全国活动指数", en="CFNAI", cat="经济数据", sub="增长",
                          unit="点", freq="monthly", source="fred", series="CFNAI"),
    ("DFII10", "US"): dict(zh="10Y TIPS 实际利率", en="10Y TIPS Real Yield", cat="利率",
                           sub="实际利率", unit="%", freq="daily", source="fred", series="DFII10"),
    ("T10YIE", "US"): dict(zh="10Y 盈亏平衡通胀", en="10Y Breakeven Inflation", cat="利率",
                           sub="通胀预期", unit="%", freq="daily", source="fred", series="T10YIE"),
    ("BAMLC0A4CBBB", "US"): dict(zh="BBB 信用利差", en="BBB Credit Spread", cat="信用",
                                 sub="信用利差", unit="%", freq="daily", source="fred",
                                 series="BAMLC0A4CBBB"),

    # ── 收益率曲线（FRED）──
    ("DGS3MO", "US"): dict(zh="美债收益率 3M", en="US Treasury 3M", cat="利率",
                           sub="美债收益率", unit="%", freq="daily", source="fred", series="DGS3MO"),
    ("DGS6MO", "US"): dict(zh="美债收益率 6M", en="US Treasury 6M", cat="利率",
                           sub="美债收益率", unit="%", freq="daily", source="fred", series="DGS6MO"),
    ("DGS1", "US"): dict(zh="美债收益率 1Y", en="US Treasury 1Y", cat="利率",
                          sub="美债收益率", unit="%", freq="daily", source="fred", series="DGS1"),
    ("DGS5", "US"): dict(zh="美债收益率 5Y", en="US Treasury 5Y", cat="利率",
                          sub="美债收益率", unit="%", freq="daily", source="fred", series="DGS5"),
    ("DGS7", "US"): dict(zh="美债收益率 7Y", en="US Treasury 7Y", cat="利率",
                          sub="美债收益率", unit="%", freq="daily", source="fred", series="DGS7"),
    ("DGS20", "US"): dict(zh="美债收益率 20Y", en="US Treasury 20Y", cat="利率",
                           sub="美债收益率", unit="%", freq="daily", source="fred", series="DGS20"),
    ("DGS30", "US"): dict(zh="美债收益率 30Y", en="US Treasury 30Y", cat="利率",
                           sub="美债收益率", unit="%", freq="daily", source="fred", series="DGS30"),
    ("T10Y2Y", "US"): dict(zh="10Y-2Y 利差", en="10Y-2Y Spread", cat="利率",
                            sub="收益率曲线", unit="%", freq="daily", source="fred", series="T10Y2Y"),
    ("T10Y3M", "US"): dict(zh="10Y-3M 利差", en="10Y-3M Spread", cat="利率",
                            sub="收益率曲线", unit="%", freq="daily", source="fred", series="T10Y3M"),

    # ── 通胀预期（FRED）──
    ("T5YIE", "US"): dict(zh="5Y 盈亏平衡通胀", en="5Y Breakeven Inflation", cat="利率",
                           sub="通胀预期", unit="%", freq="daily", source="fred", series="T5YIE"),
    ("DFII5", "US"): dict(zh="5Y TIPS 实际利率", en="5Y TIPS Real Yield", cat="利率",
                           sub="实际利率", unit="%", freq="daily", source="fred", series="DFII5"),
    ("DFII20", "US"): dict(zh="20Y TIPS 实际利率", en="20Y TIPS Real Yield", cat="利率",
                             sub="实际利率", unit="%", freq="daily", source="fred", series="DFII20"),
    ("DFII30", "US"): dict(zh="30Y TIPS 实际利率", en="30Y TIPS Real Yield", cat="利率",
                             sub="实际利率", unit="%", freq="daily", source="fred", series="DFII30"),

    # ── 信用利差（FRED）──
    ("BAMLH0A0HYM2", "US"): dict(zh="高收益债利差 (HY)", en="HY OAS", cat="信用",
                                   sub="信用利差", unit="%", freq="daily", source="fred",
                                   series="BAMLH0A0HYM2"),
    ("BAMLC0A1CAAA", "US"): dict(zh="AAA 信用利差", en="AAA OAS", cat="信用",
                                   sub="信用利差", unit="%", freq="daily", source="fred",
                                   series="BAMLC0A1CAAA"),
    ("BAMLC0A2CAA", "US"): dict(zh="AA 信用利差", en="AA OAS", cat="信用",
                                   sub="信用利差", unit="%", freq="daily", source="fred",
                                   series="BAMLC0A2CAA"),

    # ── 全球流动性（FRED，region=GLOBAL）──
    ("FED_BALANCE_SHEET", "GLOBAL"): dict(zh="美联储总资产", en="Fed Total Assets", cat="全球流动性",
                                           sub="央行资产负债表", unit="百万美元", freq="weekly",
                                           source="fred", series="WALCL"),
    ("FED_RRP", "GLOBAL"): dict(zh="美联储隔夜逆回购", en="Fed O/N Reverse Repo", cat="全球流动性",
                                sub="美联储流动性工具", unit="十亿美元", freq="daily",
                                source="fred", series="RRPONTSYD"),
    ("FED_TGA", "GLOBAL"): dict(zh="TGA 账户余额", en="Treasury General Account", cat="全球流动性",
                                sub="美联储流动性工具", unit="百万美元", freq="weekly",
                                source="fred", series="WTREGEN"),
    ("SOFR", "GLOBAL"): dict(zh="担保隔夜融资利率", en="SOFR", cat="全球流动性", sub="货币市场利率",
                             unit="%", freq="daily", source="fred", series="SOFR"),
    ("ECB_BALANCE_SHEET", "GLOBAL"): dict(zh="欧央行总资产", en="ECB Total Assets", cat="全球流动性",
                                          sub="央行资产负债表", unit="百万欧元", freq="weekly",
                                          source="fred", series="ECBASSETSW"),
    ("BOJ_BALANCE_SHEET", "GLOBAL"): dict(zh="日本央行总资产", en="BOJ Total Assets", cat="全球流动性",
                                          sub="央行资产负债表", unit="百亿日元", freq="monthly",
                                          source="fred", series="JPNASSETS"),

    # ── 货币市场与准备金（FRED，补齐「准备金 → SOFR」传导链）──
    # 知识图谱 liquidity.json 里 reserves 节点早已画出这条边，但数据层此前没有对应指标。
    ("IORB", "GLOBAL"): dict(zh="准备金余额利率", en="Interest on Reserve Balances",
                             cat="全球流动性", sub="政策利率",
                             unit="%", freq="daily", source="fred", series="IORB"),
    ("BANK_RESERVES", "GLOBAL"): dict(zh="银行体系准备金", en="Reserve Balances with Fed",
                                      cat="全球流动性", sub="银行准备金",
                                      unit="百万美元", freq="weekly", source="fred",
                                      series="WRESBAL"),
    ("M1", "US"): dict(zh="M1 货币供应", en="M1 Money Stock", cat="货币", sub="货币供应",
                       unit="十亿美元", freq="monthly", source="fred", series="M1SL"),
    ("M2", "US"): dict(zh="M2 货币供应", en="M2 Money Stock", cat="货币", sub="货币供应",
                       unit="十亿美元", freq="monthly", source="fred", series="M2SL"),

    # ── 大宗商品（FRED，区域归 GLOBAL：均为全球定价基准）──
    ("WTI", "GLOBAL"): dict(zh="WTI 原油", en="WTI Crude Oil", cat="大宗商品", sub="能源",
                            unit="美元/桶", freq="daily", source="fred", series="DCOILWTICO"),
    ("BRENT", "GLOBAL"): dict(zh="布伦特原油", en="Brent Crude Oil", cat="大宗商品", sub="能源",
                              unit="美元/桶", freq="daily", source="fred", series="DCOILBRENTEU"),
    ("NATGAS", "GLOBAL"): dict(zh="Henry Hub 天然气", en="Henry Hub Natural Gas",
                               cat="大宗商品", sub="能源",
                               unit="美元/百万英热", freq="daily", source="fred",
                               series="DHHNGSP"),
    ("COPPER", "GLOBAL"): dict(zh="全球铜价", en="Global Copper Price", cat="大宗商品",
                               sub="金属", unit="美元/吨", freq="monthly", source="fred",
                               series="PCOPPUSDM"),
("IRON_ORE", "GLOBAL"): dict(zh="全球铁矿石价", en="Global Iron Ore Price", cat="大宗商品",
                                  sub="金属", unit="美元/吨", freq="monthly", source="fred",
                                  series="PIORECRUSDM"),
    ("GLOBAL_COMM_IDX", "GLOBAL"): dict(zh="全球商品综合价格指数", en="Global Commodity Price Index",
                                         cat="大宗商品", sub="综合指数", unit="指数(2016=100)",
                                         freq="monthly", source="fred", series="PALLFNFINDEXM"),

    # ── 全球工业产出（G7 成员，OECD via FRED）──
    # 实测 vintage 2024-03 起停止更新（OECD 数据源在 FRED 镜像滞后），
    # 但历史回填可用，作为「2024 前全球景气」背景参考。UI 顶部明确标注口径。
    ("DE_IP", "GLOBAL"): dict(zh="德国工业产出", en="Germany IP", cat="全球工业", sub="G7",
                               unit="指数(2015=100)", freq="monthly", source="fred",
                               series="DEUPROINDMISMEI"),
    ("JP_IP", "GLOBAL"): dict(zh="日本工业产出", en="Japan IP", cat="全球工业", sub="G7",
                               unit="指数(2015=100)", freq="monthly", source="fred",
                               series="JPNPROINDMISMEI"),
    ("GB_IP", "GLOBAL"): dict(zh="英国工业产出", en="UK IP", cat="全球工业", sub="G7",
                               unit="指数(2015=100)", freq="monthly", source="fred",
                               series="GBRPROINDMISMEI"),
    ("CA_IP", "GLOBAL"): dict(zh="加拿大工业产出", en="Canada IP", cat="全球工业", sub="G7",
                               unit="指数(2015=100)", freq="monthly", source="fred",
                               series="CANPROINDMISMEI"),

    # ── 领先指标（FRED）──
    # 注：ISM 制造业 PMI（FRED: NAPM）已下架，实测返回 HTTP 400，故不纳入。
    # 替代方案用硬数据：核心资本品订单（NEWORDER）+ 产能利用率（TCU）+ 工业产出（INDPRO）。
    ("NFCI", "US"): dict(zh="芝加哥联储金融状况指数", en="Chicago Fed NFCI", cat="金融状况",
                         sub="压力指数", unit="指数", freq="weekly", source="fred",
                         series="NFCI"),
    ("ICSA", "US"): dict(zh="初请失业金人数", en="Initial Claims", cat="经济数据", sub="就业",
                         unit="人", freq="weekly", source="fred", series="ICSA"),
    ("UNRATE", "US"): dict(zh="失业率", en="Unemployment Rate", cat="经济数据", sub="就业",
                           unit="%", freq="monthly", source="fred", series="UNRATE"),
    ("PAYEMS", "US"): dict(zh="非农就业总数", en="All Employees Total Nonfarm", cat="经济数据",
                           sub="就业", unit="千人", freq="monthly", source="fred",
                           series="PAYEMS"),
    ("INDPRO", "US"): dict(zh="工业产出指数", en="Industrial Production Index", cat="经济数据",
                           sub="生产", unit="指数(2017=100)", freq="monthly", source="fred",
                           series="INDPRO"),
    ("CAPACITY_UTIL", "US"): dict(zh="产能利用率", en="Capacity Utilization", cat="经济数据",
                                  sub="生产", unit="%", freq="monthly", source="fred",
                                  series="TCU"),
    ("PERMIT", "US"): dict(zh="营建许可", en="Building Permits", cat="经济数据", sub="房地产",
                           unit="千套", freq="monthly", source="fred", series="PERMIT"),
    # NEWORDER 的 FRED 全名是 Manufacturers' New Orders: Nondefense Capital Goods
    # Excluding Aircraft，即「核心资本品订单」，不是 ISM 新订单 —— 名称不可混淆。
    ("CORE_CAPEX_ORDERS", "US"): dict(zh="核心资本品订单", en="Core Capital Goods Orders",
                                      cat="经济数据", sub="需求", unit="百万美元",
                                      freq="monthly", source="fred", series="NEWORDER"),
    ("CONSUMER_SENT", "US"): dict(zh="密歇根消费者信心", en="UoM Consumer Sentiment",
                                  cat="经济数据", sub="信心", unit="指数", freq="monthly",
                                  source="fred", series="UMCSENT"),
}


# =====================================================================
# 工具函数
# =====================================================================
def key_str(key):
    return "%s/%s" % (key[0], key[1])


def describe(spec):
    return "%s（%s）" % (spec["zh"], spec.get("series") or spec.get("fn"))


def _to_period(v):
    """把各种格式的日期单元统一成 YYYY-MM-DD 字符串。"""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, date):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    if not s or s.lower() in ("nan", "none", "nat"):
        return None
    m = re.search(r"(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2}))?", s)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        day = int(m.group(3)) if m.group(3) else 1
        try:
            return date(year, month, day).strftime("%Y-%m-%d")
        except ValueError:
            return None
    if re.fullmatch(r"\d{8}", s):
        try:
            return date(int(s[:4]), int(s[4:6]), int(s[6:8])).strftime("%Y-%m-%d")
        except ValueError:
            return None
    if re.fullmatch(r"\d{6}", s):
        try:
            return date(int(s[:4]), int(s[4:6]), 1).strftime("%Y-%m-%d")
        except ValueError:
            return None
    return None


def ensure_defs(keys):
    """把注册表里的定义 UPSERT 进 indicators 表。"""
    if not keys:
        return
    sql = (
        "INSERT INTO indicators (code, region, name_zh, name_en, category, sub_category, "
        "unit, frequency, source, description, is_active) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
        "ON DUPLICATE KEY UPDATE name_zh=VALUES(name_zh), name_en=VALUES(name_en), "
        "category=VALUES(category), sub_category=VALUES(sub_category), unit=VALUES(unit), "
        "frequency=VALUES(frequency), source=VALUES(source), description=VALUES(description), "
        "is_active=VALUES(is_active)"
    )
    params = []
    for key in keys:
        spec = INDICATORS[key]
        src = "FRED"
        params.append((
            key[0], key[1], spec["zh"], spec["en"], spec["cat"], spec["sub"],
            spec["unit"], spec["freq"], src, describe(spec), 1,
        ))
    with get_conn() as conn:
        with conn.cursor() as cur:
            try:
                cur.executemany(sql, params)
            except Exception as e:
                log.warning("批量注册指标失败，退化为逐行: %s", e)
                for p in params:
                    try:
                        cur.execute(sql, p)
                    except Exception as e2:
                        log.warning("  注册 %s/%s 失败: %s", p[0], p[1], e2)
        conn.commit()


def get_indicator_id(code, region):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM indicators WHERE code = %s AND region = %s LIMIT 1",
                (code, region),
            )
            row = cur.fetchone()
    return row["id"] if row else None


def latest_period(indicator_id):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT MAX(period_date) AS d FROM indicator_data WHERE indicator_id = %s",
                (indicator_id,),
            )
            row = cur.fetchone()
    d = (row or {}).get("d")
    if not d:
        return None
    return str(d)[:10]


# =====================================================================
# 取数：FRED
# =====================================================================
def fetch_fred(series_id, start_date=DEFAULT_START):
    """拉取 FRED 序列，返回 [(period_date, value)]（已剔除缺失值）。"""
    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "sort_order": "asc",
        "observation_start": start_date,
    }
    r = with_retry(requests.get, FRED_URL, params=params, timeout=30, max_retry=3)
    r.raise_for_status()
    rows = []
    for o in (r.json() or {}).get("observations", []):
        raw = str(o.get("value", "")).strip()
        if not raw or raw in (".", "NA", "NaN", "None"):
            continue
        v = safe_dec(raw, 6)
        if v is None:
            continue
        d = o.get("date")
        if not d:
            continue
        rows.append((str(d)[:10], float(v)))
    log.info("FRED %s -> %d 条", series_id, len(rows))
    return rows


# =====================================================================
# 同步引擎
# =====================================================================
def _upsert(indicator_id, rows):
    if not rows:
        return 0
    payload = [(indicator_id, d, v) for d, v in rows]
    with get_conn() as conn:
        with conn.cursor() as cur:
            return bulk_upsert(
                conn, cur, "indicator_data",
                ["indicator_id", "period_date", "value"],
                payload, ["indicator_id", "period_date"], ["value"],
            )


def _sync_one(key, full=False):
    spec = INDICATORS[key]
    ind_id = get_indicator_id(key[0], key[1])
    if ind_id is None:
        raise RuntimeError("indicators 表缺少 %s" % key_str(key))

    if full:
        start = DEFAULT_START
    else:
        last = latest_period(ind_id)
        if last is None:
            start = DEFAULT_START
        else:
            start = (date.fromisoformat(last) - timedelta(days=OVERLAP_DAYS)).isoformat()

    if spec["source"] != "fred":
        raise RuntimeError("unsupported source: %s (only 'fred' supported)" % spec["source"])
    rows = fetch_fred(spec["series"], start)

    rows = [(d, v) for d, v in rows if d >= start]
    if not rows:
        log.warning("%s 无新增数据（起点 %s）", key_str(key), start)
        return 0

    n = _upsert(ind_id, rows)
    log.info("%s 写入 %d 条（最新 %s）", key_str(key), n, rows[-1][0])
    return n


def sync_indicators(task, keys, full=False):
    """同步一组展示指标。

    :param task: 展示模块名（写入 data_sync_logs.sync_type）
    :param keys: [(code, region), ...]
    :param full: True 则忽略已有数据做全量回补
    :return: (写入行数, 错误列表)
    """
    log.info("=" * 60)
    log.info("开始同步展示模块数据: %s（%d 个指标）", task, len(keys))

    unknown = [k for k in keys if k not in INDICATORS]
    if unknown:
        log.error("注册表缺少定义: %s", [key_str(k) for k in unknown])

    valid = [k for k in keys if k in INDICATORS]
    ensure_defs(valid)

    total = 0
    errors = []
    for key in valid:
        if key in _SYNCED:
            log.info("%s 本轮已同步过，跳过（跨模块去重）", key_str(key))
            continue
        _SYNCED.add(key)
        try:
            total += _sync_one(key, full=full)
        except Exception as e:
            log.error("%s 同步失败: %s", key_str(key), e)
            errors.append("%s: %s" % (key_str(key), e))
        time.sleep(SLEEP_BETWEEN)

    status = "success" if not errors and total > 0 else ("partial" if total > 0 else "failed")
    msg = "共写入 %d 行；失败 %d 个；%s" % (total, len(errors), "; ".join(errors[:5]))
    log.info(msg)
    write_sync_log(task, status, total, msg)
    return total, errors


if __name__ == "__main__":
    print("展示指标注册表（%d 项）:" % len(INDICATORS))
    for (code, region), spec in sorted(INDICATORS.items()):
        src = spec.get("series") or spec.get("fn")
        print("  %-16s %-6s %-8s %s" % (code, region, spec["freq"], src))

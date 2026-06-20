#!/usr/bin/env python3
"""
同步核心龙头股财务指标 (PE/PB/PS/红利率/市值)
用法:
  python3 sync_core_stocks.py           # 拉全量
  python3 sync_core_stocks.py --daily   # 仅拉最新
"""

import sys
import os
import time
import logging
from datetime import datetime, date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Any

import pymysql
import akshare as ak

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
logger = logging.getLogger("sync_core_stocks")

DB_HOST = os.environ.get("DB_HOST", "204.44.121.43")
DB_PORT = int(os.environ.get("DB_PORT", "3306"))
DB_USER = os.environ.get("DB_USER", "mnigc")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "woaiyinyue.4")
DB_NAME = os.environ.get("DB_NAME", "invest_platform")

CORE_STOCKS = [
    ("601398", "工商银行", "银行"), ("601939", "建设银行", "银行"),
    ("601288", "农业银行", "银行"), ("601988", "中国银行", "银行"),
    ("600036", "招商银行", "银行"), ("601166", "兴业银行", "银行"),
    ("601318", "中国平安", "保险"), ("601628", "中国人寿", "保险"),
    ("601601", "中国太保", "保险"),
    ("600030", "中信证券", "券商"), ("601688", "华泰证券", "券商"),
    ("601211", "国泰君安", "券商"),
    ("600519", "贵州茅台", "白酒"), ("000858", "五粮液", "白酒"),
    ("002304", "洋河股份", "白酒"),
    ("600887", "伊利股份", "乳制品"), ("603288", "海天味业", "调味品"),
    ("601888", "中国中免", "旅游零售"),
    ("600276", "恒瑞医药", "医药"), ("603259", "药明康德", "医药"),
    ("300760", "迈瑞医疗", "医疗器械"), ("300015", "爱尔眼科", "医疗服务"),
    ("600436", "片仔癀", "中药"),
    ("300750", "宁德时代", "新能源"), ("002594", "比亚迪", "汽车"),
    ("601012", "隆基绿能", "光伏"), ("300274", "阳光电源", "光伏"),
    ("600438", "通威股份", "光伏"),
    ("000651", "格力电器", "家电"), ("000333", "美的集团", "家电"),
    ("600690", "海尔智家", "家电"),
    ("601899", "紫金矿业", "有色金属"), ("600547", "山东黄金", "有色金属"),
    ("002460", "赣锋锂业", "锂电"),
    ("601880", "辽港股份", "港口"), ("601006", "大秦铁路", "交通运输"),
    ("600048", "保利发展", "房地产"), ("000002", "万科A", "房地产"),
    ("600028", "中国石化", "石油"), ("601857", "中国石油", "石油"),
    ("601088", "中国神华", "煤炭"), ("601225", "陕西煤业", "煤炭"),
    ("600900", "长江电力", "电力"), ("600886", "国投电力", "电力"),
    ("600011", "华能国际", "电力"),
    ("601390", "中国中铁", "基建"), ("601186", "中国铁建", "基建"),
    ("601668", "中国建筑", "基建"),
    ("601899", "紫金矿业", "有色"), ("600362", "江西铜业", "有色"),
    ("000878", "云南铜业", "有色"),
    ("600585", "海螺水泥", "建材"), ("002415", "海康威视", "安防"),
    ("000063", "中兴通讯", "通信"), ("600941", "中国移动", "通信"),
    ("601728", "中国电信", "通信"),
    ("603259", "药明康德", "CXO"),
    ("300124", "汇川技术", "工控"), ("002049", "紫光国微", "芯片"),
    ("688981", "中芯国际", "半导体"), ("603501", "韦尔股份", "半导体"),
    ("002371", "北方华创", "半导体设备"),
    ("300059", "东方财富", "互联网券商"),
]


def get_conn():
    return pymysql.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
    )


def log_sync(sync_type, status, records_count=0, error_message=""):
    started_at = finished_at = time.strftime("%Y-%m-%d %H:%M:%S")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO data_sync_logs (sync_type,status,records_count,error_message,started_at,finished_at) VALUES (%s,%s,%s,%s,%s,%s)",
                (sync_type, status, records_count, error_message, started_at, finished_at),
            )
            conn.commit()
    finally:
        conn.close()


def init_table():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS core_stock_indicator (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    stock_code VARCHAR(20) NOT NULL,
                    stock_name VARCHAR(50) NOT NULL,
                    industry VARCHAR(50) NOT NULL,
                    trade_date DATE NOT NULL,
                    pe DECIMAL(12,4),
                    pe_ttm DECIMAL(12,4),
                    pb DECIMAL(12,4),
                    ps DECIMAL(12,4),
                    ps_ttm DECIMAL(12,4),
                    dv_ratio DECIMAL(8,4),
                    dv_ttm DECIMAL(8,4),
                    total_mv DECIMAL(18,2),
                    circ_mv DECIMAL(18,2),
                    UNIQUE KEY idx_code_date (stock_code, trade_date),
                    INDEX idx_industry (industry),
                    INDEX idx_trade_date (trade_date)
                )
            """)
        conn.commit()
    finally:
        conn.close()


def safe_decimal(v):
    if v is None:
        return None
    try:
        if str(v) in ("nan", "NaN", "None", ""):
            return None
        return Decimal(str(v)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    except:
        return None


def _run_with_timeout(fn, args=(), kwargs=None, timeout=20):
    import threading
    result = [None]
    exc = [None]
    def worker():
        try:
            result[0] = fn(*args, **(kwargs or {}))
        except Exception as e:
            exc[0] = e
    t = threading.Thread(target=worker, daemon=True)
    t.start()
    t.join(timeout)
    if t.is_alive():
        logger.warning(f"  API 请求超时（>{timeout}s）")
        return None
    if exc[0]:
        raise exc[0]
    return result[0]


def fetch_indicator(code):
    # 尝试多种 akshare 接口（乐咕已下线，优先东财接口）
    candidates = [
        ("stock_a_indicator_lg", {"symbol": code}),
        ("stock_a_lg_indicator", {"symbol": code}),
        # stock_a_indicator_em 返回全市场数据，过滤后取匹配的
    ]
    for func_name, kwargs in candidates:
        func = getattr(ak, func_name, None)
        if func is None:
            continue
        try:
            df = _run_with_timeout(func, kwargs=kwargs, timeout=15)
            if df is not None and not df.empty:
                return df
        except Exception as e:
            logger.warning(f"  {code}: {func_name} 失败: {e}")
            continue

    # 最后尝试 stock_a_indicator_em（东财全市场接口，需过滤）
    try:
        func = getattr(ak, "stock_a_indicator_em", None)
        if func:
            df = _run_with_timeout(func, timeout=20)
            if df is not None and not df.empty:
                # 查找匹配代码的行
                row = df[df["代码"] == code]
                if not row.empty:
                    # 构造与 save_indicator 兼容的格式
                    r = row.iloc[0]
                    import pandas as pd
                    return pd.DataFrame([{
                        "trade_date": datetime.now().strftime("%Y-%m-%d"),
                        "pe": r.get("市盈率-动态"),
                        "pe_ttm": r.get("市盈率-动态"),
                        "pb": r.get("市净率"),
                        "ps": None,
                        "ps_ttm": None,
                        "dv_ratio": r.get("股息率"),
                        "dv_ttm": r.get("股息率"),
                        "total_mv": r.get("总市值"),
                        "circ_mv": r.get("流通市值"),
                    }])
    except Exception as e:
        logger.warning(f"  {code}: stock_a_indicator_em 失败: {e}")

    logger.warning(f"  {code}: 所有 akshare 接口均不可用")
    return None


def save_indicator(cur, df, code, name, industry):
    count = 0
    for _, row in df.iterrows():
        try:
            td = str(row.get("trade_date", ""))
            if not td or "-" not in td:
                continue
            pe = safe_decimal(row.get("pe"))
            pe_ttm = safe_decimal(row.get("pe_ttm"))
            pb = safe_decimal(row.get("pb"))
            ps = safe_decimal(row.get("ps"))
            ps_ttm = safe_decimal(row.get("ps_ttm"))
            dv_ratio = safe_decimal(row.get("dv_ratio"))
            dv_ttm = safe_decimal(row.get("dv_ttm"))
            total_mv = safe_decimal(row.get("total_mv"))
            circ_mv = safe_decimal(row.get("circ_mv"))

            cur.execute(
                """INSERT INTO core_stock_indicator
                   (stock_code,stock_name,industry,trade_date,pe,pe_ttm,pb,ps,ps_ttm,dv_ratio,dv_ttm,total_mv,circ_mv)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON DUPLICATE KEY UPDATE
                   pe=VALUES(pe),pe_ttm=VALUES(pe_ttm),pb=VALUES(pb),ps=VALUES(ps),ps_ttm=VALUES(ps_ttm),
                   dv_ratio=VALUES(dv_ratio),dv_ttm=VALUES(dv_ttm),total_mv=VALUES(total_mv),circ_mv=VALUES(circ_mv)""",
                (code, name, industry, td, pe, pe_ttm, pb, ps, ps_ttm, dv_ratio, dv_ttm, total_mv, circ_mv),
            )
            count += 1
        except:
            continue
    return count


def main():
    daily_only = "--daily" in sys.argv
    init_table()
    total = 0

    logger.info("=" * 50)
    logger.info(f"开始同步核心龙头股财务指标 ({len(CORE_STOCKS)} 只)")

    for code, name, industry in CORE_STOCKS:
        df = fetch_indicator(code)
        if df is None:
            continue

        if daily_only:
            latest = df.iloc[-1:] if len(df) > 0 else df
            df = latest

        conn = get_conn()
        try:
            with conn.cursor() as cur:
                count = save_indicator(cur, df, code, name, industry)
                total += count
            conn.commit()
            logger.info(f"  {name} ({code}): {count} 条")
        finally:
            conn.close()
        time.sleep(0.5)

    logger.info(f"同步完成，共 {total} 条数据")
    log_sync("core_stock_indicator", "success", total, f"同步了 {len(CORE_STOCKS)} 只核心股票")


if __name__ == "__main__":
    main()

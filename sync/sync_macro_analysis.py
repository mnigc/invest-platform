#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示模块：宏观分析数据同步

同步以下模块所需的FRED指标数据：
1. 收益率曲线×宏观体制联动
2. 通胀预期锚定分析
3. 信用-利率交叉压力分析
4. 跨资产联动矩阵
5. 宏观信号一致性评分

数据源: FRED API
写入表: indicators, indicator_data, data_sync_logs
用法:
    python3 sync_macro_analysis.py
"""
import sys

from sync_base import _setup_logger, write_sync_log
from indicators import sync_indicators


log = _setup_logger("sync_macro_analysis")


def main():
    log.info("=" * 60)
    log.info("开始同步展示模块数据: 宏观分析")

    all_keys = [
        # 收益率曲线相关指标
        ("DGS3MO", "US"),
        ("DGS6MO", "US"),
        ("DGS1", "US"),
        ("DGS2", "US"),
        ("DGS5", "US"),
        ("DGS7", "US"),
        ("DGS10", "US"),
        ("DGS20", "US"),
        ("DGS30", "US"),
        ("T10Y2Y", "US"),
        ("T10Y3M", "US"),

        # 通胀预期相关指标
        ("T5YIE", "US"),
        ("T10YIE", "US"),
        ("T20YIE", "US"),
        ("DFII5", "US"),
        ("DFII10", "US"),
        ("DFII20", "US"),
        ("DFII30", "US"),

        # 信用利差相关指标
        ("BAMLC0A4CBBB", "US"),
        ("BAMLH0A0HYM2", "US"),
        ("BAMLC0A1CAAA", "US"),
        ("BAMLC0A2CAA", "US"),
        ("BAMLC0A5CIIO", "US"),

        # 波动率
        ("VIXCLS", "US"),

        # 流动性（全球）
        ("FED_BALANCE_SHEET", "GLOBAL"),
    ]

    total = 0
    errors = []

    try:
        written, errs = sync_indicators("macro_analysis", all_keys)
        total += written
        errors.extend(errs)
    except Exception as e:
        log.error("同步宏观分析指标失败: %s", e)
        errors.append(str(e))

    status = "success" if not errors and total > 0 else ("partial" if total > 0 else "failed")
    msg = "macro_analysis 写入 %d 行；失败 %d 项；%s" % (total, len(errors), "; ".join(errors[:5]))
    log.info(msg)
    write_sync_log("macro_analysis", status, total, msg)


if __name__ == "__main__":
    main()

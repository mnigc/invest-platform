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

    # 收益率曲线相关指标
    yield_curve_keys = [
        ("DGS3MO", "US"),   # 3个月美债收益率
        ("DGS6MO", "US"),   # 6个月美债收益率
        ("DGS1", "US"),     # 1年美债收益率
        ("DGS5", "US"),     # 5年美债收益率
        ("DGS7", "US"),     # 7年美债收益率
        ("DGS10", "US"),    # 10年美债收益率（可能已存在）
        ("DGS20", "US"),    # 20年美债收益率
        ("DGS30", "US"),    # 30年美债收益率
        ("T10Y2Y", "US"),   # 10Y-2Y利差
        ("T10Y3M", "US"),   # 10Y-3M利差
    ]

    # 通胀预期相关指标
    inflation_keys = [
        ("T5YIE", "US"),    # 5年盈亏平衡通胀
        ("T10YIE", "US"),   # 10年盈亏平衡通胀（可能已存在）
        ("T20YIE", "US"),   # 20年盈亏平衡通胀
        ("DFII5", "US"),    # 5年TIPS实际利率
        ("DFII10", "US"),   # 10年TIPS实际利率（可能已存在）
        ("DFII20", "US"),   # 20年TIPS实际利率
        ("DFII30", "US"),   # 30年TIPS实际利率
    ]

    # 信用利差相关指标
    credit_keys = [
        ("BAMLC0A4CBBB", "US"),    # BBB信用利差（可能已存在）
        ("BAMLH0A0HYM2", "US"),    # 高收益债利差
        ("BAMLC0A1CAAA", "US"),    # AAA信用利差
        ("BAMLC0A2CAA", "US"),     # AA信用利差
        ("BAMLC0A5CIIO", "US"),    # CCC及以下信用利差
    ]

    # 合并所有指标（去重）
    all_keys = list(set(yield_curve_keys + inflation_keys + credit_keys))

    total = 0
    errors = []

    # 同步所有指标
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

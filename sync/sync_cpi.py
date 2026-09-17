#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示模块：CPI 通胀（/indicators/cpi）

美国通胀全套价格指数：CPI、核心 CPI、PCE、核心 PCE、PPI，共 5 条 FRED 月频序列。
其中 ("CPI", "US") 与 regime / inflation_anchor 任务共用，取数引擎按 key 去重。

用途：通胀温度计与联储反应函数 —— 核心 PCE 是联储 2% 目标的正式锚，
PPI 领先 CPI 1-2 个季度，CPI − PCE 差值异常走阔提示结构性变化。

数据源: FRED
写入表: indicators, indicator_data, data_sync_logs
用法:
    python3 sync_cpi.py           # 增量
    python3 sync_cpi.py --full    # 全量回补
"""
import sys

from indicators import sync_indicators


# 与 src/pages/api/v1/cpi.json.ts 的 CODES 一一对应
KEYS = [
    ("CPI", "US"),
    ("CPILFESL", "US"),
    ("PCEPI", "US"),
    ("PCEPILFE", "US"),
    ("PPIACO", "US"),
]


def main():
    sync_indicators("cpi", KEYS, full="--full" in sys.argv)


if __name__ == "__main__":
    main()

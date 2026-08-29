#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示模块：全球流动性（/indicators/global-liquidity）

页面展示美联储 / 欧央行 / 日央行资产负债表与美元流动性工具，
共 6 条 FRED 序列。

数据源: FRED
写入表: indicators, indicator_data, data_sync_logs
用法:
    python3 sync_global_liquidity.py           # 增量
    python3 sync_global_liquidity.py --full    # 全量回补
"""
import sys

from indicators import sync_indicators


# 与 src/pages/api/v1/global-liquidity.json.ts 的 CODES 一一对应
KEYS = [
    ("FED_BALANCE_SHEET", "GLOBAL"),
    ("FED_RRP", "GLOBAL"),
    ("FED_TGA", "GLOBAL"),
    ("SOFR", "GLOBAL"),
    ("ECB_BALANCE_SHEET", "GLOBAL"),
    ("BOJ_BALANCE_SHEET", "GLOBAL"),
]


def main():
    sync_indicators("global_liquidity", KEYS, full="--full" in sys.argv)


if __name__ == "__main__":
    main()

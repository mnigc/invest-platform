#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示模块：全球流动性（/indicators/global-liquidity）

页面展示美联储 / 欧央行 / 日央行资产负债表、美元流动性工具，
以及货币市场利率底（IORB）、银行准备金、M1/M2 货币供应，共 10 条 FRED 序列。

IORB 与 BANK_RESERVES 补齐了知识图谱 liquidity.json 中「准备金 → SOFR」
这条此前有图无数据的传导边；SOFR-IORB 利差与 M1-M2 剪刀差由 API 层派生，
不在此入库。

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
    # 流动性缺口补齐：政策利率底 + 准备金水位 + 货币供应
    ("IORB", "GLOBAL"),
    ("BANK_RESERVES", "GLOBAL"),
    ("M1", "US"),
    ("M2", "US"),
]


def main():
    sync_indicators("global_liquidity", KEYS, full="--full" in sys.argv)


if __name__ == "__main__":
    main()

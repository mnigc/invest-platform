#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示模块：大宗商品（/indicators/commodities）

能源三件套（WTI、布伦特、Henry Hub 天然气）+ 金属两件套（铜、铁矿石），
共 5 条 FRED 序列，均为全球定价基准，region 归 GLOBAL。

用途：商品是通胀与总需求的前瞻验证器 —— 工业金属与能源同涨指向需求扩张，
能源涨而金属跌多为供给冲击，全线下跌则是需求收缩。

数据源: FRED
写入表: indicators, indicator_data, data_sync_logs
用法:
    python3 sync_commodities.py           # 增量
    python3 sync_commodities.py --full    # 全量回补
"""
import sys

from indicators import sync_indicators


# 与 src/pages/api/v1/commodities.json.ts 的 CODES 一一对应
KEYS = [
    ("WTI", "GLOBAL"),
    ("BRENT", "GLOBAL"),
    ("NATGAS", "GLOBAL"),
    ("COPPER", "GLOBAL"),
    ("IRON_ORE", "GLOBAL"),
]


def main():
    sync_indicators("commodities", KEYS, full="--full" in sys.argv)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示模块：中美 10Y 利差（/indicators/cn-us-spread）

页面主体是 10Y 中美国债利差曲线 + 分位，联动展示跨境资金
（页面同时请求 /api/v1/cross-border-flow.json：北向/南向资金 + USDCNY），
所以这两部分数据一起同步。

数据源: akshare（中国 10Y 国债、沪深港通资金）/ FRED（美债 10Y、USDCNY）
写入表: indicators, indicator_data, data_sync_logs
用法:
    python3 sync_cn_us_spread.py           # 增量
    python3 sync_cn_us_spread.py --full    # 全量回补
"""
import sys

from indicators import sync_indicators


# 利差: DGS10 + CN_TREASURY_10Y；跨境资金: NORTHBOUND/SOUTHBOUND + USDCNY
KEYS = [
    ("DGS10", "US"),
    ("CN_TREASURY_10Y", "CN"),
    ("NORTHBOUND_FLOW", "CN"),
    ("SOUTHBOUND_FLOW", "CN"),
    ("USDCNY", "US"),
]


def main():
    sync_indicators("cn_us_spread", KEYS, full="--full" in sys.argv)


if __name__ == "__main__":
    main()

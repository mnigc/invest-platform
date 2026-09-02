#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示模块：领先指标（/indicators/leading）

覆盖金融状况、就业、生产、地产、需求、信心六个维度，共 9 条 FRED 序列。
其中 NFCI 与 ICSA 为周频（时效性最好，是本页的核心价值），其余为月频。

Sahm Rule 衰退信号不在此入库，由 API 层用 UNRATE 单序列现算（零新增数据源）。

注：ISM 制造业 PMI（FRED: NAPM）实测已下架（HTTP 400），故改用硬数据替代 ——
核心资本品订单（NEWORDER）+ 产能利用率（TCU）+ 工业产出指数（INDPRO）。

数据源: FRED
写入表: indicators, indicator_data, data_sync_logs
用法:
    python3 sync_leading.py           # 增量
    python3 sync_leading.py --full    # 全量回补
"""
import sys

from indicators import sync_indicators


# 与 src/pages/api/v1/leading.json.ts 的 CODES 一一对应
KEYS = [
    ("NFCI", "US"),             # 周频
    ("ICSA", "US"),             # 周频
    ("UNRATE", "US"),           # 月频，Sahm Rule 依赖
    ("PAYEMS", "US"),
    ("INDPRO", "US"),
    ("CAPACITY_UTIL", "US"),
    ("PERMIT", "US"),
    ("CORE_CAPEX_ORDERS", "US"),
    ("CONSUMER_SENT", "US"),
]


def main():
    sync_indicators("leading", KEYS, full="--full" in sys.argv)


if __name__ == "__main__":
    main()

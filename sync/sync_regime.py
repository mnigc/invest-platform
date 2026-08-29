#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展示模块：宏观体制 + 风险异常（/signal-board 的顶部信号卡 /api/v1/regime*）

宏观体制判定用 6 路信号（增长 CFNAI、通胀 CPI、政策利率 FEDFUNDS、
曲线斜率 DGS10-DGS2、压力 VIXCLS/BBB、实际利率 DFII10/T10YIE），
风险异常在此基础上做阈值告警。

数据源: FRED
写入表: indicators, indicator_data, data_sync_logs
用法:
    python3 sync_regime.py           # 增量
    python3 sync_regime.py --full    # 全量回补
"""
import sys

from indicators import sync_indicators


# 与 src/pages/api/v1/regime.json.ts（含 [...path] 版）读取的指标一致
KEYS = [
    ("CPI", "US"),
    ("DGS10", "US"),
    ("DGS2", "US"),
    ("CFNAI", "US"),
    ("FEDFUNDS", "US"),
    ("DFII10", "US"),
    ("T10YIE", "US"),
    ("BAMLC0A4CBBB", "US"),
    ("VIXCLS", "US"),
]


def main():
    sync_indicators("regime", KEYS, full="--full" in sys.argv)


if __name__ == "__main__":
    main()

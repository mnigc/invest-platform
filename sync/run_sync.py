#!/usr/bin/env python3
"""统一数据同步调度入口。
用法:
    # 运行单个任务
    python run_sync.py us_assets
    python run_sync.py cn_indices --daily

    # 运行任务组
    python run_sync.py --group daily      # 交易日盘后任务
    python run_sync.py --group weekly     # 每周任务
    python run_sync.py --group monthly    # 每月任务

    # 查看所有任务
    python run_sync.py --list

    # 运行所有任务
    python run_sync.py --all
"""
import sys
import time
import importlib
from datetime import datetime

from sync_base import _setup_logger, write_sync_log


log = _setup_logger("run_sync")


TASKS = {
    "us_assets": {
        "name": "美国资产快照",
        "script": "fetch_us_assets",
        "group": "daily",
        "delay": 0,
        "args": [],
    },
    "us_asset_prices": {
        "name": "美股核心资产历史日线",
        "script": "fetch_us_asset_prices",
        "group": "weekly",
        "delay": 0,
        "args": [],
    },
    "us_macro_fred": {
        "name": "美国宏观FRED",
        "script": "fetch_us_macro_fred",
        "group": "weekly",
        "delay": 0,
        "args": [],
    },
    "us_market_pe": {
        "name": "S&P 500 PE",
        "script": "fetch_us_market_pe",
        "group": "daily",
        "delay": 5,
        "args": [],
    },
    "us_sectors": {
        "name": "美股板块ETF",
        "script": "fetch_us_sectors",
        "group": "daily",
        "delay": 10,
        "args": [],
    },
    "cn_indices": {
        "name": "中国指数日线",
        "script": "fetch_cn_indices",
        "group": "daily",
        "delay": 0,
        "args": ["--daily"],
    },
    "cn_macro": {
        "name": "中国宏观",
        "script": "fetch_cn_macro",
        "group": "weekly",
        "delay": 0,
        "args": [],
    },
    "cn_valuation": {
        "name": "A股估值",
        "script": "fetch_cn_valuation",
        "group": "weekly",
        "delay": 0,
        "args": [],
    },
    "cn_bonds": {
        "name": "中国国债收益率",
        "script": "fetch_cn_bonds",
        "group": "daily",
        "delay": 30,
        "args": ["--daily"],
    },
    "ism_pmi": {
        "name": "PMI数据",
        "script": "fetch_ism_pmi",
        "group": "monthly",
        "delay": 0,
        "args": [],
    },
    "northbound_flow": {
        "name": "北向南向资金",
        "script": "fetch_northbound_flow",
        "group": "daily",
        "delay": 60,
        "args": [],
    },
    "forex": {
        "name": "外汇数据",
        "script": "fetch_forex",
        "group": "daily",
        "delay": 5,
        "args": [],
    },
    "global_liquidity": {
        "name": "全球流动性",
        "script": "fetch_global_liquidity",
        "group": "daily",
        "delay": 0,
        "args": [],
    },
    "commodity_curves": {
        "name": "商品期货曲线",
        "script": "fetch_commodity_curves",
        "group": "daily",
        "delay": 20,
        "args": [],
    },
    "gold_reserves": {
        "name": "黄金储备与金价",
        "script": "fetch_gold_reserves",
        "group": "weekly",
        "delay": 0,
        "args": [],
    },
    "china_credit_pulse": {
        "name": "中国信贷脉冲",
        "script": "fetch_china_credit_pulse",
        "group": "monthly",
        "delay": 0,
        "args": [],
    },
    "etf_flow": {
        "name": "ETF资金流(份额/申赎)",
        "script": "fetch_etf_flow",
        "group": "daily",
        "delay": 120,
        "args": ["--daily"],
    },
}


def run_task(task_key):
    task = TASKS.get(task_key)
    if not task:
        log.error("未知任务: %s", task_key)
        return False

    log.info("-" * 60)
    log.info("开始执行: %s (%s)", task["name"], task_key)
    start_time = datetime.now()

    try:
        mod = importlib.import_module(task["script"])
        original_argv = sys.argv.copy()
        sys.argv = [task["script"] + ".py"] + task["args"]
        mod.main()
        sys.argv = original_argv
        elapsed = (datetime.now() - start_time).total_seconds()
        log.info("完成: %s - 耗时 %.1fs", task["name"], elapsed)
        return True
    except Exception as e:
        elapsed = (datetime.now() - start_time).total_seconds()
        log.error("失败: %s - 耗时 %.1fs - %s", task["name"], elapsed, e)
        write_sync_log("run_sync", "failed", 0, f"{task_key}: {e}")
        return False


def run_group(group_name):
    group_tasks = [k for k, v in TASKS.items() if v["group"] == group_name]
    if not group_tasks:
        log.error("未知任务组: %s", group_name)
        return

    log.info("=" * 60)
    log.info("开始执行任务组: %s (%d 个任务)", group_name, len(group_tasks))

    success_count = 0
    fail_count = 0

    for task_key in sorted(group_tasks):
        task = TASKS[task_key]
        if task["delay"] > 0:
            log.info("等待 %ds 后执行 %s", task["delay"], task_key)
            time.sleep(task["delay"])

        if run_task(task_key):
            success_count += 1
        else:
            fail_count += 1

        time.sleep(2)

    log.info("=" * 60)
    if fail_count == 0:
        status = "success"
        msg = f"任务组 {group_name} 全部完成: {success_count}/{len(group_tasks)}"
    elif success_count > 0:
        status = "partial"
        msg = f"任务组 {group_name} 部分完成: 成功 {success_count}, 失败 {fail_count}"
    else:
        status = "failed"
        msg = f"任务组 {group_name} 全部失败: {fail_count}/{len(group_tasks)}"
    log.info(msg)
    write_sync_log("run_sync", status, success_count, msg)


def print_usage():
    print("""统一数据同步调度入口

用法:
    python run_sync.py <task_key>           # 运行单个任务
    python run_sync.py --group daily        # 运行交易日任务组
    python run_sync.py --group weekly       # 运行每周任务组
    python run_sync.py --group monthly      # 运行每月任务组
    python run_sync.py --all                # 运行所有任务
    python run_sync.py --list               # 列出所有任务

任务列表:""")
    for key, task in sorted(TASKS.items()):
        print(f"  {key:20} - {task['name']} (组: {task['group']})")


def main():
    if len(sys.argv) < 2:
        print_usage()
        return

    arg = sys.argv[1]

    if arg == "--list":
        print_usage()
        return

    if arg == "--all":
        log.info("开始执行所有任务")
        for group in ["daily", "weekly", "monthly"]:
            run_group(group)
        return

    if arg == "--group":
        if len(sys.argv) < 3:
            print("请指定任务组: --group daily|weekly|monthly")
            return
        run_group(sys.argv[2])
        return

    if arg in TASKS:
        run_task(arg)
        return

    print(f"未知任务或参数: {arg}")
    print_usage()


if __name__ == "__main__":
    main()

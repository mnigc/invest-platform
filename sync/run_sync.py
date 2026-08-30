#!/usr/bin/env python3
"""统一数据同步调度入口。
用法:
    # 运行单个任务
    python run_sync.py us_assets
    python run_sync.py cn_indices --daily

    # 运行任务组
    python run_sync.py --group daily      # 交易日盘后任务（全部展示模块）

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

# 任务分组（按展示模块的数据频率划分；目前全部展示模块都是日频数据源）
GROUPS = ["daily"]


# 任务按「展示模块」组织：每个任务 = 一个页面/信号卡的完整数据供给。
# 指标定义与取数逻辑统一在 indicators.py（注册表 + 增量引擎），
# 跨模块共用的指标（DGS10 / VIXCLS / DFII10 …）同一次运行只拉一次。
TASKS = {
    "global_liquidity": {
        "name": "全球流动性（央行资产负债表/SOFR）",
        "script": "sync_global_liquidity",
        "group": "daily",
        "delay": 10,
        "args": [],
    },
    "gold_decision": {
        "name": "黄金决策（金价/DXY/实际利率）",
        "script": "sync_gold_decision",
        "group": "daily",
        "delay": 20,
        "args": [],
    },
    "regime": {
        "name": "宏观体制与风险异常",
        "script": "sync_regime",
        "group": "daily",
        "delay": 5,
        "args": [],
    },
    "sp500": {
        "name": "S&P500 指数（宏观体制回测）",
        "script": "sync_sp500",
        "group": "daily",
        "delay": 15,
        "args": [],
    },
    "gold_reserves": {
        "name": "全球央行黄金储备变动",
        "script": "sync_gold_reserves",
        "group": "daily",
        "delay": 0,
        "args": ["--fred"],
    },
    "regime_backtest": {
        "name": "宏观体制回测（预计算）",
        "script": "sync_regime_backtest",
        "group": "daily",
        "delay": 0,
        "args": [],
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
        for group in GROUPS:
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

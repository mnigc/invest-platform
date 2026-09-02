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
    "commodities": {
        "name": "大宗商品（WTI/布伦特/铜/铁矿/天然气）",
        "script": "sync_commodities",
        "group": "daily",
        "delay": 8,
        "args": [],
    },
    "leading": {
        "name": "领先指标（金融状况/就业/生产/地产/需求/信心）",
        "script": "sync_leading",
        "group": "daily",
        "delay": 8,
        "args": [],
    },
    "regime": {
        "name": "宏观体制与风险异常",
        "script": "sync_regime",
        "group": "daily",
        "delay": 5,
        "args": [],
    },
    "indices": {
        "name": "美股四大指数（宏观体制回测/指数对比）",
        "script": "sync_indexes",
        "group": "daily",
        "delay": 15,
        "args": [],
    },
    "regime_backtest": {
        "name": "宏观体制回测（预计算）",
        "script": "sync_regime_backtest",
        "group": "daily",
        "delay": 0,
        "args": [],
    },
    "macro_analysis": {
        "name": "宏观分析（收益率曲线/通胀预期/信用利差）",
        "script": "sync_macro_analysis",
        "group": "daily",
        "delay": 25,
        "args": [],
    },
    "analysis_cross_asset": {
        "name": "预计算：跨资产相关性矩阵",
        "script": "sync_cross_asset",
        "group": "daily",
        "delay": 0,
        "args": [],
    },
    "analysis_macro_consensus": {
        "name": "预计算：宏观信号一致性评分",
        "script": "sync_macro_consensus",
        "group": "daily",
        "delay": 0,
        "args": [],
    },
    "analysis_credit_stress": {
        "name": "预计算：信用-利率交叉压力",
        "script": "sync_credit_stress",
        "group": "daily",
        "delay": 0,
        "args": [],
    },
    "analysis_liquidity": {
        "name": "预计算：全球流动性分析（净流动性/分位/z-score/前瞻收益）",
        "script": "sync_analysis_liquidity",
        "group": "daily",
        "delay": 0,
        "args": [],
    },
    "analysis_inflation_anchor": {
        "name": "预计算：通胀预期锚定分析",
        "script": "sync_inflation_anchor",
        "group": "daily",
        "delay": 0,
        "args": [],
    },
    "analysis_yield_curve": {
        "name": "预计算：收益率曲线×宏观体制",
        "script": "sync_yield_curve",
        "group": "daily",
        "delay": 0,
        "args": [],
    },
    "analysis_gold_correlation": {
        "name": "预计算：黄金定价残差 + 美元关联信号",
        "script": "sync_gold_correlation",
        "group": "daily",
        "delay": 0,
        "args": [],
    },
}

# 执行顺序（重要）：analysis_* 是「预计算层」，必须跑在「取数层」之后。
# 它们读的是 indicators / indicator_data / asset_prices / regime_snapshots，
# 若提前执行会用到上一轮数据（恒定滞后一天），空库首次运行则必然全失败。
# 注：此前用 sorted() 按 key 字母序执行，恰好把 6 个 analysis_* 全排到最前，属 bug。
TASK_ORDER = [
    # —— 取数层 ——
    "indices",            # 美股指数 / 金价 / DXY（走网络源，耗时最长）
    "gold_decision",
    "global_liquidity",
    "commodities",
    "leading",
    "regime",
    "macro_analysis",
    "regime_backtest",    # 产出 regime_snapshots，analysis_yield_curve 依赖它
    # —— 预计算层 ——
    "analysis_cross_asset",
    "analysis_macro_consensus",
    "analysis_credit_stress",
    "analysis_liquidity",
    "analysis_inflation_anchor",
    "analysis_yield_curve",
    "analysis_gold_correlation",
]


def _ordered(task_keys):
    """按 TASK_ORDER 排序；未登记的任务排在末尾（字母序，便于发现遗漏）。"""
    idx = {k: i for i, k in enumerate(TASK_ORDER)}
    n = len(TASK_ORDER)
    return sorted(task_keys, key=lambda k: (idx.get(k, n), k))


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

    for task_key in _ordered(group_tasks):
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
    return fail_count == 0


def print_usage():
    print("""统一数据同步调度入口

用法:
    python run_sync.py <task_key>           # 运行单个任务
    python run_sync.py --group daily        # 运行交易日任务组
    python run_sync.py --all                # 运行所有任务
    python run_sync.py --list               # 列出所有任务

任务列表:""")
    for key in _ordered(TASKS.keys()):
        task = TASKS[key]
        print(f"  {key:26} - {task['name']} (组: {task['group']})")


def main():
    if len(sys.argv) < 2:
        print_usage()
        sys.exit(1)

    arg = sys.argv[1]

    if arg == "--list":
        print_usage()
        return

    if arg == "--all":
        log.info("开始执行所有任务")
        # 逐个跑完再汇总，避免 all() 短路导致后续组被跳过
        results = [run_group(group) for group in GROUPS]
        sys.exit(0 if all(results) else 1)

    if arg == "--group":
        if len(sys.argv) < 3:
            print("请指定任务组: --group daily|weekly|monthly")
            sys.exit(1)
        sys.exit(0 if run_group(sys.argv[2]) else 1)

    if arg in TASKS:
        # 任务失败必须体现在退出码上，否则 CI 无法感知（此前恒为 0，失败被静默吞掉）
        sys.exit(0 if run_task(arg) else 1)

    print(f"未知任务或参数: {arg}")
    print_usage()
    sys.exit(1)


if __name__ == "__main__":
    main()

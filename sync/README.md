# 数据同步脚本

按**展示模块**组织：一个脚本对应一个页面（或一组同源信号）的完整数据供给。
指标定义与取数逻辑集中在 `indicators.py`（注册表 + 增量引擎），脚本只声明「我要哪些指标」。

```
sync/
├── indicators.py            # 指标注册表 + 同步引擎（FRED）
├── sync_base.py             # 连接、日志、重试、MySQL→PostgreSQL SQL 适配、批量 UPSERT
│                            #   + upsert_analysis_result()（预计算 payload 写入，含 NaN 清理）
├── analysis.py              # 统计/相关性/事件研究纯函数（预计算脚本共用）
├── run_sync.py              # 统一调度入口（按依赖顺序执行）
├── verify_db.py             # 连接、表清单、预计算端点自检
├── # ── 取数层 ──
├── sync_indexes.py          # 美股四大指数
├── sync_gold_decision.py    # 黄金决策
├── sync_global_liquidity.py # 全球流动性
├── sync_regime.py           # 宏观体制与风险异常
├── sync_macro_analysis.py   # 宏观分析交叉数据（FRED）
├── sync_regime_backtest.py  # 预计算：体制回测快照
├── # ── 预计算层（写 analysis_results）──
├── sync_cross_asset.py      # 跨资产相关性矩阵
├── sync_macro_consensus.py  # 宏观信号一致性评分
├── sync_credit_stress.py    # 信用-利率交叉压力
├── sync_inflation_anchor.py # 通胀预期锚定分析
├── sync_yield_curve.py      # 收益率曲线 × 宏观体制
└── sync_gold_correlation.py # 黄金定价残差 + 美元关联信号
```

---

## 1. 任务与展示模块对应

**取数层**（写 `indicator_data` / `asset_prices` / `gold_price_history` / `regime_snapshots`）：

| 任务 key | 展示模块（页面） | 同步内容 | 数据源 |
|---|---|---|---|
| `indices` | 宏观体制回测 / 指数对比 | 美股四大指数日线 | stooq → Yahoo（降级） |
| `gold_decision` | 黄金决策 | 金价历史（GC=F）+ 今日金价、美元指数 DXY、DFII10、T10YIE | gold-api + Yahoo + FRED |
| `global_liquidity` | 全球流动性 | 美联储/欧央行/日央行总资产、RRP、TGA、SOFR | FRED |
| `regime` | 宏观体制 / 风险异常 | CPI、DGS10、DGS2、CFNAI、FEDFUNDS、DFII10、T10YIE、BBB 信用利差、VIXCLS | FRED |
| `macro_analysis` | 宏观分析交叉数据 | 收益率曲线 / 通胀预期 / 信用利差等 22 个指标 | FRED |
| `regime_backtest` | 宏观体制回测 | 体制快照 + 多指数×体制回测矩阵 | 读库计算 |

**预计算层**（读上面的结果，算完写 `analysis_results` 表）：

| 任务 key | 展示模块（页面） | 端点 |
|---|---|---|
| `analysis_cross_asset` | 跨资产相关性 | `analysis/cross-asset-correlation` |
| `analysis_macro_consensus` | 宏观共识 | `analysis/macro-consensus` |
| `analysis_credit_stress` | 信用压力监测 | `analysis/credit-stress` |
| `analysis_inflation_anchor` | 通胀预期锚定 | `analysis/inflation-anchor` |
| `analysis_yield_curve` | 收益率曲线体制 | `analysis/yield-curve-regime` |
| `analysis_gold_correlation` | 黄金定价残差 | `gold/correlation` |

> 组合信号板 `/signal-board` 不单独同步数据，它直接聚合上面各模块的 API。
> 知识图谱 `/knowledge` 使用仓库内的静态 JSON，无需同步。

### 1.1 执行顺序：预计算必须在取数之后

`analysis_*` 任务读的是取数层写好的库表，**顺序颠倒会用到上一轮数据（恒定滞后一天），
空库首次运行则必然全部失败**。`run_sync.py` 用 `TASK_ORDER` 显式定义顺序，
`--group` / `--all` 均按此执行（早期版本用 `sorted()` 按 key 字母序，恰好把 6 个
`analysis_*` 排到最前，是个已修复的 bug）。

新增任务时**务必**把 key 加进 `TASK_ORDER`，未登记的会排在末尾并可能破坏依赖。

---

## 2. 快速开始

```bash
cd /opt/macro
python3 -m venv .venv
/opt/macro/.venv/bin/python3 -m pip install -r requirements.txt
```

### 运行

```bash
cd /opt/macro

# 查看所有任务
/opt/macro/.venv/bin/python3 run_sync.py --list

# 单个任务
/opt/macro/.venv/bin/python3 run_sync.py gold_decision

# 任务组
/opt/macro/.venv/bin/python3 run_sync.py --group daily    # 每交易日盘后

# 全部
/opt/macro/.venv/bin/python3 run_sync.py --all
```

### 任务分组

| 组 | 任务数 | 包含 |
| --- | --- | --- |
| **daily** | 12 | 6 个取数任务 + 6 个预计算任务，见上一节 |

> 任务失败会让 `run_sync.py` 以**退出码 1** 结束（此前恒为 0，失败被 CI 静默吞掉）。
> CI / 定时任务据此判定成功与否。

### 全量回补

指标类脚本支持 `--full`（忽略已有最新日期，从 2000 年起全量拉取）：

```bash
/opt/macro/.venv/bin/python3 sync_regime.py --full
```

---

## 3. 1Panel 定时任务

只需配置 **1 个任务**：

```
任务名称: 数据同步-每日
执行周期: 自定义 cron  30 23 * * 1-5
命令: cd /opt/macro && /opt/macro/.venv/bin/python3 run_sync.py --group daily
```

> 时间以服务器时区为准，`1-5` = 周一到周五。

### 3.1 GitHub Actions（补充，非主用）

项目内置 `.github/workflows/sync.yml`，可用 GitHub 托管 runner 定时同步：

- **定时**：每个交易日 23:30（北京时间）执行（GitHub cron 用 UTC，即 `30 15 * * 1-5`）
- **执行内容**：4 个取数任务（`gold_decision` / `indices` / `regime_backtest` / `macro_analysis`）
  + 6 个预计算任务（`analysis_*`），按依赖顺序排列
- **手动触发**：Actions 页面 → run workflow → 可随时补跑

需要在仓库 **Settings → Secrets and variables → Actions** 配置两个 secret：

| Secret 名称 | 值 |
| --- | --- |
| `DATABASE_URL` | Supabase Session Pooler 连接串（同 `.env`） |
| `FRED_API_KEY` | FRED API Key |

> 说明：金价历史 + DXY 走 Yahoo，需境外网络，故 `gold_decision` 在 GitHub Actions(海外) 跑；
> 其余国际源（FRED）任务在 1Panel 服务器定时跑。数据库连接已强制走 IPv4。

> ⚠️ 在新环境首次启用前，先在 Supabase 执行 `supabase_schema.sql` 建表
> （含 `analysis_results`），否则 6 个预计算任务会因表不存在而失败。
> 建表后可用 `python3 verify_db.py` 确认 11 张表 + 6 个端点就绪。

---

## 4. 指标注册表（indicators.py）

新增一个展示指标只需在 `INDICATORS` 里加一行，`ensure_defs()` 会自动把
中文名/单位/频率/数据源 UPSERT 进 `indicators` 表：

```python
("DGS10", "US"): dict(zh="美债收益率 10Y", en="US Treasury 10Y", cat="利率",
                      sub="美债收益率", unit="%", freq="daily",
                      source="fred", series="DGS10"),
```

- `source="fred"` → `series` 为 FRED series id
- 跨模块共用的指标（如 DGS10 同时被 regime / gold_decision 使用）在同一次 `run_sync`
  进程内只会真正拉取一次，日志里显示「本轮已同步过，跳过」

```bash
/opt/macro/.venv/bin/python3 indicators.py   # 打印注册表清单
```

---

## 5. 故障排查

```sql
-- 查看同步日志
SELECT sync_type, status, records_count, error_message, finished_at
FROM data_sync_logs ORDER BY finished_at DESC LIMIT 20;
```

```bash
# 脚本日志
tail -100 /opt/macro/sync/logs/run_sync_*.log
tail -100 /opt/macro/sync/logs/sync_gold_decision_*.log

# 数据库自检（连接 + 表清单 + 每表记录数/最新日期）
export DATABASE_URL='postgresql://postgres.xxxx:******@aws-0-*.pooler.supabase.com:5432/postgres'
python3 verify_db.py
```

---

## 6. 数据库配置（Supabase / PostgreSQL）

1. 在 [supabase_schema.sql](supabase_schema.sql) 全量建表（Supabase Dashboard → SQL Editor 执行一次）。
2. 复制连接串（Project Settings → Database → Session Pooler）：
   ```
   postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
3. 配置环境变量（每个运行终端 export，或写入服务器的 ~/.bashrc / 1Panel 任务环境）：
   ```bash
   export DATABASE_URL='postgresql://postgres.xxxx:******@aws-0-*.pooler.supabase.com:5432/postgres'
   export FRED_API_KEY='<your fred api key>'
   ```

> `sync_base.py` 内含 MySQL→PostgreSQL SQL 适配层（ON DUPLICATE KEY UPDATE → ON CONFLICT 等），脚本无需改动即可运行。

---

## 7. 本地文件依赖

`sync_gold_decision.py` 已移除本地 Excel 依赖，金价历史改为从 Yahoo Finance 拉取（GC=F），
不再需要 `gold_price.xlsx` / `gold_changes.xlsx`，也不依赖本地文件。

# 数据同步脚本

按**展示模块**组织：一个脚本对应一个页面（或一组同源信号）的完整数据供给。
指标定义与取数逻辑集中在 `indicators.py`（注册表 + 增量引擎），脚本只声明「我要哪些指标」。

```
sync/
├── indicators.py           # 指标注册表 + 同步引擎（FRED / akshare）
├── sync_base.py            # 连接、日志、重试、MySQL→PostgreSQL SQL 适配、批量 UPSERT
├── run_sync.py             # 统一调度入口
├── sync_regime.py          # 宏观体制与风险异常 /signal-board
├── sync_cn_us_spread.py    # 中美 10Y 利差 + 跨境资金 /indicators/cn-us-spread
├── sync_global_liquidity.py# 全球流动性 /indicators/global-liquidity
├── sync_gold_decision.py   # 黄金决策 /signals/gold
├── sync_etf_flow.py        # 国家队资金 /tracking/etf-flow
└── verify_db.py            # 连接与表清单自检
```

---

## 1. 任务与展示模块对应

| 任务 key | 展示模块（页面） | 同步内容 | 数据源 |
|---|---|---|---|
| `etf_flow` | 国家队资金 | ETF 日线行情 + 交易所份额（净申赎/申赎成交比）+ 沪深300 日线 | akshare + Yahoo |
| `cn_us_spread` | 中美 10Y 利差 | DGS10、中国 10Y 国债、北向/南向资金、USDCNY | akshare + FRED |
| `global_liquidity` | 全球流动性 | 美联储/欧央行/日央行总资产、RRP、TGA、SOFR | FRED |
| `gold_decision` | 黄金决策 | 金价历史（GC=F）+ 今日金价、美元指数 DXY、DFII10、T10YIE | gold-api + Yahoo + FRED |
| `regime` | 宏观体制 / 风险异常 | CPI、DGS10、DGS2、CFNAI、FEDFUNDS、DFII10、T10YIE、BBB 信用利差、VIXCLS | FRED |

> 组合信号板 `/signal-board` 不单独同步数据，它直接聚合上面各模块的 API。
> 知识图谱 `/knowledge` 使用仓库内的静态 JSON，无需同步。

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
| **daily** | 5 | 国家队资金、宏观体制、黄金决策、全球流动性、中美利差 |

### 全量回补

指标类脚本支持 `--full`（忽略已有最新日期，从 2000 年起全量拉取）：

```bash
/opt/macro/.venv/bin/python3 sync_regime.py --full
/opt/macro/.venv/bin/python3 sync_etf_flow.py --full --since 20230101
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

- **定时**：每个交易日 23:30（北京时间）执行 `run_sync.py --group daily`（GitHub cron 用 UTC，即 `30 15 * * 1-5`）
- **手动触发**：Actions 页面 → run workflow → 可随时补跑

需要在仓库 **Settings → Secrets and variables → Actions** 配置两个 secret：

| Secret 名称 | 值 |
| --- | --- |
| `DATABASE_URL` | Supabase Session Pooler 连接串（同 `.env`） |
| `FRED_API_KEY` | FRED API Key |

> 注意：**主用同步建议放在 1Panel 服务器（境内）跑**，国内数据源（akshare/东财/沪深交所）在境内直连最稳。
> GitHub runner 在海外，akshare 拉取国内数据会超时并降级为空——FRED/Yahoo/gold-api 等国际数据不受影响。
> 数据库连接已强制走 IPv4，GitHub runner 无需 IPv6。
> 金价历史来自 Yahoo Finance（GC=F），无需本地文件。失败时可在 Actions 页面查看 `sync-logs` 产物日志。

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
- `source="akshare"` → `fn` 为 akshare 函数名；宽表用 `date_col` / `value_col` 指定列，
  省略则按「首个日期单元 + 首个正数数值单元」自动推断
- 跨模块共用的指标（如 DGS10 同时被 regime / cn_us_spread 使用）在同一次 `run_sync`
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

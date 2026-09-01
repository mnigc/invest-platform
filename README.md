# Invest Platform

宏观投资决策分析平台（黄金决策 / 宏观体制 / 全球流动性 / 组合信号板）。

## 技术栈

- **前端/服务**: Astro + React + ECharts
- **数据库**: Supabase (PostgreSQL) — 建表执行 [sync/supabase_schema.sql](sync/supabase_schema.sql)
- **数据同步**: `sync/` Python 脚本（yfinance / FRED / gold-api），自动写入 Supabase
- **CI/CD**: GitHub Actions 每交易日自动同步数据

## 功能模块

| 模块 | 路由 | 说明 |
|------|------|------|
| 组合信号板 | `/signal-board` | 多模块信号加权综合评分 |
| 黄金决策 | `/signals/gold` | 金价-美元相关性、双因子定价残差、央行购金、动量指标 |
| 全球流动性 | `/indicators/global-liquidity` | 美联储/欧央行/日央行资产负债表、净流动性 |
| 知识图谱 | `/knowledge` | 通胀/通缩/滞胀/利率知识节点 |

## 本地开发

```bash
npm install
# .env 内设置 DATABASE_URL（Supabase Session Pooler 连接串）
npm run dev
```

## 数据同步脚本

生产数据由 `sync/` 目录下的独立 Python 脚本写入 Supabase（PostgreSQL），脚本自带连接、SQL 适配层、日志记录和重试机制。

### 同步任务

| 任务 | 说明 | 数据源 |
|------|------|--------|
| `gold_decision` | 金价/DXY/实际利率 | Yahoo Finance, gold-api, FRED |
| `sp500` | S&P500 指数（宏观体制回测） | Yahoo Finance / stooq.com |
| `gold_reserves` | 全球央行黄金储备变动 | FRED API |
| `global_liquidity` | 全球央行资产负债表/SOFR | FRED |
| `regime` | 宏观体制与风险异常 | FRED |

### 运行方式

```bash
cd sync
python run_sync.py <task_key>     # 运行单个任务
python run_sync.py --group daily  # 运行所有日频任务
python run_sync.py --list         # 查看所有任务
```

### GitHub Actions

数据同步通过 GitHub Actions 自动执行：
- **触发时间**: 每交易日 23:30 北京时间（UTC 15:30）
- **手动触发**: GitHub Actions 页面点击 "Run workflow"
- **日志**: 运行日志上传为 Artifact，保留 14 天

详见 [sync/README.md](sync/README.md) 获取更多配置说明。

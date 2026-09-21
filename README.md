# Invest Platform

宏观投资决策分析平台（黄金决策 / 宏观体制 / 全球流动性 / 组合信号板）。

## 技术栈

- **前端/服务**: Astro + React + ECharts，部署在 Cloudflare Workers
- **数据库**: Supabase (PostgreSQL) — 建表执行 [sync/supabase_schema.sql](sync/supabase_schema.sql)
  - 读写通路是混合的：运行时（SSR API）经 Supavisor 连接池用 `@neondatabase/serverless` 的 WebSocket 协议；`sync/` 脚本用 psycopg2 直连。两者共用同一套表。
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

## SEO

项目对搜索引擎（Google / Bing / 百度 / 360 / 搜狗 / 神马）已做基础优化：

- **静态预渲染**（`prerender = true`）—— 所有页面构建期生成完整 HTML，爬虫零 JS 即可索引
- **每页独立** `<title>` / `description` / `canonical` / Open Graph / Twitter Card
- **JSON-LD 结构化数据** —— 知识图谱页（`Article` + `FAQPage`，可直接出"人们也问"卡片），指标 / 信号 / 分析页（`Dataset`）
- **`/sitemap-index.xml`** + **`/rss.xml`**（构建时自动生成）
- **`/robots.txt`**（允许 Baiduspider / 360 / 搜狗 / 神马 / 字节 / GPTBot / Claude 等）

部署后需在站长平台提交 sitemap：

- Google Search Console：`https://search.google.com/search-console`
- Bing Webmaster：`https://www.bing.com/webmasters`
- 百度站长平台：`https://ziyuan.baidu.com`

站点域名统一在 `astro.config.mjs` 的 `site` 配置，默认即生产域名
`https://invest.soulcreator.cn`（sitemap / rss / canonical / JSON-LD 均由此派生）。
预览环境等场景可用环境变量覆盖：

```bash
SITE_URL=https://preview.example.com npm run build
```

## 数据同步脚本

生产数据由 `sync/` 目录下的独立 Python 脚本写入 Supabase（PostgreSQL），脚本自带连接、SQL 适配层、日志记录和重试机制。

### 同步任务

任务清单以调度入口为单一事实来源（当前共 17 个：10 个取数 + 7 个预计算）。
各任务的名称、说明、数据源与执行顺序均由 `run_sync.py` 的 `TASKS / TASK_ORDER` 维护，
本文档不再重复罗列，以免漂移。

### 运行方式

```bash
cd sync
python run_sync.py <task_key>     # 运行单个任务
python run_sync.py --group daily  # 运行所有日频任务
python run_sync.py --list         # 查看所有任务
```

### GitHub Actions

数据同步通过 GitHub Actions 自动执行：
- **触发时间**: 每交易日 UTC 23:30（美东冬令时 18:30 / 夏令时 19:30，北京时间次日 07:30）——必须在美国收盘与 FRED 当日数据发布之后，否则会把盘中价写成当日收盘
- **手动触发**: GitHub Actions 页面点击 "Run workflow"
- **日志**: 运行日志上传为 Artifact，保留 14 天；同步失败时自动开 GitHub issue 提醒

详见 [sync/README.md](sync/README.md) 获取更多配置说明。

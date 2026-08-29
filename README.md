# Invest Platform

中美宏观决策分析平台（黄金决策 / 国家队资金追踪 / 组合信号板）。

## 技术栈

- **前端/服务**: Astro + React + ECharts
- **数据库**: Supabase (PostgreSQL) — 建表执行 [sync/supabase_schema.sql](sync/supabase_schema.sql)
- **数据同步**: `sync/` Python 脚本（akshare / yfinance / FRED），自动写入 Supabase

## 本地开发

```bash
npm install
# .env 内设置 DATABASE_URL（Supabase Session Pooler 连接串）
npm run dev
```

## 数据同步脚本

生产数据由 `sync/` 目录下的独立 Python 脚本写入 Supabase（PostgreSQL），脚本自带连接、SQL 适配层、日志记录和重试机制。

详见 [sync/README.md](sync/README.md) 获取：

- 脚本列表与推荐运行频率
- 虚拟环境安装与 1Panel 定时任务配置
- 手动运行命令与故障排查

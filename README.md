# Invest Platform

中美宏观分析平台。

## 技术栈

- **前端**: Astro + React
- **数据库**: MariaDB

## 本地开发

```bash
npm install
npm run dev
```

## 数据同步脚本

生产数据由 `sync/` 目录下的独立 Python 脚本写入 MariaDB，脚本自带数据库连接、日志记录和重试机制。

详见 [sync/README.md](sync/README.md) 获取：

- 脚本列表与推荐运行频率
- 虚拟环境安装与 1Panel 定时任务配置
- 手动运行命令与故障排查

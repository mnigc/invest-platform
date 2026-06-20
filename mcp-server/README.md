# TRAE Work MCP Server 使用说明

## 概述
这个 MCP Server 用于接收 TRAE Work 自动化任务的结果，并将其保存到 invest-platform 数据库中。

## 架构
```
TRAE Work 自动化任务 ──→ 调用 MCP 工具 ──→ MCP Server ──→ MariaDB 数据库
```

## 安装步骤

### 1. 创建数据库表
在 MariaDB 中执行迁移脚本：
```bash
mysql -h <host> -P <port> -u <user> -p invest_platform < migration_automation_results.sql
```

### 2. 配置环境变量
复制 `.env.example` 为 `.env` 并填写数据库配置：
```bash
cd mcp-server
cp .env.example .env
```

编辑 `.env` 文件：
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=invest_platform
```

### 3. 构建项目
```bash
npm install
npm run build
```

### 4. 在 TRAE 中配置 MCP Server
在 TRAE Work 的 MCP 配置中添加：
```json
{
  "mcpServers": {
    "invest-platform": {
      "command": "node",
      "args": ["d:/project/invest-platform/mcp-server/dist/index.js"],
      "cwd": "d:/project/invest-platform/mcp-server"
    }
  }
}
```

## 使用方法

### 在 TRAE Work 自动化任务中调用

在自动化任务的指令中明确要求调用 `push_result` 工具：

```
任务完成后，请调用 push_result 工具推送结果，参数如下：
- task_name: "sync_cn_stocks"
- task_type: "data_sync"
- status: "success" 或 "failed"
- result_data: { "records_count": 100, "details": "..." }
- error_message: "错误信息"（如果失败）
```

### 工具参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_name | string | 是 | 任务名称，如 `sync_cn_stocks`, `update_indicators` |
| task_type | string | 是 | 任务类型，如 `data_sync`, `analysis`, `report` |
| status | string | 是 | 任务状态：`success`, `partial`, `failed` |
| result_data | object | 是 | 任务结果数据（JSON 格式） |
| error_message | string | 否 | 错误信息（任务失败时） |
| metadata | object | 否 | 额外的元数据 |

### 示例调用

```json
{
  "task_name": "sync_cn_stocks",
  "task_type": "data_sync",
  "status": "success",
  "result_data": {
    "records_count": 1500,
    "symbols_updated": ["000001", "000002", "600000"],
    "duration_seconds": 45
  },
  "metadata": {
    "source": "tushare",
    "trade_date": "2026-06-19"
  }
}
```

## 数据库表结构

`automation_results` 表字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | 主键 |
| task_name | VARCHAR(100) | 任务名称 |
| task_type | VARCHAR(50) | 任务类型 |
| status | ENUM | 状态：success/partial/failed |
| result_data | JSON | 结果数据 |
| records_count | INT | 处理记录数 |
| error_message | TEXT | 错误信息 |
| metadata | JSON | 元数据 |
| created_at | DATETIME | 创建时间 |

## 查询任务结果

```sql
-- 查看所有任务结果
SELECT * FROM automation_results ORDER BY created_at DESC;

-- 查看失败的任务
SELECT * FROM automation_results WHERE status = 'failed';

-- 按任务类型统计
SELECT task_type, COUNT(*) as count, 
       SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count
FROM automation_results 
GROUP BY task_type;
```

## 开发

### 本地测试
```bash
npm run dev  # 监听模式，自动重新编译
```

### 手动测试 MCP Server
```bash
# 启动服务器（stdio 模式）
node dist/index.js

# 或使用 MCP Inspector 测试
npx @modelcontextprotocol/inspector node dist/index.js
```

## 注意事项

1. **数据库连接**：确保 `.env` 中的数据库配置正确，且数据库可访问
2. **表结构**：必须先执行 `migration_automation_results.sql` 创建表
3. **路径配置**：TRAE MCP 配置中的 `args` 路径必须是绝对路径
4. **日志输出**：MCP Server 使用 `console.error` 输出日志（不会干扰 stdio 通信）

## 故障排查

### 问题：MCP Server 无法连接数据库
- 检查 `.env` 文件中的数据库配置
- 确认数据库服务正在运行
- 验证数据库用户权限

### 问题：TRAE 无法识别 MCP Server
- 检查 TRAE MCP 配置中的路径是否正确
- 确认已运行 `npm run build` 生成 `dist/index.js`
- 查看 TRAE 日志中的错误信息

### 问题：工具调用失败
- 检查 `automation_results` 表是否存在
- 验证传入参数是否符合 schema
- 查看 MCP Server 的错误日志

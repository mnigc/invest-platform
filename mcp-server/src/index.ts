#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { query, closePool } from './db.js';

// 定义 push_result 工具的输入参数类型
interface PushResultArgs {
  task_name: string;
  task_type: string;
  status: 'success' | 'partial' | 'failed';
  result_data: any;
  error_message?: string;
  metadata?: Record<string, any>;
}

// 创建 MCP Server 实例
const server = new Server(
  {
    name: 'invest-platform-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 注册可用工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'push_result',
        description: '推送自动化任务结果到数据库',
        inputSchema: {
          type: 'object',
          properties: {
            task_name: {
              type: 'string',
              description: '任务名称，例如：sync_cn_stocks, update_indicators',
            },
            task_type: {
              type: 'string',
              description: '任务类型，例如：data_sync, analysis, report',
            },
            status: {
              type: 'string',
              enum: ['success', 'partial', 'failed'],
              description: '任务执行状态',
            },
            result_data: {
              type: 'object',
              description: '任务结果数据（JSON 格式）',
            },
            error_message: {
              type: 'string',
              description: '错误信息（如果任务失败）',
            },
            metadata: {
              type: 'object',
              description: '额外的元数据（可选）',
            },
          },
          required: ['task_name', 'task_type', 'status', 'result_data'],
        },
      },
    ],
  };
});

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'push_result') {
    try {
      const {
        task_name,
        task_type,
        status,
        result_data,
        error_message,
        metadata,
      } = args as unknown as PushResultArgs;

      // 插入到 automation_results 表
      const sql = `
        INSERT INTO automation_results 
        (task_name, task_type, status, result_data, records_count, error_message, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      // 从 result_data 中提取记录数（如果有）
      const records_count = result_data?.records_count || 0;

      const result = await query(sql, [
        task_name,
        task_type,
        status,
        JSON.stringify(result_data),
        records_count,
        error_message || null,
        metadata ? JSON.stringify(metadata) : null,
      ]);

      // 如果有 metadata，可以存储到单独的表或 JSON 字段
      // 这里简化处理，将完整结果记录到日志
      console.error(`[MCP Server] Task result saved: ${task_name} - ${status}`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: '任务结果已成功保存到数据库',
              log_id: (result as any).insertId,
            }),
          },
        ],
      };
    } catch (error) {
      console.error('[MCP Server] Error saving task result:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: '保存任务结果失败',
              error: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: `Unknown tool: ${name}`,
      },
    ],
    isError: true,
  };
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP Server] Invest Platform MCP Server running on stdio');
}

main().catch((error) => {
  console.error('[MCP Server] Fatal error:', error);
  process.exit(1);
});

// 优雅关闭
process.on('SIGINT', async () => {
  console.error('[MCP Server] Shutting down...');
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('[MCP Server] Shutting down...');
  await closePool();
  process.exit(0);
});

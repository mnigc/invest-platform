-- ============================================
-- 自动化任务结果存储表
-- 用于 MCP Server 接收 TRAE Work 推送的自动化任务结果
-- ============================================

USE invest_platform;

CREATE TABLE IF NOT EXISTS automation_results (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_name       VARCHAR(100) NOT NULL,          -- 任务名称，如 sync_cn_stocks
    task_type       VARCHAR(50) NOT NULL,           -- 任务类型，如 data_sync / analysis / report
    status          ENUM('success', 'partial', 'failed') NOT NULL,
    result_data     JSON,                           -- 任务结果数据（JSON）
    records_count   INT DEFAULT 0,                  -- 处理记录数
    error_message   TEXT,                           -- 错误信息
    metadata        JSON,                           -- 额外元数据
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_task_name (task_name),
    INDEX idx_task_type (task_type),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

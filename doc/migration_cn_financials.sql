-- ============================================
-- A股财务数据表
-- 执行: mysql -h <host> -P <port> -u <user> -p invest_platform < migration_cn_financials.sql
-- ============================================

USE invest_platform;

CREATE TABLE IF NOT EXISTS cn_financials (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    symbol_id       INT NOT NULL,                              -- 关联 cn_symbols
    report_date     DATE NOT NULL,                             -- 报告期 (2024-03-31, 2024-06-30...)
    report_type     ENUM('Q1', 'Q2', 'Q3', 'Q4', 'FY') NOT NULL, -- 报告类型
    
    -- 利润表核心
    revenue         BIGINT,          -- 营收 (元)
    revenue_yoy     DECIMAL(8,4),    -- 营收同比 %
    net_profit      BIGINT,          -- 净利润 (元)
    net_profit_yoy  DECIMAL(8,4),    -- 净利润同比 %
    eps             DECIMAL(10,4),   -- 基本每股收益
    
    -- 资产负债表核心
    total_assets    BIGINT,          -- 总资产
    total_liab      BIGINT,          -- 总负债
    equity          BIGINT,          -- 归母净资产
    debt_to_asset   DECIMAL(8,4),    -- 资产负债率 %
    
    -- 现金流表核心
    oper_cash_flow  BIGINT,          -- 经营活动现金流量净额
    free_cash_flow  BIGINT,          -- 自由现金流 (经营现金流 - 资本支出)
    
    -- 盈利能力
    roe             DECIMAL(8,4),    -- 净资产收益率 %
    roa             DECIMAL(8,4),    -- 总资产收益率 %
    gross_margin    DECIMAL(8,4),    -- 毛利率 %
    net_margin      DECIMAL(8,4),    -- 净利率 %
    
    -- 分红
    dividend_per_share DECIMAL(10,4), -- 每股分红
    dividend_yield     DECIMAL(8,4),  -- 股息率 %
    payout_ratio       DECIMAL(8,4),  -- 分红派息比 %
    
    -- 估值 (来自 asset_snapshots 或实时计算)
    pe_ttm          DECIMAL(10,4),   -- 市盈率 TTM
    pb              DECIMAL(10,4),   -- 市净率
    ps              DECIMAL(10,4),   -- 市销率
    peg             DECIMAL(10,4),   -- PEG
    
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (symbol_id) REFERENCES cn_symbols(id) ON DELETE CASCADE,
    UNIQUE KEY uk_symbol_report (symbol_id, report_date, report_type),
    INDEX idx_symbol_date (symbol_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
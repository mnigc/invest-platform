-- A股日线数据表结构迁移
-- 执行: mysql -h 204.44.121.43 -P 3306 -u mnigc -p invest_platform < migration_cn_daily_prices.sql

CREATE TABLE IF NOT EXISTS cn_symbols (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    symbol          VARCHAR(20) NOT NULL UNIQUE,
    name_zh         VARCHAR(100) NOT NULL,
    type            ENUM('stock', 'index', 'etf') NOT NULL DEFAULT 'stock',
    exchange        VARCHAR(10),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_type (type),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cn_daily_prices (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    symbol_id       INT NOT NULL,
    trade_date      DATE NOT NULL,
    open            DECIMAL(10, 3),
    high            DECIMAL(10, 3),
    low             DECIMAL(10, 3),
    close           DECIMAL(10, 3) NOT NULL,
    pre_close       DECIMAL(10, 3),
    change_pct      DECIMAL(8, 4),
    volume          BIGINT,
    amount          BIGINT,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (symbol_id) REFERENCES cn_symbols(id) ON DELETE CASCADE,
    UNIQUE KEY uk_symbol_date (symbol_id, trade_date),
    INDEX idx_date (trade_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

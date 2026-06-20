-- ============================================
-- 投资数据平台 - MariaDB 数据库结构
-- 执行: mysql -h <host> -P <port> -u <user> -p < database_schema.sql
-- ============================================

CREATE DATABASE IF NOT EXISTS invest_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE invest_platform;

-- ============================================
-- 1. 用户系统
-- ============================================

CREATE TABLE users (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,          -- bcrypt hash
    display_name    VARCHAR(100),
    avatar_url      VARCHAR(500),
    is_verified     BOOLEAN DEFAULT FALSE,          -- 邮箱是否验证
    is_active       BOOLEAN DEFAULT TRUE,
    role            ENUM('free', 'premium', 'admin') DEFAULT 'free',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login_at   DATETIME,
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auth_sessions (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    session_token   VARCHAR(255) NOT NULL UNIQUE,   -- JWT or random token
    expires_at      DATETIME NOT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address      VARCHAR(45),
    user_agent      VARCHAR(500),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_token (session_token),
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE email_verifications (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    token           VARCHAR(255) NOT NULL UNIQUE,
    expires_at      DATETIME NOT NULL,
    used_at         DATETIME,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 2. 经济指标与数据
-- ============================================

CREATE TABLE indicators (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    code            VARCHAR(50) NOT NULL UNIQUE,    -- GDP, CPI, PPI, etc.
    name_zh         VARCHAR(100) NOT NULL,
    name_en         VARCHAR(100),
    category        VARCHAR(50) NOT NULL,           -- 经济数据 / 利率 / 流动性 / 波动率 / 信用市场
    sub_category    VARCHAR(50),                    -- GDP / 就业 / 通胀 / 消费
    unit            VARCHAR(20),                    -- %, 亿美元, 点
    frequency       ENUM('daily', 'weekly', 'monthly', 'quarterly', 'yearly') NOT NULL,
    source          VARCHAR(100),                   -- FRED, Yahoo Finance, U.S. Treasury
    source_url      VARCHAR(500),
    description     TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_category (category, sub_category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE indicator_data (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    indicator_id    INT NOT NULL,
    period_date     DATE NOT NULL,
    value           DECIMAL(18, 6),
    value_prev      DECIMAL(18, 6),                 -- 前值
    value_yoy       DECIMAL(18, 6),                 -- 同比
    value_mom       DECIMAL(18, 6),                 -- 环比
    is_estimated    BOOLEAN DEFAULT FALSE,          -- 是否为预估值
    data_quality    ENUM('normal', 'warning', 'error') DEFAULT 'normal',
    notes           VARCHAR(500),
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (indicator_id) REFERENCES indicators(id) ON DELETE CASCADE,
    UNIQUE KEY uk_indicator_date (indicator_id, period_date),
    INDEX idx_date (period_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 3. 资产数据（股票 / ETF / 债券 / 商品 / 外汇）
-- ============================================

CREATE TABLE asset_categories (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    code            VARCHAR(50) NOT NULL UNIQUE,    -- equity, bond, commodity, fx, crypto
    name_zh         VARCHAR(50) NOT NULL,
    name_en         VARCHAR(50),
    sort_order      INT DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE assets (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    symbol          VARCHAR(30) NOT NULL,           -- ^GSPC, TLT, GC=F, BTC-USD
    name_zh         VARCHAR(100) NOT NULL,
    name_en         VARCHAR(100),
    category_id     INT NOT NULL,
    sub_category    VARCHAR(50),                    -- 美股 / 国债ETF / 商品 / etc.
    exchange        VARCHAR(20),                    -- NYSE, NASDAQ, etc.
    currency        VARCHAR(10) DEFAULT 'USD',
    description     TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES asset_categories(id),
    UNIQUE KEY uk_symbol (symbol),
    INDEX idx_category (category_id),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE asset_prices (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    asset_id        INT NOT NULL,
    trade_date      DATE NOT NULL,
    open_price      DECIMAL(18, 6),
    high_price      DECIMAL(18, 6),
    low_price       DECIMAL(18, 6),
    close_price     DECIMAL(18, 6) NOT NULL,
    volume          BIGINT,
    change_amount   DECIMAL(18, 6),
    change_percent  DECIMAL(8, 4),
    adjusted_close  DECIMAL(18, 6),                 -- 复权收盘价
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
    UNIQUE KEY uk_asset_date (asset_id, trade_date),
    INDEX idx_date (trade_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 资产实时快照（最新数据缓存）
CREATE TABLE asset_snapshots (
    asset_id        INT PRIMARY KEY,
    last_price      DECIMAL(18, 6),
    change_percent  DECIMAL(8, 4),
    volume          BIGINT,
    market_cap      BIGINT,
    pe_ratio        DECIMAL(10, 4),
    pb_ratio        DECIMAL(10, 4),
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 4. 产业链图谱
-- ============================================

CREATE TABLE industries (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    code            VARCHAR(50) NOT NULL UNIQUE,    -- ai, semiconductor
    name_zh         VARCHAR(100) NOT NULL,
    name_en         VARCHAR(100),
    description     TEXT,
    node_count      INT DEFAULT 0,
    company_count   INT DEFAULT 0,
    link_count      INT DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE industry_nodes (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    industry_id     INT NOT NULL,
    node_code       VARCHAR(50) NOT NULL,           -- 节点编码
    name_zh         VARCHAR(100) NOT NULL,
    name_en         VARCHAR(100),
    layer           INT NOT NULL DEFAULT 1,         -- 层级: 1上游 2中游 3下游
    category        VARCHAR(50),                    -- 细分分类
    description     TEXT,
    x_pos           DECIMAL(10, 4),                 -- 图谱坐标（可选）
    y_pos           DECIMAL(10, 4),
    color           VARCHAR(10),                    -- 节点颜色
    is_core         BOOLEAN DEFAULT FALSE,          -- 是否核心节点
    FOREIGN KEY (industry_id) REFERENCES industries(id) ON DELETE CASCADE,
    UNIQUE KEY uk_industry_node (industry_id, node_code),
    INDEX idx_layer (layer)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE industry_edges (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    industry_id     INT NOT NULL,
    from_node_id    INT NOT NULL,
    to_node_id      INT NOT NULL,
    relation_type   ENUM('supply', 'demand', 'cooperate', 'compete') DEFAULT 'supply',
    description     VARCHAR(500),
    FOREIGN KEY (industry_id) REFERENCES industries(id) ON DELETE CASCADE,
    FOREIGN KEY (from_node_id) REFERENCES industry_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (to_node_id) REFERENCES industry_nodes(id) ON DELETE CASCADE,
    UNIQUE KEY uk_edge (industry_id, from_node_id, to_node_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 节点关联公司
CREATE TABLE node_companies (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    node_id         INT NOT NULL,
    asset_id        INT,                            -- 关联资产表（如有）
    company_name_zh VARCHAR(100) NOT NULL,
    company_name_en VARCHAR(100),
    stock_symbol    VARCHAR(30),                    -- 股票代码
    exchange        VARCHAR(20),
    country         VARCHAR(50),
    role_type       ENUM('core', 'supplier', 'customer', 'competitor') DEFAULT 'core',
    description     TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (node_id) REFERENCES industry_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL,
    INDEX idx_node (node_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 5. 文章索引（内容存在 MDX 文件中，此处存元数据）
-- ============================================

CREATE TABLE articles (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    slug            VARCHAR(200) NOT NULL UNIQUE,   -- URL slug，对应 MDX 文件名
    title           VARCHAR(200) NOT NULL,
    author          VARCHAR(100),
    category        VARCHAR(50) NOT NULL,           -- shareholder_letter / speech / philosophy
    tags            JSON,                           -- 标签数组
    summary         TEXT,
    source_url      VARCHAR(500),                   -- 原文链接
    published_at    DATE,
    file_path       VARCHAR(500) NOT NULL,          -- MDX 文件路径
    is_published    BOOLEAN DEFAULT TRUE,
    view_count      INT DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_author (author),
    INDEX idx_published (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 6. A股数据（个股 / 指数 / ETF 日线）
-- ============================================

CREATE TABLE cn_symbols (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    symbol          VARCHAR(20) NOT NULL UNIQUE,      -- '000001' or '000001.SH'
    name_zh         VARCHAR(100) NOT NULL,
    type            ENUM('stock', 'index', 'etf') NOT NULL DEFAULT 'stock',
    exchange        VARCHAR(10),                      -- 'SH' or 'SZ'
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_type (type),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cn_daily_prices (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    symbol_id       INT NOT NULL,
    trade_date      DATE NOT NULL,
    open            DECIMAL(10, 3),
    high            DECIMAL(10, 3),
    low             DECIMAL(10, 3),
    close           DECIMAL(10, 3) NOT NULL,
    pre_close       DECIMAL(10, 3),                   -- 昨收
    change_pct      DECIMAL(8, 4),                    -- 涨跌幅 %
    volume          BIGINT,                            -- 成交量（股）
    amount          BIGINT,                            -- 成交额（元）
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (symbol_id) REFERENCES cn_symbols(id) ON DELETE CASCADE,
    UNIQUE KEY uk_symbol_date (symbol_id, trade_date),
    INDEX idx_date (trade_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 7. 系统配置与日志
-- ============================================

CREATE TABLE data_sync_logs (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    sync_type       VARCHAR(50) NOT NULL,           -- indicator / asset_price / etc.
    target_code     VARCHAR(50),                    -- 同步对象代码
    status          ENUM('success', 'partial', 'failed') NOT NULL,
    records_count   INT DEFAULT 0,
    error_message   TEXT,
    started_at      DATETIME NOT NULL,
    finished_at     DATETIME,
    INDEX idx_type (sync_type),
    INDEX idx_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 插入初始数据
-- ============================================

INSERT INTO asset_categories (code, name_zh, name_en, sort_order) VALUES
('equity', '美股', 'US Equities', 1),
('etf', 'ETF', 'ETFs', 2),
('bond', '债券', 'Bonds', 3),
('commodity', '商品', 'Commodities', 4),
('fx', '外汇', 'Forex', 5);

INSERT INTO indicators (code, name_zh, name_en, category, sub_category, unit, frequency, source, description) VALUES
('GDP', '实际GDP', 'Real GDP', '经济数据', 'GDP', '十亿美元', 'quarterly', 'FRED', '美国实际国内生产总值（2017年链式美元计价）'),
('CPI', '消费者价格指数', 'Consumer Price Index', '经济数据', '通胀', '指数', 'monthly', 'FRED', '美国城市消费者CPI（所有城市，所有项目）'),
('PPI', '生产者价格指数', 'Producer Price Index', '经济数据', '通胀', '指数', 'monthly', 'FRED', '最终需求生产者价格指数'),
('UNRATE', '失业率', 'Unemployment Rate', '经济数据', '就业', '%', 'monthly', 'FRED', '美国平民失业率'),
('FEDFUNDS', '联邦基金利率', 'Federal Funds Rate', '利率', '利率', '%', 'daily', 'FRED', '联邦基金有效利率'),
('DGS10', '10年期国债收益率', '10-Year Treasury Yield', '利率', '利率', '%', 'daily', 'FRED', '10年期国债恒定到期收益率'),
('VIXCLS', 'VIX波动率指数', 'VIX', '波动率', '波动率', '点', 'daily', 'FRED', 'CBOE波动率指数'),
('DEXUSEU', '美元指数 EUR', 'USD/EUR', '外汇', '外汇', '汇率', 'daily', 'FRED', '美元兑欧元汇率'),
-- 新增：Sprint 2 债券市场 & 宏观风险
('DFII10', '10年期TIPS收益率', '10-Year TIPS Yield', '利率', '实际利率', '%', 'daily', 'FRED', '10年期通胀保值国债(TIPS)恒定到期收益率'),
('T5YIE', '5年期盈亏平衡通胀率', '5-Year Breakeven Inflation', '利率', '盈亏平衡通胀', '%', 'daily', 'FRED', '5年期国债名义收益率 - 5年期TIPS收益率'),
('T10YIE', '10年期盈亏平衡通胀率', '10-Year Breakeven Inflation', '利率', '盈亏平衡通胀', '%', 'daily', 'FRED', '10年期国债名义收益率 - 10年期TIPS收益率'),
('CFNAI', '芝加哥联储全国活动指数', 'Chicago Fed National Activity Index', '经济数据', '综合', '点', 'monthly', 'FRED', '芝加哥联储全国活动指数，综合85个指标'),
('BAMLC0A4CBBB', 'BBB级公司债利差', 'BBB Corporate Spread', '信用市场', '信用利差', '%', 'daily', 'FRED', 'BBB级美国公司债期权调整利差(OAS)'),
-- 收益率曲线各期限
('DGS1MO', '1个月期国债收益率', '1-Month Treasury Yield', '利率', '收益率曲线', '%', 'daily', 'FRED', '1个月期国债恒定到期收益率'),
('DGS3MO', '3个月期国债收益率', '3-Month Treasury Yield', '利率', '收益率曲线', '%', 'daily', 'FRED', '3个月期国债恒定到期收益率'),
('DGS6MO', '6个月期国债收益率', '6-Month Treasury Yield', '利率', '收益率曲线', '%', 'daily', 'FRED', '6个月期国债恒定到期收益率'),
('DGS1', '1年期国债收益率', '1-Year Treasury Yield', '利率', '收益率曲线', '%', 'daily', 'FRED', '1年期国债恒定到期收益率'),
('DGS2', '2年期国债收益率', '2-Year Treasury Yield', '利率', '收益率曲线', '%', 'daily', 'FRED', '2年期国债恒定到期收益率'),
('DGS3', '3年期国债收益率', '3-Year Treasury Yield', '利率', '收益率曲线', '%', 'daily', 'FRED', '3年期国债恒定到期收益率'),
('DGS5', '5年期国债收益率', '5-Year Treasury Yield', '利率', '收益率曲线', '%', 'daily', 'FRED', '5年期国债恒定到期收益率'),
('DGS7', '7年期国债收益率', '7-Year Treasury Yield', '利率', '收益率曲线', '%', 'daily', 'FRED', '7年期国债恒定到期收益率'),
('DGS20', '20年期国债收益率', '20-Year Treasury Yield', '利率', '收益率曲线', '%', 'daily', 'FRED', '20年期国债恒定到期收益率'),
('DGS30', '30年期国债收益率', '30-Year Treasury Yield', '利率', '收益率曲线', '%', 'daily', 'FRED', '30年期国债恒定到期收益率'),
('SP500_PE', '标普500市盈率', 'S&P 500 PE Ratio', '估值', '美股估值', '倍', 'weekly', 'Yahoo Finance', '标普500指数追踪市盈率(Trailing PE)，用于ERP计算');

INSERT INTO assets (symbol, name_zh, name_en, category_id, sub_category, exchange) VALUES
('^GSPC', '标普500', 'S&P 500', 1, '美股', 'NYSE'),
('^IXIC', '纳斯达克100', 'NASDAQ 100', 1, '美股', 'NASDAQ'),
('^DJI', '道琼斯', 'Dow Jones', 1, '美股', 'NYSE'),
('TLT', '20年+国债ETF', 'iShares 20+ Year Treasury Bond ETF', 3, '国债ETF', 'NASDAQ'),
('GLD', '黄金ETF', 'SPDR Gold Shares', 4, '贵金属', 'NYSE'),
('CL=F', 'WTI原油', 'Crude Oil WTI', 4, '能源', 'NYMEX'),
('GC=F', '黄金', 'Gold', 4, '贵金属', 'COMEX'),
('DX-Y.NYB', '美元指数', 'US Dollar Index', 5, '外汇', 'ICE');

INSERT INTO industries (code, name_zh, name_en, description) VALUES
('ai', 'AI产业链', 'AI Industry Chain', '人工智能产业上中下游结构，涵盖芯片、算力、模型、应用等环节'),
('semiconductor', '半导体产业链', 'Semiconductor Industry Chain', '半导体产业全链条，涵盖设备、材料、设计、制造、封测等环节');

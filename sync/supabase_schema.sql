-- ============================================================
-- Invest Platform - Supabase (PostgreSQL) 全量建表脚本
-- 在 Supabase Dashboard → SQL Editor 中粘贴执行一次即可
-- ============================================================

create extension if not exists pgcrypto;

-- ── 宏观经济指标（code+region 唯一）──
create table if not exists indicators (
    id            bigserial primary key,
    code          varchar(50)  not null,
    region        varchar(10)  not null default 'US',
    name_zh       varchar(100) not null,
    name_en       varchar(100),
    category      varchar(50)  not null default '',
    sub_category  varchar(50),
    unit          varchar(20),
    frequency     varchar(20)  not null default 'daily',
    source        varchar(100),
    source_url    varchar(500),
    description   text,
    is_active     smallint     not null default 1,
    created_at    timestamptz  not null default now(),
    constraint uk_indicator_code_region unique (code, region)
);
create index if not exists idx_indicators_active on indicators (is_active);

create table if not exists indicator_data (
    id             bigserial primary key,
    indicator_id   bigint not null references indicators(id) on delete cascade,
    period_date    date not null,
    value          numeric(18,6) null,
    value_prev     numeric(18,6),
    value_yoy      numeric(18,6),
    value_mom      numeric(18,6),
    is_estimated   smallint not null default 0,
    data_quality   varchar(10) not null default 'normal',
    notes          varchar(500),
    updated_at     timestamptz not null default now(),
    constraint uk_indicator_date unique (indicator_id, period_date)
);
create index if not exists idx_indicator_data_date on indicator_data (period_date);

-- ── 资产（美股/ETF/商品/外汇）──
create table if not exists asset_categories (
    id          bigserial primary key,
    code        varchar(50) not null unique,
    name_zh     varchar(50) not null,
    name_en     varchar(50),
    sort_order  int default 0,
    is_active   smallint not null default 1
);

create table if not exists assets (
    id            bigserial primary key,
    symbol        varchar(40) not null unique,
    name_zh       varchar(150) not null,
    name_en       varchar(150),
    category_id   bigint references asset_categories(id),
    sub_category  varchar(50),
    exchange      varchar(20),
    currency      varchar(10) default 'USD',
    description   text,
    is_active     smallint not null default 1,
    created_at    timestamptz not null default now()
);
create index if not exists idx_assets_active on assets (is_active);

create table if not exists asset_prices (
    id              bigserial primary key,
    asset_id        bigint not null references assets(id) on delete cascade,
    trade_date      date not null,
    open_price      numeric(18,6),
    high_price      numeric(18,6),
    low_price       numeric(18,6),
    close_price     numeric(18,6),
    volume          numeric(24,0),
    change_amount   numeric(18,6),
    change_percent  numeric(10,4),
    adjusted_close  numeric(18,6),
    updated_at      timestamptz not null default now(),
    constraint uk_asset_date unique (asset_id, trade_date)
);
create index if not exists idx_asset_prices_date on asset_prices (trade_date);

-- ── 指数日线（沪深300，国家队资金事件研究基准）──
create table if not exists index_daily (
    id            bigserial primary key,
    index_code    varchar(20) not null,
    index_name    varchar(60),
    category      varchar(20) default 'main',
    trade_date    date not null,
    open_price    numeric(18,4),
    high_price    numeric(18,4),
    low_price     numeric(18,4),
    close_price   numeric(18,4),
    volume        numeric(24,0),
    amount        numeric(24,2),
    change_pct    numeric(10,4),
    turnover_rate numeric(10,4),
    updated_at    timestamptz not null default now(),
    constraint uk_index_daily unique (index_code, trade_date)
);
create index if not exists idx_index_daily_date on index_daily (trade_date);

-- ── 央行黄金变动 / 金价（供黄金决策）──
create table if not exists gold_reserve_changes (
    id              bigserial primary key,
    country_name    varchar(120) not null,
    country_name_cn varchar(120),
    period_date     date not null,
    change_tonnes   numeric(18,4) not null,
    updated_at      timestamptz  not null default now(),
    constraint uk_gold_change_country_period unique (country_name, period_date)
);

create table if not exists gold_price_history (
    id           bigserial primary key,
    source       varchar(40) not null,
    currency     varchar(10) not null default 'USD',
    unit         varchar(20) not null default 'OZ',
    price_date   date not null,
    close_price  numeric(18,4) not null,
    updated_at   timestamptz not null default now(),
    constraint uk_gold_price_source_date unique (source, price_date)
);
create index if not exists idx_gold_price_history_date on gold_price_history (price_date);

-- ── ETF 资金流（国家队跟踪）──
create table if not exists etf_master (
    code        varchar(10) primary key,
    name        varchar(60) not null,
    exchange    varchar(4)  not null,
    track_index varchar(60),
    category    varchar(20) not null default 'broad',
    is_active   smallint    not null default 1,
    updated_at  timestamptz not null default now()
);

create table if not exists etf_daily (
    code       varchar(10) not null,
    trade_date date not null,
    open       numeric(12,4),
    high       numeric(12,4),
    low        numeric(12,4),
    close      numeric(12,4),
    volume     numeric(20,2),
    amount     numeric(20,2),
    turnover   numeric(10,4),
    change_pct numeric(10,4),
    constraint uk_etf_daily unique (code, trade_date)
);
create index if not exists idx_etf_daily_date on etf_daily (trade_date);

create table if not exists etf_shares (
    code         varchar(10) not null,
    trade_date   date not null,
    shares_10k   numeric(20,4) not null,
    is_converted smallint not null default 0,
    constraint uk_etf_shares unique (code, trade_date)
);
create index if not exists idx_etf_shares_date on etf_shares (trade_date);

-- ── 同步日志 ──
create table if not exists data_sync_logs (
    id            bigserial primary key,
    sync_type     varchar(50),
    target_code   varchar(50),
    status        varchar(20),
    records_count int,
    error_message text,
    started_at    timestamptz not null default now(),
    finished_at   timestamptz not null default now()
);
create index if not exists idx_sync_logs_time on data_sync_logs (started_at desc);

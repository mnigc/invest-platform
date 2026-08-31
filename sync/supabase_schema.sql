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

-- ── 宏观体制回测（预计算，解决 backtest API 性能问题）──
create table if not exists regime_snapshots (
    id              bigserial primary key,
    snapshot_date   date not null,
    regime          varchar(30) not null,
    label           varchar(50) not null,
    confidence      smallint not null,
    sp500_price     numeric(18,4),
    cfnai           numeric(10,4),
    cpi_yoy         numeric(10,4),
    fedfunds        numeric(10,4),
    dgs10           numeric(10,4),
    dgs2            numeric(10,4),
    t10yie          numeric(10,4),
    vix             numeric(10,4),
    bbb_spread      numeric(10,4),
    dfii10          numeric(10,4),
    fwd_return_1m   numeric(10,6),
    fwd_return_3m   numeric(10,6),
    fwd_return_6m   numeric(10,6),
    fwd_return_12m  numeric(10,6),
    updated_at      timestamptz not null default now(),
    constraint uk_regime_snapshot_date unique (snapshot_date)
);
create index if not exists idx_regime_snapshots_date on regime_snapshots (snapshot_date);
create index if not exists idx_regime_snapshots_regime on regime_snapshots (regime);

create table if not exists regime_backtest_summaries (
    id              bigserial primary key,
    period_start    date not null,
    period_end      date not null,
    regime          varchar(30) not null,
    label           varchar(50) not null,
    count           int not null,
    avg_confidence  numeric(5,3),
    avg_return_1m   numeric(10,6),
    avg_return_3m   numeric(10,6),
    avg_return_6m   numeric(10,6),
    avg_return_12m  numeric(10,6),
    win_rate_1m     numeric(5,3),
    win_rate_3m     numeric(5,3),
    win_rate_6m     numeric(5,3),
    win_rate_12m    numeric(5,3),
    updated_at      timestamptz not null default now(),
    constraint uk_backtest_summary unique (period_start, period_end, regime)
);

create table if not exists regime_index_summaries (
    id              bigserial primary key,
    period_start    date not null,
    period_end      date not null,
    index_symbol    varchar(30) not null,
    index_name_zh   varchar(50) not null,
    regime          varchar(30) not null,
    label           varchar(50) not null,
    count           int not null,
    avg_confidence  numeric(5,3),
    avg_return_1m   numeric(10,6),
    avg_return_3m   numeric(10,6),
    avg_return_6m   numeric(10,6),
    avg_return_12m  numeric(10,6),
    win_rate_1m     numeric(5,3),
    win_rate_3m     numeric(5,3),
    win_rate_6m     numeric(5,3),
    win_rate_12m    numeric(5,3),
    updated_at      timestamptz not null default now(),
    constraint uk_index_summary unique (index_symbol, period_start, period_end, regime)
);
create index if not exists idx_index_summaries_symbol on regime_index_summaries (index_symbol);

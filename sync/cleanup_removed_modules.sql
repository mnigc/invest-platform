-- ============================================================
-- 清理已下线模块：国家队资金 (etf_flow) & 中美10Y利差 (cn_us_spread)
-- 仅在下线确认后执行一次（Supabase Dashboard → SQL Editor 粘贴执行）
-- 注意：DROP TABLE 不可逆；删除指标会联级清理其 indicator_data。
-- ============================================================

BEGIN;

-- 1) 国家队资金模块相关表（含事件研究基准指数 index_daily，仅该模块在用）
DROP TABLE IF EXISTS etf_shares;
DROP TABLE IF EXISTS etf_daily;
DROP TABLE IF EXISTS etf_master;
DROP TABLE IF EXISTS index_daily;

-- 2) 中美10Y利差 / 跨境资金 相关指标定义与数据
--    (DGS10 由 宏观体制 regime 共用，保留)
DELETE FROM indicator_data
WHERE indicator_id IN (
  SELECT id FROM indicators
  WHERE code IN ('CN_TREASURY_10Y', 'NORTHBOUND_FLOW', 'SOUTHBOUND_FLOW', 'USDCNY')
);
DELETE FROM indicators
WHERE code IN ('CN_TREASURY_10Y', 'NORTHBOUND_FLOW', 'SOUTHBOUND_FLOW', 'USDCNY');

-- 3) 同步日志中已下线模块的记录（可选）
DELETE FROM data_sync_logs WHERE sync_type IN ('etf_flow', 'cn_us_spread');

COMMIT;

export const prerender = false

import type { APIRoute } from 'astro'
import { query } from '../../../lib/db'
import { withCache } from '../../../lib/cache'

export const GET = withCache(async () => {
  try {
    // 数据新鲜度自检：指标 / 资产价格（美元指数）/ 各展示模块最近一次同步
    const [latestIndicator, latestAsset, lastSync] = await Promise.all([
      query(
        `SELECT i.code, i.name_zh, MAX(d.period_date) AS latest
         FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id
         WHERE i.is_active = 1 GROUP BY i.code, i.name_zh ORDER BY latest DESC LIMIT 10`
      ),
      query(
        `SELECT a.symbol, a.name_zh, MAX(p.trade_date) AS latest
         FROM asset_prices p JOIN assets a ON a.id = p.asset_id
         GROUP BY a.symbol, a.name_zh ORDER BY latest DESC LIMIT 10`
      ),
      query(
        `SELECT sync_type, status, records_count, finished_at
         FROM data_sync_logs ORDER BY finished_at DESC LIMIT 20`
      ),
    ])

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          indicators: latestIndicator,
          assets: latestAsset,
          sync: lastSync,
          timestamp: new Date().toISOString(),
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}, 300)

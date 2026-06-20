export const prerender = false

import type { APIRoute } from 'astro'
import { query } from '../../../lib/db'
import { withCache } from '../../../lib/cache'

export const GET = withCache(async () => {
  try {
    const [latestIndicator, latestAsset, lastSync] = await Promise.all([
      query(
        `SELECT i.code, i.name_zh, MAX(d.period_date) AS latest
         FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id
         WHERE i.is_active = TRUE GROUP BY i.code, i.name_zh ORDER BY latest DESC LIMIT 10`
      ),
      query(
        `SELECT a.symbol, a.name_zh, s.updated_at AS latest
         FROM asset_snapshots s JOIN assets a ON a.id = s.asset_id
         ORDER BY s.updated_at DESC LIMIT 10`
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

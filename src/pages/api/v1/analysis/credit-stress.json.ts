export const prerender = false

import { queryOne } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'

const ENDPOINT = 'analysis/credit-stress'

export const GET = withCache(async () => {
  try {
    const row = await queryOne<any>(
      `SELECT payload, computed_at, valid_from
       FROM analysis_results WHERE endpoint = ?`,
      [ENDPOINT]
    )
    if (!row) {
      return new Response(JSON.stringify({
        success: false, error: '分析数据尚未生成，请等待首次同步完成'
      }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({
      success: true,
      data: row.payload,
      meta: { computedAt: row.computed_at, validFrom: row.valid_from }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}, 300)

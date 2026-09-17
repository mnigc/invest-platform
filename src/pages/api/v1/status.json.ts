export const prerender = false

import { query } from '../../../lib/db'
import { withCache } from '../../../lib/cache'

export const GET = withCache(async () => {
  try {
    // 数据新鲜度自检：只暴露顶栏 DataFreshness 组件用到的最近同步记录
    // （sync_type / status / finished_at）。内部指标清单、资产清单、
    // 记录数等运维细节不再对外公开。
    const lastSync = await query(
      `SELECT sync_type, status, finished_at
       FROM data_sync_logs ORDER BY finished_at DESC LIMIT 20`
    )

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          sync: lastSync,
          timestamp: new Date().toISOString(),
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[Status]', err?.message || err)
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}, 300)

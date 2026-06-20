import { Hono } from 'hono'
import { query } from '../../db/pool.js'

const router = new Hono()

// GET /api/v1/status — 数据新鲜度检查
router.get('/', async (c) => {
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

    return c.json({
      success: true,
      data: {
        indicators: latestIndicator,
        assets: latestAsset,
        sync: lastSync,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (err: any) {
    c.status(500)
    return c.json({ success: false, error: err.message })
  }
})

export default router

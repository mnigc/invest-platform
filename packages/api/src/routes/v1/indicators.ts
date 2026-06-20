import { Hono } from 'hono'
import { z } from 'zod'
import { query, queryOne } from '../../db/pool.js'
import { PERIOD_MAP, getDays, applyScaling } from '@invest/core'
import { cacheMiddleware } from '../../middleware/cache.js'

const router = new Hono()

// GET /api/v1/indicators — 列出所有指标
router.get('/', cacheMiddleware(300), async (c) => {
  const indicators = await query(
    `SELECT id, code, name_zh, name_en, region, category, sub_category, unit, frequency, source
     FROM indicators
     WHERE is_active = TRUE
     ORDER BY region, category, sub_category, id`
  )
  return c.json({ success: true, data: indicators })
})

// GET /api/v1/indicators/:code — 单指标详情 + 数据
router.get('/:code', cacheMiddleware(600), async (c) => {
  const code = c.req.param('code')
  const region = c.req.query('region') || 'US'
  const period = c.req.query('period') || '10Y'
  const yearly = c.req.query('yearly') !== 'false'

  if (!code) {
    c.status(400)
    return c.json({ success: false, error: 'Missing code' })
  }

  const indicator = await queryOne<any>(
    `SELECT * FROM indicators WHERE code = ? AND region = ? AND is_active = TRUE`,
    [code, region]
  )

  if (!indicator) {
    c.status(404)
    return c.json({ success: false, error: `Indicator ${code} not found in region ${region}` })
  }

  const days = getDays(period)
  let sql: string
  let params: any[]

  if (yearly) {
    const selectYear = `SELECT YEAR(period_date) AS period_date, ROUND(AVG(value), 3) AS value, COUNT(*) AS cnt`
    if (period === 'MAX') {
      sql = `${selectYear} FROM indicator_data WHERE indicator_id = ? GROUP BY YEAR(period_date) ORDER BY period_date ASC`
      params = [indicator.id]
    } else {
      sql = `${selectYear} FROM indicator_data WHERE indicator_id = ? AND period_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY YEAR(period_date) ORDER BY period_date ASC`
      params = [indicator.id, days]
    }
  } else {
    if (period === 'MAX') {
      sql = `SELECT period_date, ROUND(value, 3) AS value FROM indicator_data WHERE indicator_id = ? ORDER BY period_date ASC`
      params = [indicator.id]
    } else {
      sql = `SELECT period_date, ROUND(value, 3) AS value FROM indicator_data WHERE indicator_id = ? AND period_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ORDER BY period_date ASC`
      params = [indicator.id, days]
    }
  }

  let data = await query<any>(sql, params)

  if (yearly) {
    const freq = indicator.frequency
    const expectedCnt = freq === 'quarterly' ? 4 : freq === 'monthly' ? 12 : 365
    data = data.map((d: any) => ({ ...d, expected_cnt: expectedCnt }))
  }

  // Apply unit scaling
  data = data.map((d: any) => ({
    ...d,
    value: d.value != null ? applyScaling(region, code, Number(d.value)) : null,
  }))

  return c.json({ success: true, data: { indicator, points: data } })
})

export default router

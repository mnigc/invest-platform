import { Hono } from 'hono'
import { query, queryOne } from '../../db/pool.js'
import { cacheMiddleware } from '../../middleware/cache.js'
import type { YieldCurveResponse, YieldCurvePoint, BondSpread } from '@invest/core'

const router = new Hono()

const CURVE_TENORS = ['DGS1MO','DGS3MO','DGS6MO','DGS1','DGS2','DGS3','DGS5','DGS7','DGS10','DGS20','DGS30']
const TENOR_LABELS: Record<string, string> = {
  DGS1MO: '1M', DGS3MO: '3M', DGS6MO: '6M', DGS1: '1Y', DGS2: '2Y',
  DGS3: '3Y', DGS5: '5Y', DGS7: '7Y', DGS10: '10Y', DGS20: '20Y', DGS30: '30Y',
}

// GET /api/v1/bond/curve — 美国国债收益率曲线（最近最多5个交易日）
router.get('/curve', cacheMiddleware(600), async (c) => {
  try {
    const dates = await query<any>(
      `SELECT DISTINCT d.period_date
       FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code IN (${CURVE_TENORS.map(() => '?').join(',')})
         AND d.value IS NOT NULL
       ORDER BY d.period_date DESC
       LIMIT 5`,
      CURVE_TENORS
    )

    if (dates.length === 0) {
      return c.json({ success: true, data: { country: 'US', date: '', curve: [], spreads: [] } satisfies YieldCurveResponse })
    }

    const loadDate = dates[0].period_date
    const recentDate = dates.length >= 2 ? dates[1].period_date : null

    const rows = await query<any>(
      `SELECT i.code, d.value
       FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code IN (${CURVE_TENORS.map(() => '?').join(',')})
         AND d.period_date = ?
         AND d.value IS NOT NULL`,
      [...CURVE_TENORS, loadDate]
    )

    const valueMap: Record<string, number> = {}
    for (const r of rows) {
      valueMap[r.code] = Number(r.value)
    }

    let prevMap: Record<string, number> = {}
    if (recentDate) {
      const prevRows = await query<any>(
        `SELECT i.code, d.value
         FROM indicator_data d
         JOIN indicators i ON i.id = d.indicator_id
         WHERE i.code IN (${CURVE_TENORS.map(() => '?').join(',')})
           AND d.period_date = ?
           AND d.value IS NOT NULL`,
        [...CURVE_TENORS, recentDate]
      )
      for (const r of prevRows) {
        prevMap[r.code] = Number(r.value)
      }
    }

    const curve: YieldCurvePoint[] = CURVE_TENORS.map(code => {
      const val = valueMap[code]
      const prev = prevMap[code]
      return {
        tenor: TENOR_LABELS[code],
        yield: val,
        change: prev != null && val != null ? +(val - prev).toFixed(4) : undefined,
      }
    }).filter(p => p.yield != null)

    const spreads: BondSpread[] = []
    const dgs10 = valueMap['DGS10']
    const dgs2 = valueMap['DGS2']
    const dgs3m = valueMap['DGS3MO']
    if (dgs10 != null && dgs2 != null) {
      spreads.push({
        label: '10Y-2Y 利差',
        value: +(dgs10 - dgs2).toFixed(4),
      })
    }
    if (dgs10 != null && dgs3m != null) {
      spreads.push({
        label: '10Y-3M 利差',
        value: +(dgs10 - dgs3m).toFixed(4),
      })
    }

    const result: YieldCurveResponse = {
      country: 'US',
      date: typeof loadDate === 'string' ? loadDate : loadDate.toISOString().slice(0, 10),
      curve,
      spreads,
    }

    return c.json({ success: true, data: result })
  } catch (err: any) {
    console.error('[Bond Curve]', err.message)
    c.status(500)
    return c.json({ success: false, error: err.message })
  }
})

// GET /api/v1/bond/erp — 股权风险溢价 (Equity Risk Premium)
router.get('/erp', cacheMiddleware(600), async (c) => {
  try {
    const today = new Date().toISOString().slice(0, 10)

    const earnYield = await queryOne<any>(
      `SELECT d.period_date, 1 / d.value AS earn_yield
       FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = 'SP500_PE'
         AND d.period_date <= ?
       ORDER BY d.period_date DESC
       LIMIT 1`,
      [today]
    )

    const realRate = await queryOne<any>(
      `SELECT d.period_date, d.value AS real_rate
       FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = 'DFII10'
         AND d.period_date <= ?
       ORDER BY d.period_date DESC
       LIMIT 1`,
      [today]
    )

    const dgs10 = await queryOne<any>(
      `SELECT d.value AS dgs10
       FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = 'DGS10'
         AND d.period_date <= ?
       ORDER BY d.period_date DESC
       LIMIT 1`,
      [today]
    )

    const pe = earnYield ? +(1 / earnYield.earn_yield).toFixed(2) : null
    const ey = earnYield ? +earnYield.earn_yield.toFixed(4) : null
    const rr = realRate ? +realRate.real_rate.toFixed(4) : null
    const erpVal = ey != null && rr != null ? +(ey - rr).toFixed(4) : null
    const spyNominal = dgs10 ? +dgs10.dgs10.toFixed(4) : null

    return c.json({
      success: true,
      data: {
        date: today,
        sp500PE: pe,
        earningsYield: ey,
        dgs10Nominal: spyNominal,
        tips10yReal: rr,
        erp: erpVal,
      },
    })
  } catch (err: any) {
    console.error('[Bond ERP]', err.message)
    c.status(500)
    return c.json({ success: false, error: err.message })
  }
})

export default router

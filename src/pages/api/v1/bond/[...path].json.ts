export const prerender = false

import type { APIRoute } from 'astro'
import { query, queryOne } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'
import type { YieldCurveResponse, YieldCurvePoint, BondSpread } from '../../../../lib/core'

// ⚠️ 本接口已升级，建议改用：
//   - /api/v1/bonds.json?region=US  （中美统一国债接口，含曲线形态判定）
//   - /api/v1/bonds/curve-dynamics.json?region=US  （Nelson-Siegel 三因子分解）
//   - /api/v1/bonds/cn-us-spread.json  （中美 10Y 利差）
// 保留本接口仅为向后兼容 erp.json 子路由。

const CURVE_TENORS = ['DGS1MO','DGS3MO','DGS6MO','DGS1','DGS2','DGS3','DGS5','DGS7','DGS10','DGS20','DGS30']
const TENOR_LABELS: Record<string, string> = {
  DGS1MO: '1M', DGS3MO: '3M', DGS6MO: '6M', DGS1: '1Y', DGS2: '2Y',
  DGS3: '3Y', DGS5: '5Y', DGS7: '7Y', DGS10: '10Y', DGS20: '20Y', DGS30: '30Y',
}

export const GET = withCache(async ({ request }) => {
  const url = new URL(request.url)
  const path = url.pathname
  const subPath = path.split('/').pop()

  if (subPath === 'curve.json') {
    return await handleCurve()
  } else if (subPath === 'erp.json') {
    return await handleErp()
  }

  return new Response(
    JSON.stringify({ success: false, error: 'Not found' }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  )
}, 600)

async function handleCurve(): Promise<Response> {
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
      return new Response(
        JSON.stringify({ success: true, data: { country: 'US', date: '', curve: [], spreads: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
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

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[Bond Curve]', err.message)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

async function handleErp(): Promise<Response> {
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

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          date: today,
          sp500PE: pe,
          earningsYield: ey,
          dgs10Nominal: spyNominal,
          tips10yReal: rr,
          erp: erpVal,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[Bond ERP]', err.message)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

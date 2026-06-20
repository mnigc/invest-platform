export const prerender = false

import type { APIRoute } from 'astro'
import { query, queryOne } from '../../../../../lib/db'
import { withCache } from '../../../../../lib/cache'
import { getDays, applyScaling } from '../../../../../lib/core'

function formatPeriodDate(val: any): string {
  if (val == null) return ''
  if (typeof val === 'number') return String(val)
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10)
    if (/^\d{4}-\d{2}$/.test(val)) return val
    if (/^\d{4}$/.test(val)) return val
  }
  if (val instanceof Date) {
    const y = val.getFullYear()
    const m = String(val.getMonth() + 1).padStart(2, '0')
    const d = String(val.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const parsed = Date.parse(String(val))
  if (!isNaN(parsed)) {
    const dt = new Date(parsed)
    const y = dt.getFullYear()
    const m = String(dt.getMonth() + 1).padStart(2, '0')
    const d = String(dt.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(val)
}

export const GET = withCache(async ({ request, params }) => {
  const { region, code } = params
  const url = new URL(request.url)
  const period = url.searchParams.get('period') || '10Y'
  const yearly = url.searchParams.get('yearly') !== 'false'

  if (!code || !region) {
    return new Response(
      JSON.stringify({ success: false, error: 'Missing code or region' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    const indicator = await queryOne<any>(
      `SELECT * FROM indicators WHERE code = ? AND region = ? AND is_active = TRUE`,
      [code, region]
    )

    if (!indicator) {
      return new Response(
        JSON.stringify({ success: false, error: `Indicator ${code} not found in region ${region}` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const days = getDays(period)
    let sql: string
    let sqlParams: any[]

    if (yearly) {
      const selectYear = `SELECT YEAR(period_date) AS period_date, ROUND(AVG(value), 3) AS value, COUNT(*) AS cnt`
      if (period === 'MAX') {
        sql = `${selectYear} FROM indicator_data WHERE indicator_id = ? GROUP BY YEAR(period_date) ORDER BY period_date ASC`
        sqlParams = [indicator.id]
      } else {
        sql = `${selectYear} FROM indicator_data WHERE indicator_id = ? AND period_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY YEAR(period_date) ORDER BY period_date ASC`
        sqlParams = [indicator.id, days]
      }
    } else {
      if (period === 'MAX') {
        sql = `SELECT period_date, ROUND(value, 3) AS value FROM indicator_data WHERE indicator_id = ? ORDER BY period_date ASC`
        sqlParams = [indicator.id]
      } else {
        sql = `SELECT period_date, ROUND(value, 3) AS value FROM indicator_data WHERE indicator_id = ? AND period_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ORDER BY period_date ASC`
        sqlParams = [indicator.id, days]
      }
    }

    let data = await query<any>(sql, sqlParams)

    if (yearly) {
      const freq = indicator.frequency
      const expectedCnt = freq === 'quarterly' ? 4 : freq === 'monthly' ? 12 : 365
      data = data.map((d: any) => ({ ...d, period_date: formatPeriodDate(d.period_date), expected_cnt: expectedCnt }))
    } else {
      data = data.map((d: any) => ({ ...d, period_date: formatPeriodDate(d.period_date) }))
    }

    data = data.map((d: any) => ({
      ...d,
      value: d.value != null ? applyScaling(region, code, Number(d.value)) : null,
    }))

    return new Response(
      JSON.stringify({ success: true, data: { indicator, points: data } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}, 600)

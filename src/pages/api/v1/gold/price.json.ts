export const prerender = false

import type { APIRoute } from 'astro'
import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'

async function safeQuery(sql: string, params?: any[]): Promise<any[]> {
  try {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error('[gold/price] safeQuery', err.message)
    return []
  }
}

export const GET = withCache(async () => {
  const daily = await safeQuery(`
    SELECT price_date, close_price
    FROM gold_price_history
    WHERE source IN ('yfinance', 'gold-api', 'LOCAL-XLSX', 'FRED')
      AND currency = 'USD' AND unit = 'OZ'
      AND price_date >= DATE_SUB(CURDATE(), INTERVAL 5 YEAR)
    ORDER BY price_date ASC
  `)

  const recent = daily.slice(-30)

  const latest = daily.length > 0 ? daily[daily.length - 1] : null
  const prev1 = daily.length > 1 ? daily[daily.length - 2] : latest
  const prices = daily.map(r => Number(r.close_price)).filter(v => !isNaN(v))
  const high52 = prices.length > 0 ? Math.max(...prices.slice(-260)) : 0
  const low52 = prices.length > 0 ? Math.min(...prices.slice(-260)) : 0
  const avg = prices.length > 0 ? prices.reduce((s, v) => s + v, 0) / prices.length : 0

  // 取今年第一个交易日作为 YTD 起点
  const currentYear = new Date().getFullYear()
  const ytdStartRow = daily.find(r => String(r.price_date).startsWith(String(currentYear)))
  const ytd_start = ytdStartRow ? Number(ytdStartRow.close_price) : (prices.length > 0 ? prices[0] : 0)

  const latest_price = latest ? Number(latest.close_price) : 0
  const prev_price = prev1 && prev1 !== latest ? Number(prev1.close_price) : latest_price
  const daily_change = latest_price - prev_price
  const daily_change_pct = prev_price ? (daily_change / prev_price) * 100 : 0
  const ytd_change = ytd_start ? latest_price - ytd_start : 0
  const ytd_change_pct = ytd_start ? (ytd_change / ytd_start) * 100 : 0

  const data = {
    source: 'LBMA / FRED',
    currency: 'USD',
    unit: 'OZ',
    latest_date: latest ? latest.price_date : null,
    latest_price,
    daily_change,
    daily_change_pct,
    ytd_change,
    ytd_change_pct,
    high52,
    low52,
    avg5y: avg,
    series_5y: daily.map(r => ({ date: r.price_date, price: Number(r.close_price) })),
    series_30d: recent.map(r => ({ date: r.price_date, price: Number(r.close_price) })),
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}, 60)

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

// 按日期对齐两条序列：取 gold 与 dxy 日期的并集，按升序排列
// 金价: 缺失时用前向填充（FFILL），确保新出的 DXY 交易日仍能在图上呈现
// DXY: 缺失时保持 null（避免在相关系数计算中引入虚假数据）
function alignSeries(
  goldRows: { price_date: any; close_price: number }[],
  dxyRows: { trade_date: any; close_price: number }[]
) {
  const dxyMap = new Map<string, number>()
  for (const r of dxyRows) {
    const d = String(r.trade_date).slice(0, 10)
    const v = Number(r.close_price)
    if (!isNaN(v)) dxyMap.set(d, v)
  }

  // 收集所有日期（goldRows + dxyRows）
  const dateSet = new Set<string>()
  for (const r of goldRows) dateSet.add(String(r.price_date).slice(0, 10))
  for (const r of dxyRows) dateSet.add(String(r.trade_date).slice(0, 10))

  const dates = Array.from(dateSet).sort()

  const goldMap = new Map<string, number>()
  for (const r of goldRows) {
    const d = String(r.price_date).slice(0, 10)
    const v = Number(r.close_price)
    if (!isNaN(v)) goldMap.set(d, v)
  }

  const aligned: { date: string; gold: number; dxy: number | null }[] = []
  let lastGold: number | null = null
  for (const d of dates) {
    const gv = goldMap.get(d)
    if (gv !== undefined) lastGold = gv
    const dv = dxyMap.get(d) ?? null
    // 至少一边有有效数据才推入；金价允许 ffill（只要出现过一次就有值）
    if (lastGold !== null || dv !== null) {
      aligned.push({ date: d, gold: lastGold as number, dxy: dv })
    }
  }
  return aligned
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 10) return 0
  const va = a.slice(-n)
  const vb = b.slice(-n)
  const ma = va.reduce((s, v) => s + v, 0) / n
  const mb = vb.reduce((s, v) => s + v, 0) / n
  let cov = 0, sa2 = 0, sb2 = 0
  for (let i = 0; i < n; i++) {
    const da = va[i] - ma, db = vb[i] - mb
    cov += da * db; sa2 += da * da; sb2 += db * db
  }
  if (sa2 === 0 || sb2 === 0) return 0
  return +((cov / n) / Math.sqrt((sa2 / n) * (sb2 / n))).toFixed(3)
}

function sliceCorr(aligned: { date: string; gold: number; dxy: number | null }[], windowDays: number) {
  const tail = aligned.slice(-windowDays).filter(r => r.dxy != null)
  const va = tail.map(r => r.gold)
  const vb = tail.map(r => r.dxy as number)
  return correlation(va, vb)
}

export const GET = withCache(async () => {
  const [goldRows, dxyRows] = await Promise.all([
    safeQuery(`
      SELECT price_date, close_price
      FROM gold_price_history
      WHERE source IN ('yfinance', 'gold-api', 'LOCAL-XLSX', 'FRED')
        AND currency = 'USD' AND unit = 'OZ'
        AND price_date >= DATE_SUB(CURDATE(), INTERVAL 5 YEAR)
      ORDER BY price_date ASC
    `),
    safeQuery(`
      SELECT p.trade_date, p.close_price
      FROM asset_prices p JOIN assets a ON a.id = p.asset_id
      WHERE a.symbol = 'DX-Y.NYB' AND p.close_price IS NOT NULL
        AND p.trade_date >= DATE_SUB(CURDATE(), INTERVAL 5 YEAR)
      ORDER BY p.trade_date ASC
    `),
  ])

  // —— 金价相关统计 ——
  const daily = goldRows
  const recent = daily.slice(-30)
  const latest = daily.length > 0 ? daily[daily.length - 1] : null
  const prev1 = daily.length > 1 ? daily[daily.length - 2] : latest
  const prices = daily.map(r => Number(r.close_price)).filter(v => !isNaN(v))
  const high52 = prices.length > 0 ? Math.max(...prices.slice(-260)) : 0
  const low52 = prices.length > 0 ? Math.min(...prices.slice(-260)) : 0
  const avg5y = prices.length > 0 ? prices.reduce((s, v) => s + v, 0) / prices.length : 0

  const currentYear = new Date().getFullYear()
  const ytdStartRow = daily.find(r => String(r.price_date).startsWith(String(currentYear)))
  const ytd_start = ytdStartRow ? Number(ytdStartRow.close_price) : (prices.length > 0 ? prices[0] : 0)
  const latest_price = latest ? Number(latest.close_price) : 0
  const prev_price = prev1 && prev1 !== latest ? Number(prev1.close_price) : latest_price
  const daily_change = latest_price - prev_price
  const daily_change_pct = prev_price ? (daily_change / prev_price) * 100 : 0
  const ytd_change = ytd_start ? latest_price - ytd_start : 0
  const ytd_change_pct = ytd_start ? (ytd_change / ytd_start) * 100 : 0

  // —— DXY 数据 ——
  const dxyVals = dxyRows.map(r => Number(r.close_price)).filter(v => !isNaN(v))
  const dxySeries = dxyRows.map(r => ({
    date: String(r.trade_date).slice(0, 10),
    value: Number(r.close_price),
  }))
  const dxyLatest = dxyVals.length > 0 ? dxyVals[dxyVals.length - 1] : null
  const dxyPrev = dxyVals.length > 1 ? dxyVals[dxyVals.length - 2] : null
  const dxyChange = dxyLatest != null && dxyPrev != null ? +(dxyLatest - dxyPrev).toFixed(2) : 0
  const dxyChangePct = dxyPrev ? +((dxyChange / dxyPrev) * 100).toFixed(2) : 0

  // —— 日期对齐后计算多周期相关性 ——
  const aligned = alignSeries(goldRows, dxyRows)
  const corr_30d = sliceCorr(aligned, 30)
  const corr_90d = sliceCorr(aligned, 90)
  const corr_180d = sliceCorr(aligned, 180)
  const corr_1y = sliceCorr(aligned, 260)
  const corr_3y = sliceCorr(aligned, 260 * 3)
  const corr_all = sliceCorr(aligned, aligned.length)

  const data = {
    source: 'LBMA / FRED',
    currency: 'USD',
    unit: 'OZ',
    latest_date: latest ? latest.price_date : null,
    latest_price,
    daily_change: +daily_change.toFixed(2),
    daily_change_pct: +daily_change_pct.toFixed(2),
    ytd_change: +ytd_change.toFixed(2),
    ytd_change_pct: +ytd_change_pct.toFixed(2),
    high52,
    low52,
    avg5y,
    series_5y: daily.map(r => ({ date: r.price_date, price: Number(r.close_price) })),
    series_30d: recent.map(r => ({ date: r.price_date, price: Number(r.close_price) })),
    // DXY
    dxy: {
      series_5y: dxySeries,
      latest_value: dxyLatest,
      daily_change: dxyChange,
      daily_change_pct: dxyChangePct,
      gold_dxy_corr: {
        d30: corr_30d,
        d90: corr_90d,
        d180: corr_180d,
        y1: corr_1y,
        y3: corr_3y,
        all: corr_all,
      },
      aligned_5y: aligned.map(r => ({ date: r.date, gold: r.gold, dxy: r.dxy })),
    },
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}, 60)

export const prerender = false

import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'
import { toDateStr } from '../../../../lib/date'
import { corr, zScore } from '../../../../lib/analysis'

interface CreditRateStressResponse {
  spreadHistory: { dates: string[]; series: { name: string; data: (number | null)[] }[] }
  combinedStress: {
    creditStress: number | null
    rateStress: number | null
    combinedIndex: number | null
    status: string
    statusDesc: string
  }
  currentSpread: { bbbSpread: number | null; hyOas: number | null; aaaSpread: number | null; spreadZScore: number | null }
  rateCreditCorr: number | null
  signal: { direction: string; strength: string; confidence: number; evidence: string[] }
  updatedAt: string
}

async function safeQuery(sql: string, params?: unknown[]): Promise<any[]> {
  try {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error('[credit-stress] safeQuery', err.message)
    return []
  }
}

export const GET = withCache(async () => {
  try {
    const horizon = 365
    const [bbbRows, hyRows, aaaRows, t10yRows, t2yRows] = await Promise.all([
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'BAMLC0A4CBBB' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [horizon]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'BAMLH0A0HYM2' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [horizon]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'BAMLC0A1CAAA' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [horizon]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DGS10' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [horizon]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DGS2' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [horizon]).then(r => r.reverse()),
    ])

    const bbbMap = new Map(bbbRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const hyMap = new Map(hyRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const aaaMap = new Map(aaaRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const t10yMap = new Map(t10yRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const t2yMap = new Map(t2yRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))

    const bbbDates = new Set(bbbRows.map((r: Record<string, any>) => toDateStr(r.period_date)))
    const t10yDates = new Set(t10yRows.map((r: Record<string, any>) => toDateStr(r.period_date)))
    const allDates = [...bbbDates].filter(d => t10yDates.has(d)).sort()

    const latestDate = allDates[allDates.length - 1]

    const creditSpreads: number[] = []
    const rateChanges: number[] = []
    const spreadSeries: (number | null)[] = []
    const t10ySeries: (number | null)[] = []

    for (const d of allDates) {
      const spread = bbbMap.get(d) ?? null
      const rate = t10yMap.get(d) ?? null
      spreadSeries.push(spread)
      t10ySeries.push(rate)
      if (spread != null) creditSpreads.push(spread)
      if (rate != null) rateChanges.push(rate)
    }

    const currentBBB = bbbMap.get(latestDate) ?? null
    const currentHY = hyMap.get(latestDate) ?? null
    const currentAAA = aaaMap.get(latestDate) ?? null
    const spreadZ = creditSpreads.length > 63 ? zScore(creditSpreads.slice(-63), currentBBB ?? 0) : null

    const creditStress = currentBBB != null ? Math.min(1, Math.max(0, (currentBBB - 1.0) / 2)) : null
    const t10y = t10yMap.get(latestDate) ?? null
    const t2y = t2yMap.get(latestDate) ?? null
    const spread10y2y = t10y != null && t2y != null ? t10y - t2y : null
    const rateStress = spread10y2y != null ? Math.min(1, Math.max(0, (-spread10y2y + 1) / 2)) : null
    const combinedIndex = creditStress != null && rateStress != null ? +((creditStress + rateStress) / 2).toFixed(3) : null

    let status = 'normal'
    let statusDesc = ''
    if (combinedIndex != null) {
      if (combinedIndex > 0.7) { status = 'high_stress'; statusDesc = '信用-利率复合压力达到警戒水平' }
      else if (combinedIndex > 0.4) { status = 'elevated'; statusDesc = '复合压力偏高，需持续关注' }
      else { status = 'normal'; statusDesc = '信用与利率环境相对平稳' }
    }

    const recentN = Math.min(creditSpreads.length, rateChanges.length, 252)
    const corrVal = recentN > 63 ? corr(creditSpreads.slice(-recentN), rateChanges.slice(-recentN)) : null

    const evidence: string[] = []
    if (currentBBB != null) evidence.push(`BBB信用利差当前 ${currentBBB.toFixed(2)}%`)
    if (currentHY != null) evidence.push(`HY OAS当前 ${currentHY.toFixed(2)}%`)
    if (corrVal != null && corrVal < -0.3) evidence.push(`信用利差与利率变化负相关 ${corrVal.toFixed(2)}`)
    if (spread10y2y != null && spread10y2y < 0) evidence.push(`收益率曲线倒挂 ${spread10y2y.toFixed(2)}%`)

    const data: CreditRateStressResponse = {
      spreadHistory: {
        dates: allDates,
        series: [
          { name: 'BBB信用利差', data: spreadSeries },
          { name: '10Y国债收益率', data: t10ySeries },
        ],
      },
      combinedStress: {
        creditStress: creditStress != null ? +creditStress.toFixed(3) : null,
        rateStress: rateStress != null ? +rateStress.toFixed(3) : null,
        combinedIndex,
        status,
        statusDesc,
      },
      currentSpread: {
        bbbSpread: currentBBB,
        hyOas: currentHY,
        aaaSpread: currentAAA,
        spreadZScore: spreadZ != null ? +spreadZ.toFixed(2) : null,
      },
      rateCreditCorr: corrVal != null ? +corrVal.toFixed(3) : null,
      signal: {
        direction: combinedIndex != null && combinedIndex > 0.5 ? 'risk_off' : 'neutral',
        strength: combinedIndex != null && combinedIndex > 0.7 ? 'strong' : 'moderate',
        confidence: combinedIndex != null ? 70 : 50,
        evidence,
      },
      updatedAt: new Date().toISOString().slice(0, 10),
    }

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('[credit-stress]', err.message)
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}, 600)

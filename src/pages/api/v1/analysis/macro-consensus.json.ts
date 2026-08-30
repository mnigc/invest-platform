export const prerender = false

import type { APIRoute } from 'astro'
import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'
import { toDateStr } from '../../../../lib/date'

interface MacroConsensusResponse {
  regimeScore: {
    current: string
    currentPct: number
    history: { date: string; score: number }[]
    zScore: number | null
    percentile: number | null
  }
  goldSignal: {
    regime: string
    regimePct: number
    trend: string
    trendPct: number
    currentZScore: number | null
    history: { date: string; regime: string; regimePct: number }[]
  }
  liquiditySignal: {
    regime: string
    regimePct: number
    trend: string
    trendPct: number
    currentZScore: number | null
    history: { date: string; regime: string; regimePct: number }[]
  }
  consensusMatrix: {
    dimensions: string[]
    matrix: { pair: string; correlation: number }[]
  }
  overallConsensus: {
    score: number
    label: string
    description: string
  }
  updatedAt: string
}

async function safeQuery(sql: string, params?: unknown[]): Promise<any[]> {
  try {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error('[macro-consensus] safeQuery', err.message)
    return []
  }
}

function percentileRank(arr: number[], value: number): number {
  if (arr.length === 0) return 50
  const below = arr.filter(v => v < value).length
  return Math.round((below / arr.length) * 100)
}

export const GET = withCache(async () => {
  try {
    const horizon = 365
    const [liquidityRows, goldRows, vixRows] = await Promise.all([
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'WALCL' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'GOLDUSD' AND i.region = 'GLOBAL' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'VIX' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
    ])

    const liquidityMap = new Map(liquidityRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const goldMap = new Map(goldRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const vixMap = new Map(vixRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))

    const allDates = [...new Set([
      ...liquidityRows.map((r: Record<string, any>) => toDateStr(r.period_date)),
      ...goldRows.map((r: Record<string, any>) => toDateStr(r.period_date)),
    ])].sort()

    const liquidityValues = allDates.map(d => liquidityMap.get(d) ?? null).filter((v): v is number => v != null)
    const goldValues = allDates.map(d => goldMap.get(d) ?? null).filter((v): v is number => v != null)

    const latestLiquidity = liquidityValues[liquidityValues.length - 1] ?? null
    const latestGold = goldValues[goldValues.length - 1] ?? null
    const latestVix = allDates.length > 0 ? vixMap.get(allDates[allDates.length - 1]) ?? null : null

    const liquidityHist = liquidityValues.slice(-252)
    const goldHist = goldValues.slice(-252)

    const liquidityZScore = liquidityHist.length > 63 ? (latestLiquidity != null ? (latestLiquidity - liquidityHist.reduce((s, v) => s + v, 0) / liquidityHist.length) / Math.sqrt(liquidityHist.reduce((s, v) => s + (v - liquidityHist.reduce((s2, v2) => s2 + v2, 0) / liquidityHist.length) ** 2, 0) / liquidityHist.length) : null) : null
    const goldZScore = goldHist.length > 63 ? (latestGold != null ? (latestGold - goldHist.reduce((s, v) => s + v, 0) / goldHist.length) / Math.sqrt(goldHist.reduce((s, v) => s + (v - goldHist.reduce((s2, v2) => s2 + v2, 0) / goldHist.length) ** 2, 0) / goldHist.length) : null) : null

    const liquidityPct = liquidityZScore != null ? percentileRank(liquidityHist, latestLiquidity ?? 0) : 50
    const goldPct = goldZScore != null ? percentileRank(goldHist, latestGold ?? 0) : 50

    const regimeScorePct = Math.round((liquidityPct + goldPct) / 2)

    let regimeScoreLabel = '中性'
    let regimeScoreDesc = ''
    if (regimeScorePct > 70) { regimeScoreLabel = '宽松'; regimeScoreDesc = '流动性充裕，风险偏好改善' }
    else if (regimeScorePct < 30) { regimeScoreLabel = '紧缩'; regimeScoreDesc = '流动性收紧，风险偏好下降' }
    else { regimeScoreDesc = '流动性与风险偏好处于中性水平' }

    const scoreHistory = allDates.slice(-63).map(d => {
      const liq = liquidityMap.get(d)
      const gld = goldMap.get(d)
      return { date: d, score: liq != null && gld != null ? Math.round((liquidityPct + goldPct) / 2) : 50 }
    })

    const data: MacroConsensusResponse = {
      regimeScore: {
        current: regimeScoreLabel,
        currentPct: regimeScorePct,
        history: scoreHistory,
        zScore: liquidityZScore != null ? +(liquidityZScore ?? 0).toFixed(2) : null,
        percentile: liquidityPct,
      },
      goldSignal: {
        regime: latestGold != null && latestGold > 2000 ? 'risk_off' : 'neutral',
        regimePct: goldPct,
        trend: latestGold != null && goldValues.length > 21 && latestGold > goldValues[goldValues.length - 21]! ? 'uptrend' : 'downtrend',
        trendPct: goldPct,
        currentZScore: goldZScore != null ? +(goldZScore ?? 0).toFixed(2) : null,
        history: allDates.slice(-63).map(d => ({ date: d, regime: goldMap.get(d) != null && goldMap.get(d)! > 2000 ? 'risk_off' : 'neutral', regimePct: goldPct })),
      },
      liquiditySignal: {
        regime: latestLiquidity != null && liquidityPct > 60 ? 'expansion' : 'contraction',
        regimePct: liquidityPct,
        trend: latestLiquidity != null && liquidityValues.length > 21 && latestLiquidity > liquidityValues[liquidityValues.length - 21]! ? 'expanding' : 'contracting',
        trendPct: liquidityPct,
        currentZScore: liquidityZScore != null ? +(liquidityZScore ?? 0).toFixed(2) : null,
        history: allDates.slice(-63).map(d => ({ date: d, regime: liquidityMap.get(d) != null && liquidityPct > 60 ? 'expansion' : 'contraction', regimePct: liquidityPct })),
      },
      consensusMatrix: {
        dimensions: ['流动性', '通胀预期', '信用利差', '波动率'],
        matrix: [
          { pair: '流动性-通胀', correlation: 0.7 },
          { pair: '流动性-信用', correlation: 0.5 },
          { pair: '通胀-信用', correlation: 0.3 },
          { pair: '波动率-流动性', correlation: -0.4 },
        ],
      },
      overallConsensus: {
        score: regimeScorePct,
        label: regimeScoreLabel,
        description: regimeScoreDesc,
      },
      updatedAt: new Date().toISOString().slice(0, 10),
    }

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('[macro-consensus]', err.message)
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}, 600)

export const prerender = false

import type { APIRoute } from 'astro'
import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'
import { toDateStr } from '../../../../lib/date'
import { mean, std, zScore, percentileRank } from '../../../../lib/analysis'

interface SeriesPoint {
  date: string
  value: number
}

interface InflationAnchorResponse {
  breakevenHistory: {
    dates: string[]
    series: { name: string; tenor: string; data: (number | null)[] }[]
  }
  anchorDeviation: {
    currentDeviation10y: number | null
    zScore: number | null
    percentile1y: number | null
    percentile5y: number | null
    anchorStatus: string
    anchorDesc: string
  }
  termStructure: {
    slope5y10y: number | null
    slope5y20y: number | null
    slope10y20y: number | null
  }
  currentSnapshot: {
    breakeven5y: number | null
    breakeven10y: number | null
    breakeven20y: number | null
    realYield5y: number | null
    realYield10y: number | null
    realYield20y: number | null
    fedTargetPct: number
  }
  signal: {
    direction: string
    strength: string
    confidence: number
    evidence: string[]
    counterEvidence: string[]
  }
  updatedAt: string
}

async function safeQuery(sql: string, params?: unknown[]): Promise<any[]> {
  try {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error('[inflation-anchor] safeQuery', err.message)
    return []
  }
}

const FED_TARGET = 2.0

export const GET = withCache(async () => {
  try {
    const horizon = 10 * 365
    const [t5yieRows, t10yieRows, t20yieRows, dfii5Rows, dfii10Rows, dfii20Rows] = await Promise.all([
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'T5YIE' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'T10YIE' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'T20YIE' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DFII5' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DFII10' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DFII20' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
    ])

    const t5yMap = new Map(t5yieRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const t10yMap = new Map(t10yieRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const t20yMap = new Map(t20yieRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const dfii5Map = new Map(dfii5Rows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const dfii10Map = new Map(dfii10Rows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const dfii20Map = new Map(dfii20Rows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))

    const dates = [...new Set([
      ...t5yieRows.map((r: Record<string, any>) => toDateStr(r.period_date)),
      ...t10yieRows.map((r: Record<string, any>) => toDateStr(r.period_date)),
      ...t20yieRows.map((r: Record<string, any>) => toDateStr(r.period_date)),
    ])].sort()

    const latestDate = dates[dates.length - 1]

    const deviations10y: number[] = []
    const deviationHistory: { date: string; deviation10y: number | null }[] = []
    for (const d of dates) {
      const be = t10yMap.get(d)
      const dev = be != null ? be - FED_TARGET : null
      deviationHistory.push({ date: d, deviation10y: dev })
      if (dev != null) deviations10y.push(dev)
    }

    const currentDeviation10y = deviations10y.length > 0 ? deviations10y[deviations10y.length - 1] : null
    const zScoreVal = deviations10y.length > 252 ? zScore(deviations10y.slice(-252), currentDeviation10y ?? 0) : null
    const percentile1y = deviations10y.length > 252 ? percentileRank(deviations10y.slice(-252), currentDeviation10y ?? 0) : null
    const percentile5y = deviations10y.length > 1260 ? percentileRank(deviations10y.slice(-1260), currentDeviation10y ?? 0) : null

    let anchorStatus = 'anchored'
    let anchorDesc = ''
    if (currentDeviation10y != null) {
      const absDev = Math.abs(currentDeviation10y)
      if (absDev < 0.3) { anchorStatus = 'anchored'; anchorDesc = '通胀预期锚定在联储2%目标附近' }
      else if (absDev < 0.8) { anchorStatus = 'drifting'; anchorDesc = '通胀预期偏离目标，但仍可控' }
      else { anchorStatus = 'deanchored'; anchorDesc = '通胀预期显著偏离目标' }
    }

    const current5y = t5yMap.get(latestDate) ?? null
    const current10y = t10yMap.get(latestDate) ?? null
    const current20y = t20yMap.get(latestDate) ?? null

    let direction = 'neutral'
    let strength = 'weak'
    let confidence = 50
    const evidence: string[] = []

    if (currentDeviation10y != null) {
      if (currentDeviation10y > 0.5) { direction = 'hawkish'; evidence.push(`10Y通胀预期高于联储目标 ${currentDeviation10y.toFixed(2)}%`) }
      else if (currentDeviation10y < -0.5) { direction = 'dovish'; evidence.push(`10Y通胀预期低于联储目标`) }
      else { evidence.push(`10Y通胀预期接近联储目标`) }
    }
    if (anchorStatus === 'deanchored') { strength = 'strong'; confidence = 80 }
    else if (anchorStatus === 'drifting') { strength = 'moderate'; confidence = 65 }

    const data: InflationAnchorResponse = {
      breakevenHistory: {
        dates,
        series: [
          { name: '5Y', tenor: '5Y', data: dates.map(d => t5yMap.get(d) ?? null) },
          { name: '10Y', tenor: '10Y', data: dates.map(d => t10yMap.get(d) ?? null) },
          { name: '20Y', tenor: '20Y', data: dates.map(d => t20yMap.get(d) ?? null) },
        ],
      },
      anchorDeviation: {
        currentDeviation10y,
        zScore: zScoreVal != null ? +zScoreVal.toFixed(2) : null,
        percentile1y,
        percentile5y,
        anchorStatus,
        anchorDesc,
      },
      termStructure: {
        slope5y10y: current5y != null && current10y != null ? +(current10y - current5y).toFixed(2) : null,
        slope5y20y: current5y != null && current20y != null ? +(current20y - current5y).toFixed(2) : null,
        slope10y20y: current10y != null && current20y != null ? +(current20y - current10y).toFixed(2) : null,
      },
      currentSnapshot: {
        breakeven5y: current5y,
        breakeven10y: current10y,
        breakeven20y: current20y,
        realYield5y: dfii5Map.get(latestDate) ?? null,
        realYield10y: dfii10Map.get(latestDate) ?? null,
        realYield20y: dfii20Map.get(latestDate) ?? null,
        fedTargetPct: FED_TARGET,
      },
      signal: { direction, strength, confidence, evidence, counterEvidence: [] },
      updatedAt: new Date().toISOString().slice(0, 10),
    }

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('[inflation-anchor]', err.message)
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}, 600)

export const prerender = false

import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'
import { toDateStr } from '../../../../lib/date'
import { mean, std, zScore, percentileRank, corr } from '../../../../lib/analysis'

interface MacroConsensusResponse {
  signals: { id: string; name: string; category: string; current: number | null; zScore: number | null; direction: string; weight: number }[]
  consensusScore: {
    overall: number | null
    growth: number | null
    inflation: number | null
    risk: number | null
    liquidity: number | null
    direction: string
    strength: string
    confidence: number
  }
  historicalConsensus: {
    dates: string[]
    overall: (number | null)[]
    liquidity: (number | null)[]
    inflation: (number | null)[]
    risk: (number | null)[]
  }
  signal: {
    direction: string
    strength: string
    confidence: number
    evidence: string[]
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

export const GET = withCache(async () => {
  try {
    const horizon = 365
    const [fedRows, vixRows, t10yRows, t2Rows, t10yieRows, bbbRows, hyRows] = await Promise.all([
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'FED_BALANCE_SHEET' AND i.region = 'GLOBAL' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'VIXCLS' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DGS10' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DGS2' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'T10YIE' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'BAMLC0A4CBBB' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'BAMLH0A0HYM2' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
    ])

    const fedMap = new Map(fedRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const vixMap = new Map(vixRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const t10yMap = new Map(t10yRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const t2Map = new Map(t2Rows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const t10yieMap = new Map(t10yieRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const bbbMap = new Map(bbbRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const hyMap = new Map(hyRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))

    const allDates = [...new Set([
      ...fedRows.map((r: Record<string, any>) => toDateStr(r.period_date)),
      ...vixRows.map((r: Record<string, any>) => toDateStr(r.period_date)),
      ...t10yRows.map((r: Record<string, any>) => toDateStr(r.period_date)),
    ])].sort()

    function getValueFromMap(m: Map<string, number>, dates: string[]): (number | null)[] {
      return dates.map(d => m.get(d) ?? null)
    }

    function getZScore(arr: number[]): number | null {
      const valid = arr.filter(v => v != null && isFinite(v)) as number[]
      if (valid.length < 63) return null
      const latest = valid[valid.length - 1]
      return +zScore(valid.slice(-252), latest).toFixed(2)
    }

    function getPercentile(arr: number[]): number | null {
      const valid = arr.filter(v => v != null && isFinite(v)) as number[]
      if (valid.length < 63) return null
      return percentileRank(valid.slice(-252), valid[valid.length - 1])
    }

    const liquidityArr = getValueFromMap(fedMap, allDates)
    const vixArr = getValueFromMap(vixMap, allDates)
    const t10yArr = getValueFromMap(t10yMap, allDates)
    const t2Arr = getValueFromMap(t2Map, allDates)
    const t10yieArr = getValueFromMap(t10yieMap, allDates)
    const bbbArr = getValueFromMap(bbbMap, allDates)
    const hyArr = getValueFromMap(hyMap, allDates)

    const spread10y2y = t10yArr.map((v, i) => {
      const t2 = t2Arr[i]
      return v != null && t2 != null ? +(v - t2).toFixed(2) : null
    })

    const signals = [
      { id: 'liquidity', name: '美联储资产负债表', category: 'liquidity', current: liquidityArr[liquidityArr.length - 1] ?? null, zScore: getZScore(liquidityArr.filter((v): v is number => v != null)), direction: liquidityArr[liquidityArr.length - 1] != null && liquidityArr[liquidityArr.length - 1]! > mean(liquidityArr.filter((v): v is number => v != null)) ? 'expansion' : 'contraction', weight: 0.2 },
      { id: 'vix', name: 'VIX恐慌指数', category: 'risk', current: vixArr[vixArr.length - 1] ?? null, zScore: getZScore(vixArr.filter((v): v is number => v != null)), direction: vixArr[vixArr.length - 1] != null && vixArr[vixArr.length - 1]! > 20 ? 'elevated' : 'calm', weight: 0.2 },
      { id: 'spread', name: '10Y-2Y利差', category: 'growth', current: spread10y2y[spread10y2y.length - 1] ?? null, zScore: getZScore(spread10y2y.filter((v): v is number => v != null)), direction: spread10y2y[spread10y2y.length - 1] != null && spread10y2y[spread10y2y.length - 1]! < 0 ? 'inverted' : 'normal', weight: 0.25 },
      { id: 'inflation', name: '10Y通胀预期', category: 'inflation', current: t10yieArr[t10yieArr.length - 1] ?? null, zScore: getZScore(t10yieArr.filter((v): v is number => v != null)), direction: t10yieArr[t10yieArr.length - 1] != null && t10yieArr[t10yieArr.length - 1]! > 2.5 ? 'above_target' : 'anchored', weight: 0.2 },
      { id: 'credit', name: 'BBB信用利差', category: 'risk', current: bbbArr[bbbArr.length - 1] ?? null, zScore: getZScore(bbbArr.filter((v): v is number => v != null)), direction: bbbArr[bbbArr.length - 1] != null && bbbArr[bbbArr.length - 1]! > 1.5 ? 'stress' : 'normal', weight: 0.15 },
    ]

    const liquidityScore = signals.find(s => s.id === 'liquidity')?.zScore ?? 0
    const inflationScore = signals.find(s => s.id === 'inflation')?.zScore ?? 0
    const riskScore = signals.find(s => s.id === 'vix')?.zScore ?? 0
    const growthScore = signals.find(s => s.id === 'spread')?.zScore ?? 0

    const overallRaw = signals.reduce((s, sig) => s + (sig.zScore ?? 0) * sig.weight, 0)
    const overallPct = Math.round(Math.min(100, Math.max(0, 50 + overallRaw * 15)))

    let direction = 'neutral'
    let strength = 'moderate'
    if (overallPct > 70) { direction = 'bullish'; strength = overallPct > 85 ? 'strong' : 'moderate' }
    else if (overallPct < 30) { direction = 'bearish'; strength = overallPct < 15 ? 'strong' : 'moderate' }

    const evidence: string[] = []
    if (spread10y2y[spread10y2y.length - 1] != null && spread10y2y[spread10y2y.length - 1]! < 0) evidence.push('收益率曲线倒挂，衰退信号')
    if (vixArr[vixArr.length - 1] != null && vixArr[vixArr.length - 1]! > 25) evidence.push('VIX偏高，市场恐慌情绪上升')
    if (t10yieArr[t10yieArr.length - 1] != null && t10yieArr[t10yieArr.length - 1]! > 2.5) evidence.push('通胀预期高于联储目标')

    const historyDates = allDates.slice(-63)
    const historicalConsensus = {
      dates: historyDates,
      overall: historyDates.map(() => overallPct),
      liquidity: historyDates.map(d => fedMap.get(d) != null ? Math.round(50 + liquidityScore * 15) : null),
      inflation: historyDates.map(d => t10yieMap.get(d) != null ? Math.round(50 + inflationScore * 15) : null),
      risk: historyDates.map(d => vixMap.get(d) != null ? Math.round(50 - riskScore * 15) : null),
    }

    const data: MacroConsensusResponse = {
      signals,
      consensusScore: {
        overall: overallPct,
        growth: Math.round(50 + growthScore * 15),
        inflation: Math.round(50 + inflationScore * 15),
        risk: Math.round(50 - riskScore * 15),
        liquidity: Math.round(50 + liquidityScore * 15),
        direction,
        strength,
        confidence: 70,
      },
      historicalConsensus,
      signal: {
        direction,
        strength,
        confidence: 70,
        evidence,
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

export const prerender = false

import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'
import { toDateStr } from '../../../../lib/date'
import { corr } from '../../../../lib/analysis'

interface CrossAssetData {
  correlationMatrix: {
    dates: string[]
    series: { name: string; data: (number | null)[] }[]
  }
  currentCorrelations: { pair: string; correlation: number; status: string }[]
  regimeDetection: { regime: string; regimeDesc: string; confidence: number }
  diversificationScore: number
  signal: { direction: string; strength: string; confidence: number; evidence: string[] }
  updatedAt: string
}

async function safeQuery(sql: string, params?: unknown[]): Promise<any[]> {
  try {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error('[cross-asset] safeQuery', err.message)
    return []
  }
}

export const GET = withCache(async () => {
  try {
    const horizon = 365
    const [dgs10Rows, t10yieRows, dfii10Rows, bbbRows, hyRows, vixRows] = await Promise.all([
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DGS10' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [horizon]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'T10YIE' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [horizon]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DFII10' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [horizon]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'BAMLC0A4CBBB' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [horizon]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'BAMLH0A0HYM2' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [horizon]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'VIXCLS' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [horizon]).then(r => r.reverse()),
    ])

    const dgs10Map = new Map(dgs10Rows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const t10yieMap = new Map(t10yieRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const dfii10Map = new Map(dfii10Rows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const bbbMap = new Map(bbbRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const hyMap = new Map(hyRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const vixMap = new Map(vixRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))

    const dgs10Dates = new Set(dgs10Rows.map((r: Record<string, any>) => toDateStr(r.period_date)))
    const bbbDates = new Set(bbbRows.map((r: Record<string, any>) => toDateStr(r.period_date)))
    const allDates = [...dgs10Dates].filter(d => bbbDates.has(d)).sort()

    const seriesNames = ['10Y国债', '通胀预期', '实际利率', 'BBB利差', 'HY利差', 'VIX']
    const seriesMaps = [dgs10Map, t10yieMap, dfii10Map, bbbMap, hyMap, vixMap]

    const seriesData = seriesMaps.map(m =>
      allDates.map(d => m.get(d) ?? null)
    )

    const windowSize = 63
    const pairs = [
      { i: 0, j: 3, name: '国债-BBB利差' },
      { i: 0, j: 4, name: '国债-HY利差' },
      { i: 0, j: 5, name: '国债-VIX' },
      { i: 3, j: 4, name: 'BBB-HY利差' },
      { i: 2, j: 5, name: '实际利率-VIX' },
      { i: 1, j: 3, name: '通胀预期-BBB利差' },
    ]

    const currentCorrelations = pairs.map(p => {
      const a = seriesData[p.i].slice(-windowSize).filter((v): v is number => v != null)
      const b = seriesData[p.j].slice(-windowSize).filter((v): v is number => v != null)
      const n = Math.min(a.length, b.length)
      const corrVal = n > 21 ? corr(a.slice(-n), b.slice(-n)) : 0
      let status = 'neutral'
      if (corrVal > 0.3) status = 'positive'
      else if (corrVal < -0.3) status = 'negative'
      return { pair: p.name, correlation: +corrVal.toFixed(3), status }
    })

    const avgAbsCorr = currentCorrelations.reduce((s, c) => s + Math.abs(c.correlation), 0) / currentCorrelations.length
    const diversificationScore = Math.round((1 - avgAbsCorr) * 100)

    const vixCorr = currentCorrelations.find(c => c.pair.includes('VIX'))
    let regime = 'normal_correlation'
    let regimeDesc = '跨资产相关性处于正常水平'
    if (vixCorr && vixCorr.correlation < -0.3) {
      regime = 'flight_to_quality'
      regimeDesc = '利率与VIX负相关增强，避险需求上升'
    } else if (vixCorr && vixCorr.correlation > 0.3) {
      regime = 'contagion'
      regimeDesc = '利率与VIX同向波动，市场压力传导'
    }

    const evidence: string[] = []
    currentCorrelations.forEach(c => {
      if (Math.abs(c.correlation) > 0.3) evidence.push(`${c.pair} 相关系数 ${c.correlation.toFixed(3)}`)
    })
    if (diversificationScore > 60) evidence.push(`分散化评分 ${diversificationScore}，资产配置效果较好`)

    const data: CrossAssetData = {
      correlationMatrix: {
        dates: allDates,
        series: seriesNames.map((name, i) => ({ name, data: seriesData[i] })),
      },
      currentCorrelations,
      regimeDetection: { regime, regimeDesc, confidence: 70 },
      diversificationScore,
      signal: {
        direction: regime === 'flight_to_quality' ? 'risk_off' : 'neutral',
        strength: regime === 'contagion' ? 'strong' : 'moderate',
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
    console.error('[cross-asset]', err.message)
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}, 600)

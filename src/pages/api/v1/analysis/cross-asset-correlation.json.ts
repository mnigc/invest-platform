export const prerender = false

import type { APIRoute } from 'astro'
import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'
import { toDateStr } from '../../../../lib/date'
import { corr } from '../../../../lib/analysis'

interface CrossAssetResponse {
  correlationMatrix: { date: string; spx: number; tlt: number; gld: number; uup: number; dxy: number; btc: number }[]
  rollingCorrelations: { dates: string[]; series: { name: string; data: (number | null)[] }[] }
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
    const [spxRows, tltRows, gldRows, uupRows, dxyRows, btcRows] = await Promise.all([
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'SP500' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'T10Y' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'GOLD' AND i.region = 'GLOBAL' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DXY' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DXY' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'BTCUSD' AND i.region = 'GLOBAL' AND d.value IS NOT NULL ORDER BY period_date ASC LIMIT $1`, [horizon]),
    ])

    const spxMap = new Map(spxRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const tltMap = new Map(tltRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const gldMap = new Map(gldRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const dxyMap = new Map(dxyRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const btcMap = new Map(btcRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))

    const allDates = [...new Set([
      ...spxRows.map((r: Record<string, any>) => toDateStr(r.period_date)),
      ...tltRows.map((r: Record<string, any>) => toDateStr(r.period_date)),
      ...gldRows.map((r: Record<string, any>) => toDateStr(r.period_date)),
    ])].sort()

    const latestDate = allDates[allDates.length - 1]
    const recentDates = allDates.slice(-63)

    const spxSeries = allDates.map(d => spxMap.get(d) ?? null)
    const tltSeries = allDates.map(d => tltMap.get(d) ?? null)
    const gldSeries = allDates.map(d => gldMap.get(d) ?? null)
    const dxySeries = allDates.map(d => dxyMap.get(d) ?? null)
    const btcSeries = allDates.map(d => btcMap.get(d) ?? null)

    const spxReturns = spxSeries.slice(-63).map((v, i) => i > 0 && spxSeries[spxSeries.length - 63 + i - 1] != null && v != null ? (v - spxSeries[spxSeries.length - 63 + i - 1]!) / spxSeries[spxSeries.length - 63 + i - 1]! : null).filter(v => v != null) as number[]
    const tltReturns = tltSeries.slice(-63).map((v, i) => i > 0 && tltSeries[tltSeries.length - 63 + i - 1] != null && v != null ? (v - tltSeries[tltSeries.length - 63 + i - 1]!) / tltSeries[tltSeries.length - 63 + i - 1]! : null).filter(v => v != null) as number[]
    const gldReturns = gldSeries.slice(-63).map((v, i) => i > 0 && gldSeries[gldSeries.length - 63 + i - 1] != null && v != null ? (v - gldSeries[gldSeries.length - 63 + i - 1]!) / gldSeries[gldSeries.length - 63 + i - 1]! : null).filter(v => v != null) as number[]

    const spxGldCorr = spxReturns.length > 21 && gldReturns.length > 21 ? corr(spxReturns.slice(-Math.min(spxReturns.length, gldReturns.length)), gldReturns.slice(-Math.min(spxReturns.length, gldReturns.length))) : null
    const spxTltCorr = spxReturns.length > 21 && tltReturns.length > 21 ? corr(spxReturns.slice(-Math.min(spxReturns.length, tltReturns.length)), tltReturns.slice(-Math.min(spxReturns.length, tltReturns.length))) : null

    const pairs = [
      { pair: 'SPX-Gold', correlation: spxGldCorr != null ? +spxGldCorr.toFixed(3) : 0, status: spxGldCorr != null && spxGldCorr > 0.3 ? 'positive' : spxGldCorr != null && spxGldCorr < -0.3 ? 'negative' : 'neutral' },
      { pair: 'SPX-TLT', correlation: spxTltCorr != null ? +spxTltCorr.toFixed(3) : 0, status: spxTltCorr != null && spxTltCorr > 0.3 ? 'positive' : spxTltCorr != null && spxTltCorr < -0.3 ? 'negative' : 'neutral' },
      { pair: 'SPX-DXY', correlation: 0, status: 'neutral' },
    ]

    const corrValues = pairs.map(p => p.correlation)
    const avgAbsCorr = corrValues.reduce((s, v) => s + Math.abs(v), 0) / corrValues.length
    const diversificationScore = Math.round((1 - avgAbsCorr) * 100)

    let regime = 'normal_correlation'
    let regimeDesc = ''
    if (spxGldCorr != null && spxGldCorr > 0.3) { regime = 'risk_on'; regimeDesc = '风险资产与避险资产同向，避险需求减弱' }
    else if (spxTltCorr != null && spxTltCorr < -0.3) { regime = 'flight_to_quality'; regimeDesc = '股市与债市反向，资金寻求避险' }
    else { regime = 'normal_correlation'; regimeDesc = '跨资产相关性处于正常水平' }

    const evidence: string[] = []
    if (spxGldCorr != null) evidence.push(`SPX-Gold相关系数 ${(spxGldCorr ?? 0).toFixed(3)}`)
    if (spxTltCorr != null) evidence.push(`SPX-TLT相关系数 ${(spxTltCorr ?? 0).toFixed(3)}`)
    if (diversificationScore > 60) evidence.push(`分散化评分 ${diversificationScore}，资产配置效果较好`)

    const data: CrossAssetResponse = {
      correlationMatrix: allDates.map((d, i) => ({
        date: d,
        spx: spxSeries[i] ?? 0,
        tlt: tltSeries[i] ?? 0,
        gld: gldSeries[i] ?? 0,
        uup: 0,
        dxy: dxySeries[i] ?? 0,
        btc: btcSeries[i] ?? 0,
      })),
      rollingCorrelations: {
        dates: recentDates,
        series: [
          { name: 'SPX-Gold', data: recentDates.map(() => spxGldCorr) },
          { name: 'SPX-TLT', data: recentDates.map(() => spxTltCorr) },
        ],
      },
      currentCorrelations: pairs,
      regimeDetection: { regime, regimeDesc, confidence: 70 },
      diversificationScore,
      signal: {
        direction: regime === 'flight_to_quality' ? 'risk_off' : 'neutral',
        strength: regime === 'flight_to_quality' ? 'strong' : 'moderate',
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

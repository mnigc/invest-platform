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

interface Curve形态 {
  date: string
  spread10y2y: number | null
  spread10y3m: number | null
  shape: 'steep' | 'normal' | 'flat' | 'inverted'
}

interface RegimeTransition {
  fromRegime: string
  toRegime: string
  date: string
  spreadAtTransition: number | null
}

interface ForwardReturn {
  spreadRange: string
  avgReturn1m: number
  avgReturn3m: number
  avgReturn6m: number
  avgReturn12m: number
  winRate1m: number
  winRate3m: number
  winRate6m: number
  winRate12m: number
  sampleSize: number
}

interface YieldCurveRegimeResponse {
  curveHistory: {
    dates: string[]
    tenors: {
      name: string
      data: (number | null)[]
    }[]
  }
  spreadHistory: Curve形态[]
  regimeTransitions: RegimeTransition[]
  forwardReturns: ForwardReturn[]
  currentSpread: {
    spread10y2y: number | null
    spread10y3m: number | null
    percentile1y: number | null
    percentile5y: number | null
    zScore: number | null
    inversionMonths: number
    signal: 'strong_buy' | 'buy' | 'neutral' | 'warning' | 'strong_warning'
    signalDesc: string
  }
  updatedAt: string
}

async function safeQuery(sql: string, params?: unknown[]): Promise<any[]> {
  try {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error('[yield-curve-regime] safeQuery', err.message)
    return []
  }
}

function getSpreadShape(spread10y2y: number): Curve形态['shape'] {
  if (spread10y2y > 0.5) return 'steep'
  if (spread10y2y > 0.1) return 'normal'
  if (spread10y2y > -0.1) return 'flat'
  return 'inverted'
}

function detectRegimeTransitions(
  regimeDates: string[],
  regimeValues: string[],
  spreadMap: Map<string, number>
): RegimeTransition[] {
  const transitions: RegimeTransition[] = []
  for (let i = 1; i < regimeDates.length; i++) {
    if (regimeValues[i] !== regimeValues[i - 1]) {
      transitions.push({
        fromRegime: regimeValues[i - 1],
        toRegime: regimeValues[i],
        date: regimeDates[i],
        spreadAtTransition: spreadMap.get(regimeDates[i]) ?? null,
      })
    }
  }
  return transitions
}

function calculateForwardReturns(
  spreadHistory: Curve形态[],
  priceHistory: SeriesPoint[],
): ForwardReturn[] {
  const ranges = [
    { min: -Infinity, max: -0.2, label: '倒挂 (< -0.2%)' },
    { min: -0.2, max: 0.2, label: '平坦 (-0.2% ~ 0.2%)' },
    { min: 0.2, max: 0.5, label: '正常 (0.2% ~ 0.5%)' },
    { min: 0.5, max: Infinity, label: '陡峭 (> 0.5%)' },
  ]

  const priceMap = new Map(priceHistory.map(p => [p.date, p.value]))

  const results: ForwardReturn[] = []

  for (const range of ranges) {
    const points = spreadHistory.filter(p => {
      if (p.spread10y2y == null) return false
      if (range.max === Infinity) return p.spread10y2y > range.min
      return p.spread10y2y >= range.min && p.spread10y2y < range.max
    })

    const returns1m: number[] = []
    const returns3m: number[] = []
    const returns6m: number[] = []
    const returns12m: number[] = []

    for (const point of points) {
      const basePrice = priceMap.get(point.date)
      if (basePrice == null) continue

      const baseDate = new Date(point.date)
      for (const [horizon, returns] of [[20, returns1m], [60, returns3m], [120, returns6m], [240, returns12m]] as const) {
        const targetDate = new Date(baseDate)
        targetDate.setDate(targetDate.getDate() + horizon)
        const targetDateStr = targetDate.toISOString().slice(0, 10)

        let targetPrice: number | null = null
        for (const [d, p] of priceMap) {
          if (d >= targetDateStr) {
            targetPrice = p
            break
          }
        }

        if (targetPrice != null && basePrice > 0) {
          returns.push((targetPrice / basePrice - 1) * 100)
        }
      }
    }

    const calcStats = (vals: number[]) => ({
      avg: vals.length > 0 ? mean(vals) : 0,
      winRate: vals.length > 0 ? vals.filter(v => v > 0).length / vals.length : 0,
    })

    const s1m = calcStats(returns1m)
    const s3m = calcStats(returns3m)
    const s6m = calcStats(returns6m)
    const s12m = calcStats(returns12m)

    results.push({
      spreadRange: range.label,
      avgReturn1m: +s1m.avg.toFixed(2),
      avgReturn3m: +s3m.avg.toFixed(2),
      avgReturn6m: +s6m.avg.toFixed(2),
      avgReturn12m: +s12m.avg.toFixed(2),
      winRate1m: +s1m.winRate.toFixed(2),
      winRate3m: +s3m.winRate.toFixed(2),
      winRate6m: +s6m.winRate.toFixed(2),
      winRate12m: +s12m.winRate.toFixed(2),
      sampleSize: points.length,
    })
  }

  return results
}

export const GET = withCache(async () => {
  try {
    const horizon = 5 * 365

    const [spreadRows, dgs2Rows, dgs10Rows, dgs3mRows, sp500Rows, regimeSnapRows] = await Promise.all([
      safeQuery(`
        SELECT period_date, value FROM indicator_data d
        JOIN indicators i ON i.id = d.indicator_id
        WHERE i.code = 'T10Y2Y' AND i.region = 'US' AND d.value IS NOT NULL
        ORDER BY period_date DESC
        LIMIT $1
      `, [horizon]).then(r => r.reverse()),
      safeQuery(`
        SELECT period_date, value FROM indicator_data d
        JOIN indicators i ON i.id = d.indicator_id
        WHERE i.code = 'DGS2' AND i.region = 'US' AND d.value IS NOT NULL
        ORDER BY period_date DESC
        LIMIT $1
      `, [horizon]).then(r => r.reverse()),
      safeQuery(`
        SELECT period_date, value FROM indicator_data d
        JOIN indicators i ON i.id = d.indicator_id
        WHERE i.code = 'DGS10' AND i.region = 'US' AND d.value IS NOT NULL
        ORDER BY period_date DESC
        LIMIT $1
      `, [horizon]).then(r => r.reverse()),
      safeQuery(`
        SELECT period_date, value FROM indicator_data d
        JOIN indicators i ON i.id = d.indicator_id
        WHERE i.code = 'DGS3MO' AND i.region = 'US' AND d.value IS NOT NULL
        ORDER BY period_date DESC
        LIMIT $1
      `, [horizon]).then(r => r.reverse()),
      safeQuery(`
        SELECT trade_date, close_price FROM asset_prices p
        JOIN assets a ON a.id = p.asset_id
        WHERE a.symbol = '^GSPC' AND p.close_price IS NOT NULL
        ORDER BY trade_date DESC
        LIMIT $1
      `, [horizon]).then(r => r.reverse()),
      safeQuery(`
        SELECT snapshot_date, regime FROM regime_snapshots
        ORDER BY snapshot_date DESC
        LIMIT $1
      `, [horizon]).then(r => r.reverse()),
    ])

    const spreadHistory: Curve形态[] = spreadRows.map((r: Record<string, any>) => ({
      date: toDateStr(r.period_date),
      spread10y2y: Number(r.value),
      spread10y3m: null,
      shape: getSpreadShape(Number(r.value)),
    }))

    const spreadMap = new Map<number, number>()
    for (const s of spreadHistory) {
      if (s.spread10y2y != null) spreadMap.set(new Date(s.date).getTime(), s.spread10y2y)
    }

    const dates = [...new Set([
      ...spreadRows.map((r: Record<string, any>) => toDateStr(r.period_date)),
      ...dgs2Rows.map((r: Record<string, any>) => toDateStr(r.period_date)),
      ...dgs10Rows.map((r: Record<string, any>) => toDateStr(r.period_date)),
      ...dgs3mRows.map((r: Record<string, any>) => toDateStr(r.period_date)),
    ])].sort()

    const dgs2Map = new Map(dgs2Rows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const dgs10Map = new Map(dgs10Rows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const dgs3mMap = new Map(dgs3mRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))

    const curveHistory = {
      dates,
      tenors: [
        { name: '3M', data: dates.map(d => dgs3mMap.get(d) ?? null) },
        { name: '2Y', data: dates.map(d => dgs2Map.get(d) ?? null) },
        { name: '10Y', data: dates.map(d => dgs10Map.get(d) ?? null) },
        { name: '30Y', data: dates.map(() => null) },
      ],
    }

    const priceHistory: SeriesPoint[] = sp500Rows.map((r: Record<string, any>) => ({
      date: toDateStr(r.trade_date),
      value: Number(r.close_price),
    }))

    const regimeHistory = regimeSnapRows.map((r: Record<string, any>) => ({
      date: toDateStr(r.snapshot_date),
      regime: r.regime,
    }))

    const spreadTimeMap = new Map<string, number>()
    for (const s of spreadHistory) {
      if (s.spread10y2y != null) spreadTimeMap.set(s.date, s.spread10y2y)
    }

    const regimeTransitions = detectRegimeTransitions(
      regimeHistory.map(r => r.date),
      regimeHistory.map(r => r.regime),
      spreadTimeMap,
    )

    const spreadValues = spreadHistory.map(s => s.spread10y2y).filter((v): v is number => v != null)
    const latestSpread = spreadValues.length > 0 ? spreadValues[spreadValues.length - 1] : null

    const spread1y = spreadValues.slice(-252)
    const spread5y = spreadValues.slice(-1260)

    const percentile1y = spreadValues.length > 0 ? percentileRank(spread1y, latestSpread ?? 0) : null
    const percentile5y = spreadValues.length > 0 ? percentileRank(spread5y, latestSpread ?? 0) : null

    const zScoreVal = spreadValues.length > 60 ? zScore(spreadValues.slice(-252), latestSpread ?? 0) : null

    let inversionMonths = 0
    if (spreadValues.length > 0) {
      for (let i = spreadValues.length - 1; i >= 0; i--) {
        if (spreadValues[i] < 0) inversionMonths++
        else break
      }
      inversionMonths = Math.round(inversionMonths / 21)
    }

    let signal: YieldCurveRegimeResponse['currentSpread']['signal'] = 'neutral'
    let signalDesc = ''

    if (inversionMonths >= 6 && latestSpread != null && latestSpread < -0.3) {
      signal = 'strong_warning'
      signalDesc = '深度倒挂超过6个月，历史上高度预示衰退'
    } else if (inversionMonths >= 3) {
      signal = 'warning'
      signalDesc = '倒挂持续3个月以上，需要关注衰退风险'
    } else if (latestSpread != null && latestSpread > 1.0 && percentile1y != null && percentile1y > 80) {
      signal = 'strong_buy'
      signalDesc = '曲线陡峭且处于高位，经济复苏信号强劲'
    } else if (latestSpread != null && latestSpread > 0.5) {
      signal = 'buy'
      signalDesc = '曲线正常陡峭，经济扩张环境'
    } else {
      signal = 'neutral'
      signalDesc = '曲线形态中性'
    }

    const forwardReturns = calculateForwardReturns(spreadHistory, priceHistory)

    const data: YieldCurveRegimeResponse = {
      curveHistory,
      spreadHistory,
      regimeTransitions,
      forwardReturns,
      currentSpread: {
        spread10y2y: latestSpread,
        spread10y3m: null,
        percentile1y,
        percentile5y,
        zScore: zScoreVal != null ? +zScoreVal.toFixed(2) : null,
        inversionMonths,
        signal,
        signalDesc,
      },
      updatedAt: new Date().toISOString().slice(0, 10),
    }

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('[yield-curve-regime]', err.message)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}, 600)

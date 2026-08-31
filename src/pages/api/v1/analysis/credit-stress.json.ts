export const prerender = false

import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'
import { toDateStr } from '../../../../lib/date'
import { mean, zScore, percentileRank, quantile, rollingCorr, type SeriesPoint } from '../../../../lib/analysis'

interface CreditRateStressResponse {
  spreadHistory: { dates: string[]; series: { name: string; data: (number | null)[] }[] }
  corrHistory: { dates: string[]; series: { name: string; data: (number | null)[] }[] }
  combinedStress: {
    creditStress: number | null
    rateStress: number | null
    combinedIndex: number | null
    status: string
    statusDesc: string
  }
  currentSpread: {
    bbbSpread: number | null
    hyOas: number | null
    aaaSpread: number | null
    wedge: number | null
    spreadZScore: number | null
    percentile5y: number | null
  }
  forwardReturns: {
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
  }[]
  stressEvents: {
    date: string
    peakSpread: number
    ret3m: number | null
    ret6m: number | null
    ret12m: number | null
  }[]
  thresholds: { median: number | null; p90: number | null }
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

const HORIZON = 10 * 365

/** 小工具：date + days → string */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function calcStats(vals: number[]): { avg: number; winRate: number } {
  return {
    avg: vals.length > 0 ? mean(vals) : 0,
    winRate: vals.length > 0 ? vals.filter((v) => v > 0).length / vals.length : 0,
  }
}

/** S&P500 前瞻收益：spreadHistory 档位分组 */
function calculateForwardReturns(
  points: { date: string; value: number }[],
  priceMap: Map<string, number>,
): CreditRateStressResponse['forwardReturns'] {
  const ranges = [
    { min: -Infinity, max: 1.2, label: '利差 < 1.2%' },
    { min: 1.2, max: 1.8, label: '1.2% ~ 1.8%' },
    { min: 1.8, max: Infinity, label: '利差 > 1.8%' },
  ]

  const results: CreditRateStressResponse['forwardReturns'] = []

  for (const range of ranges) {
    const inRange = points.filter((p) => {
      if (range.max === Infinity) return p.value > range.min
      return p.value >= range.min && p.value < range.max
    })

    const r1m: number[] = []
    const r3m: number[] = []
    const r6m: number[] = []
    const r12m: number[] = []

    for (const p of inRange) {
      const basePrice = priceMap.get(p.date)
      if (basePrice == null || basePrice <= 0) continue
      for (const [days, arr] of [[20, r1m], [60, r3m], [120, r6m], [240, r12m]] as const) {
        const target = addDays(p.date, days)
        let targetPrice: number | null = null
        for (const [d, v] of priceMap) {
          if (d >= target) { targetPrice = v; break }
        }
        if (targetPrice != null) arr.push((targetPrice / basePrice - 1) * 100)
      }
    }

    const s1m = calcStats(r1m)
    const s3m = calcStats(r3m)
    const s6m = calcStats(r6m)
    const s12m = calcStats(r12m)

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
      sampleSize: inRange.length,
    })
  }

  return results
}

export const GET = withCache(async () => {
  try {
    const [bbbRows, hyRows, aaaRows, t10yRows, t2yRows, sp500Rows] = await Promise.all([
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'BAMLC0A4CBBB' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [HORIZON]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'BAMLH0A0HYM2' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [HORIZON]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'BAMLC0A1CAAA' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [HORIZON]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DGS10' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [HORIZON]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DGS2' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [HORIZON]).then(r => r.reverse()),
      safeQuery(`SELECT trade_date, close_price FROM asset_prices p JOIN assets a ON a.id = p.asset_id WHERE a.symbol = '^GSPC' AND p.close_price IS NOT NULL ORDER BY trade_date DESC LIMIT $1`, [HORIZON + 365]).then(r => r.reverse()),
    ])

    const bbbMap = new Map(bbbRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const hyMap = new Map(hyRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const aaaMap = new Map(aaaRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const t10yMap = new Map(t10yRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const t2yMap = new Map(t2yRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))

    const bbbDates = new Set(bbbRows.map((r: Record<string, any>) => toDateStr(r.period_date)))
    const hyDates = new Set(hyRows.map((r: Record<string, any>) => toDateStr(r.period_date)))
    const t10yDates = new Set(t10yRows.map((r: Record<string, any>) => toDateStr(r.period_date)))
    const allDates = [...bbbDates].filter(d => hyDates.has(d) && t10yDates.has(d)).sort()
    if (allDates.length < 2) {
      return new Response(JSON.stringify({ success: false, error: '信用利差数据不足' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    const latestDate = allDates[allDates.length - 1]

    const spreadSeries: (number | null)[] = []
    const hySeries: (number | null)[] = []
    const wedgeSeries: (number | null)[] = []
    const t10ySeries: (number | null)[] = []
    const creditSpreads: number[] = []

    for (const d of allDates) {
      const spread = bbbMap.get(d) ?? null
      const hy = hyMap.get(d) ?? null
      const t10y = t10yMap.get(d) ?? null
      spreadSeries.push(spread)
      hySeries.push(hy)
      t10ySeries.push(t10y)
      wedgeSeries.push(spread != null && hy != null ? +(hy - spread).toFixed(3) : null)
      if (spread != null) creditSpreads.push(spread)
    }

    const currentBBB = bbbMap.get(latestDate) ?? null
    const currentHY = hyMap.get(latestDate) ?? null
    const currentAAA = aaaMap.get(latestDate) ?? null
    const wedge = currentBBB != null && currentHY != null ? +(currentHY - currentBBB).toFixed(3) : null
    const spreadZ = creditSpreads.length > 252 ? zScore(creditSpreads.slice(-252), currentBBB ?? 0) : null
    const percentile5y = creditSpreads.length >= 252
      ? percentileRank(creditSpreads.slice(-1260), currentBBB ?? 0)
      : null

    // 阈值：10 年历史中位数与 90% 分位
    const sorted = [...creditSpreads].sort((a, b) => a - b)
    const medianSpread = sorted.length > 0 ? quantile(sorted, 0.5) : null
    const p90Spread = sorted.length > 0 ? quantile(sorted, 0.9) : null

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

    // 60/120 日滚动相关（基于日变动）
    const bbbPoints: SeriesPoint[] = allDates.map((d, i) => ({ date: d, value: bbbMap.get(d) ?? NaN }))
    const t10yPoints: SeriesPoint[] = allDates.map((d, i) => ({ date: d, value: t10yMap.get(d) ?? NaN }))
    const diffSeries = (pts: SeriesPoint[]): SeriesPoint[] =>
      pts.map((p, i) => ({
        date: p.date,
        value: i > 0 && isFinite(p.value) && isFinite(pts[i - 1].value) ? p.value - pts[i - 1].value : NaN,
      }))
    const bbbDiff = diffSeries(bbbPoints)
    const t10yDiff = diffSeries(t10yPoints)

    const rc120 = rollingCorr(bbbDiff, t10yDiff, 120)
    const corrVal = rc120.length > 0 ? rc120[rc120.length - 1].value : null

    const corrHistory = {
      dates: allDates,
      series: [60, 120].map((win) => {
        const rc = rollingCorr(bbbDiff, t10yDiff, win)
        const rcMap = new Map(rc.map((pt) => [pt.date, pt.value]))
        return { name: `${win}日`, data: allDates.map((d) => rcMap.get(d) ?? null) }
      }),
    }

    // 历史压力事件：BBB ≥ 10 年 90% 分位的连续段，取峰值
    const priceMap = new Map<string, number>()
    for (const r of sp500Rows) priceMap.set(toDateStr(r.trade_date), Number(r.close_price))

    const rawPoints: { date: string; value: number }[] = []
    for (let i = 0; i < allDates.length; i++) {
      const v = spreadSeries[i]
      if (v != null) rawPoints.push({ date: allDates[i], value: v })
    }

    const stressEvents: CreditRateStressResponse['stressEvents'] = []
    if (p90Spread != null) {
      let runStart = -1
      let peakIdx = -1
      let peakVal = -Infinity
      const flush = (endIdx: number) => {
        if (runStart < 0) return
        if (peakIdx >= 0) {
          const evDate = rawPoints[peakIdx].date
          const base = priceMap.get(evDate)
          const rets = base != null && base > 0
            ? ([60, 120, 240] as const).map((days) => {
                const target = addDays(evDate, days)
                for (const [d, v] of priceMap) if (d >= target) return +((v / base - 1) * 100).toFixed(2)
                return null
              })
            : [null, null, null]
          stressEvents.push({ date: evDate, peakSpread: +peakVal.toFixed(3), ret3m: rets[0], ret6m: rets[1], ret12m: rets[2] })
        }
        runStart = -1
        peakIdx = -1
        peakVal = -Infinity
      }
      for (let i = 0; i < rawPoints.length; i++) {
        if (rawPoints[i].value >= p90Spread) {
          if (runStart < 0) runStart = i
          if (rawPoints[i].value > peakVal) { peakVal = rawPoints[i].value; peakIdx = i }
        } else {
          flush(i)
        }
      }
      flush(rawPoints.length)
    }
    const recentEvents = stressEvents.slice(-6)

    const evidence: string[] = []
    if (currentBBB != null) evidence.push(`BBB信用利差当前 ${currentBBB.toFixed(2)}%`)
    if (currentHY != null) evidence.push(`HY OAS当前 ${currentHY.toFixed(2)}%`)
    if (wedge != null) evidence.push(`BBB-HY溢价（信用溢价）${wedge.toFixed(2)}%`)
    if (percentile5y != null) evidence.push(`BBB利差处于 5 年约 ${(percentile5y * 100).toFixed(0)}% 分位`)
    if (corrVal != null && corrVal < -0.3) evidence.push(`信用利差与利率变化负相关 ${corrVal.toFixed(2)}`)
    if (spread10y2y != null && spread10y2y < 0) evidence.push(`收益率曲线倒挂 ${spread10y2y.toFixed(2)}%`)
    if (recentEvents.length > 0) evidence.push(`近10年曾 ${stressEvents.length} 次进入高压力区间（峰值利差 ${recentEvents[recentEvents.length - 1].peakSpread.toFixed(2)}%）`)

    const forwardReturns = calculateForwardReturns(rawPoints, priceMap)

    const data: CreditRateStressResponse = {
      spreadHistory: {
        dates: allDates,
        series: [
          { name: 'BBB信用利差', data: spreadSeries },
          { name: 'HY OAS', data: hySeries },
          { name: 'BBB-HY溢价', data: wedgeSeries },
        ],
      },
      corrHistory,
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
        wedge,
        spreadZScore: spreadZ != null ? +spreadZ.toFixed(2) : null,
        percentile5y: percentile5y != null ? +percentile5y.toFixed(3) : null,
      },
      forwardReturns,
      stressEvents: recentEvents,
      thresholds: {
        median: medianSpread != null ? +medianSpread.toFixed(3) : null,
        p90: p90Spread != null ? +p90Spread.toFixed(3) : null,
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

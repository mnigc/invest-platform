export const prerender = false

import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'
import { toDateStr } from '../../../../lib/date'
import { zScore, percentileRank, mean } from '../../../../lib/analysis'

interface InflationAnchorData {
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
    fwd5y5y: number | null
  }
  termHistory: {
    dates: string[]
    series: { name: string; data: (number | null)[] }[]
  }
  realYieldCurve: {
    tenors: string[]
    values: (number | null)[]
  }
  realYieldHistory: {
    dates: string[]
    series: { name: string; data: (number | null)[] }[]
  }
  zScoreHistory: {
    dates: string[]
    data: (number | null)[]
  }
  inflationGap: {
    dates: string[]
    breakeven10y: (number | null)[]
    cpiYoy: (number | null)[]
    gap: (number | null)[]
    currentGap: number | null
  }
  momentum: {
    chg1m: number | null
    chg3m: number | null
    chg1y: number | null
  }
  forwardReturns: {
    devRange: string
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
  deAnchoringEvents: {
    date: string
    peakDeviation: number
    z: number | null
    ret3m: number | null
    ret6m: number | null
    ret12m: number | null
    goldRet3m: number | null
    goldRet6m: number | null
    goldRet12m: number | null
  }[]
  currentSnapshot: {
    breakeven5y: number | null
    breakeven10y: number | null
    realYield5y: number | null
    realYield10y: number | null
    realYield20y: number | null
    realYield30y: number | null
    fedTargetPct: number
  }
  signal: {
    direction: string
    strength: string
    confidence: number
    evidence: string[]
  }
  updatedAt: string
}

const FED_TARGET = 2.0
const HORIZON = 10 * 365

async function safeQuery(sql: string, params?: unknown[]): Promise<any[]> {
  try {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error('[inflation-anchor] safeQuery', err.message)
    return []
  }
}

/** date + calendar days → string */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 以 baseDate 为基准，回溯最近一个价格日，计算 N 个自然日后的收益率（%） */
function forwardReturn(
  priceDates: string[],
  priceMap: Map<string, number>,
  baseDate: string,
  days: number,
): number | null {
  let baseIdx = -1
  for (let i = 0; i < priceDates.length; i++) {
    if (priceDates[i] <= baseDate) baseIdx = i
    else break
  }
  if (baseIdx < 0) return null
  const base = priceMap.get(priceDates[baseIdx])
  if (base == null || base <= 0) return null
  const target = addDays(baseDate, days)
  let j = baseIdx
  while (j < priceDates.length && priceDates[j] < target) j++
  if (j >= priceDates.length) return null
  const fwd = priceMap.get(priceDates[j])
  return fwd != null && fwd > 0 ? +((fwd / base - 1) * 100).toFixed(2) : null
}

interface RetPoint {
  date: string
  value: number
}

/** 前瞻收益：dev 分档 → 标普 1/3/6/12 月均值与胜率 */
function calculateForwardReturns(
  points: RetPoint[],
  priceDates: string[],
  priceMap: Map<string, number>,
): InflationAnchorData['forwardReturns'] {
  const ranges = [
    { min: -Infinity, max: -0.5, label: '低于目标 0.5% 以上' },
    { min: -0.5, max: 0.5, label: '锚定区间 (±0.5%)' },
    { min: 0.5, max: Infinity, label: '高于目标 0.5% 以上' },
  ]
  const results: InflationAnchorData['forwardReturns'] = []
  for (const range of ranges) {
    const inRange = points.filter((p) => {
      if (range.max === Infinity) return p.value > range.min
      return p.value >= range.min && p.value < range.max
    })
    const buckets: Record<number, number[]> = { 20: [], 60: [], 120: [], 240: [] }
    for (const p of inRange) {
      for (const days of Object.keys(buckets).map(Number)) {
        const r = forwardReturn(priceDates, priceMap, p.date, days)
        if (r != null) buckets[days].push(r)
      }
    }
    const stats = (arr: number[]) => ({
      avg: arr.length > 0 ? mean(arr) : 0,
      winRate: arr.length > 0 ? arr.filter((v) => v > 0).length / arr.length : 0,
    })
    const s1m = stats(buckets[20])
    const s3m = stats(buckets[60])
    const s6m = stats(buckets[120])
    const s12m = stats(buckets[240])
    results.push({
      devRange: range.label,
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
    const [t5yieRows, t10yieRows, dfii5Rows, dfii10Rows, dfii20Rows, dfii30Rows, cpiRows, spRows, goldRows] = await Promise.all([
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'T5YIE' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [HORIZON]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'T10YIE' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [HORIZON]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DFII5' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [HORIZON]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DFII10' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [HORIZON]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DFII20' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [HORIZON]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'DFII30' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date DESC LIMIT $1`, [HORIZON]).then(r => r.reverse()),
      safeQuery(`SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id WHERE i.code = 'CPI' AND i.region = 'US' AND d.value IS NOT NULL ORDER BY period_date ASC`),
      safeQuery(`SELECT trade_date, close_price FROM asset_prices p JOIN assets a ON a.id = p.asset_id WHERE a.symbol = '^GSPC' AND p.close_price IS NOT NULL ORDER BY trade_date DESC LIMIT $1`, [HORIZON + 365]).then(r => r.reverse()),
      safeQuery(`SELECT price_date, close_price FROM gold_price_history WHERE currency = 'USD' AND unit = 'OZ' AND source IN ('yfinance', 'gold-api', 'LOCAL-XLSX', 'FRED') ORDER BY price_date ASC`),
    ])

    const t5yMap = new Map(t5yieRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const t10yMap = new Map(t10yieRows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const dfii5Map = new Map(dfii5Rows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const dfii10Map = new Map(dfii10Rows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const dfii20Map = new Map(dfii20Rows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
    const dfii30Map = new Map(dfii30Rows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))

    const t5yDates = new Set(t5yieRows.map((r: Record<string, any>) => toDateStr(r.period_date)))
    const t10yDates = new Set(t10yieRows.map((r: Record<string, any>) => toDateStr(r.period_date)))
    const dates = [...t5yDates].filter(d => t10yDates.has(d)).sort()
    const latestDate = dates[dates.length - 1]

    const devPoints: RetPoint[] = []
    const devArr: number[] = []
    for (const d of dates) {
      const be = t10yMap.get(d)
      if (be != null) {
        const dev = be - FED_TARGET
        devPoints.push({ date: d, value: dev })
        devArr.push(dev)
      }
    }
    const lastDev = devArr.length > 0 ? devArr[devArr.length - 1] : null

    // 滚动 252 日 z-score（偏差 / 2% 目标）
    const zMap = new Map<string, number>()
    const zArr: (number | null)[] = dates.map(() => null)
    for (let i = 252; i < devPoints.length; i++) {
      const z = zScore(devArr.slice(i - 252, i), devArr[i])
      zArr[i] = +z.toFixed(2)
      zMap.set(devPoints[i].date, z)
    }

    const zScoreVal = devArr.length > 252 ? zScore(devArr.slice(-252), lastDev ?? 0) : null
    const percentile1y = devArr.length > 252 ? percentileRank(devArr.slice(-252), lastDev ?? 0) : null
    const percentile5y = devArr.length > 1260 ? percentileRank(devArr.slice(-1260), lastDev ?? 0) : null

    let anchorStatus = 'anchored'
    let anchorDesc = ''
    if (lastDev != null) {
      const absDev = Math.abs(lastDev)
      if (absDev < 0.3) { anchorStatus = 'anchored'; anchorDesc = '通胀预期锚定在联储2%目标附近' }
      else if (absDev < 0.8) { anchorStatus = 'drifting'; anchorDesc = '通胀预期偏离目标，但仍可控' }
      else { anchorStatus = 'deanchored'; anchorDesc = '通胀预期显著偏离目标' }
    }

    // 期限结构：斜率 & 5Y5Y 远期（= 2×10Y − 5Y）
    const slopeArr: (number | null)[] = dates.map(d => (t10yMap.get(d) != null && t5yMap.get(d) != null ? +(t10yMap.get(d)! - t5yMap.get(d)!).toFixed(3) : null))
    const fwdArr: (number | null)[] = dates.map(d => (t10yMap.get(d) != null && t5yMap.get(d) != null ? +(2 * t10yMap.get(d)! - t5yMap.get(d)!).toFixed(3) : null))
    const cur5y = t5yMap.get(latestDate) ?? null
    const cur10y = t10yMap.get(latestDate) ?? null
    const slope5y10y = cur5y != null && cur10y != null ? +(cur10y - cur5y).toFixed(3) : null
    const fwd5y5y = cur5y != null && cur10y != null ? +(2 * cur10y - cur5y).toFixed(3) : null

    // 实际利率曲线 & 历史（四个 DFII 序列共同日期对齐）
    const ryTenors = ['5Y', '10Y', '20Y', '30Y']
    const ryRows = [dfii5Rows, dfii10Rows, dfii20Rows, dfii30Rows]
    const ryDateOfRow = (rows: any[]) => rows.map((r: Record<string, any>) => toDateStr(r.period_date))
    const ryDateSets = ryRows.map(rows => new Set(ryDateOfRow(rows)))
    const ryDates = [...ryDateSets[0]].filter(d => ryDateSets[1].has(d) && ryDateSets[2].has(d) && ryDateSets[3].has(d)).sort()
    const rySeriesData = ryRows.map(rows => {
      const m = new Map(rows.map((r: Record<string, any>) => [toDateStr(r.period_date), Number(r.value)]))
      return ryDates.map(d => m.get(d) ?? null)
    })
    // 曲线当前值：取交集最新日（通常较 T5YIE/T10YIE 最新日滞后 1-2 天）
    const ryValues = ryDates.length > 0 ? rySeriesData.map(s => s[s.length - 1]) : [null, null, null, null]
    const ryLatestDate = ryDates.length > 0 ? ryDates[ryDates.length - 1] : null

    // CPI YoY（月频 index，同比 = 现月 / 12 个月前 − 1）→ 日频 FF
    const cpiMonthly = new Map<string, number>() // 'YYYY-MM' → index
    const cpiMonthList: string[] = []
    for (const r of cpiRows) {
      const mk = toDateStr(r.period_date).slice(0, 7)
      cpiMonthly.set(mk, Number(r.value))
      cpiMonthList.push(mk)
    }
    cpiMonthList.sort()
    const cpiYoyByMonth = new Map<string, number>()
    for (const mk of cpiMonthList) {
      const pmk = `${+mk.slice(0, 4) - 1}${mk.slice(4)}`
      const vPrev = cpiMonthly.get(pmk)
      const vNow = cpiMonthly.get(mk)
      if (vPrev != null && vNow != null) {
        cpiYoyByMonth.set(mk, +((vNow / vPrev - 1) * 100).toFixed(2))
      }
    }
    const cpiYoyDaily = new Map<string, number>()
    let lastYoy: number | null = null
    let mIdx = 0
    for (const d of dates) {
      const mk = d.slice(0, 7)
      while (mIdx < cpiMonthList.length && cpiMonthList[mIdx] <= mk) {
        const v = cpiYoyByMonth.get(cpiMonthList[mIdx])
        if (v != null) lastYoy = v
        mIdx++
      }
      if (lastYoy != null) cpiYoyDaily.set(d, lastYoy)
    }


    // 已实现 vs 预期
    const cpiYoyArr = dates.map(d => cpiYoyDaily.get(d) ?? null)
    const gapArr = dates.map((d, i) => {
      const be = t10yMap.get(d)
      const cpi = cpiYoyArr[i]
      return be != null && cpi != null ? +(be - cpi).toFixed(3) : null
    })
    const currentGap = latestDate != null ? gapArr[gapArr.length - 1] : null

    // 动量
    const be10Arr = dates.map(d => t10yMap.get(d) ?? null)
    const chg = (lookback: number): number | null => {
      const i = be10Arr.length - 1 - lookback
      if (i < 0 || be10Arr[be10Arr.length - 1] == null || be10Arr[i] == null) return null
      return +(be10Arr[be10Arr.length - 1]! - be10Arr[i]!).toFixed(3)
    }
    const momentum = { chg1m: chg(21), chg3m: chg(63), chg1y: chg(252) }

    // 前瞻收益
    const spDates = spRows.map((r: Record<string, any>) => toDateStr(r.trade_date))
    const spMap = new Map<string, number>(spRows.map((r: Record<string, any>) => [toDateStr(r.trade_date), Number(r.close_price)]))
    const forwardReturns = calculateForwardReturns(devPoints, spDates, spMap)

    // 历史脱锚事件（|偏差| ≥ 0.8 的连续段峰值）
    const goldDates = goldRows.map((r: Record<string, any>) => toDateStr(r.price_date))
    const goldMap = new Map<string, number>(goldRows.map((r: Record<string, any>) => [toDateStr(r.price_date), Number(r.close_price)]))
    const events: InflationAnchorData['deAnchoringEvents'] = []
    let runStart = -1
    let peakIdx = -1
    let peakAbs = -Infinity
    const flush = (endIdx: number) => {
      if (runStart < 0) return
      if (peakIdx >= 0) {
        const ev = devPoints[peakIdx]
        events.push({
          date: ev.date,
          peakDeviation: +ev.value.toFixed(2),
          z: zMap.get(ev.date) != null ? +zMap.get(ev.date)!.toFixed(2) : null,
          ret3m: forwardReturn(spDates, spMap, ev.date, 60),
          ret6m: forwardReturn(spDates, spMap, ev.date, 120),
          ret12m: forwardReturn(spDates, spMap, ev.date, 240),
          goldRet3m: forwardReturn(goldDates, goldMap, ev.date, 60),
          goldRet6m: forwardReturn(goldDates, goldMap, ev.date, 120),
          goldRet12m: forwardReturn(goldDates, goldMap, ev.date, 240),
        })
      }
      runStart = -1
      peakIdx = -1
      peakAbs = -Infinity
    }
    for (let i = 0; i < devPoints.length; i++) {
      const absV = Math.abs(devPoints[i].value)
      if (absV >= 0.8) {
        if (runStart < 0) runStart = i
        if (absV > peakAbs) { peakAbs = absV; peakIdx = i }
      } else {
        flush(i)
      }
    }
    flush(devPoints.length)
    const recentEvents = events.slice(-6)

    let direction = 'neutral'
    let strength = 'weak'
    let confidence = 50
    const evidence: string[] = []

    if (lastDev != null) {
      if (lastDev > 0.5) { direction = 'hawkish'; evidence.push(`10Y通胀预期高于联储目标 ${lastDev.toFixed(2)}%`) }
      else if (lastDev < -0.5) { direction = 'dovish'; evidence.push(`10Y通胀预期低于联储目标 ${Math.abs(lastDev).toFixed(2)}%`) }
      else { evidence.push(`10Y通胀预期接近联储目标（${cur10y != null ? cur10y.toFixed(2) : '--'}%)`) }
    }
    if (anchorStatus === 'deanchored') { strength = 'strong'; confidence = 80 }
    else if (anchorStatus === 'drifting') { strength = 'moderate'; confidence = 65 }
    if (zScoreVal != null) {
      evidence.push(`10Y 偏差滚动 Z-Score ${zScoreVal.toFixed(2)}（1 年分位 ${percentile1y != null ? percentile1y.toFixed(0) : '--'}%）`)
      if (Math.abs(zScoreVal) >= 2) evidence.push('Z-Score 偏离超过 2σ，偏差脱离常态分布区间')
      else if (Math.abs(zScoreVal) >= 1) evidence.push('Z-Score 偏离超过 1σ，偏差接近常态区间边缘')
    }
    if (fwd5y5y != null) evidence.push(`5Y5Y 远期通胀预期 ${fwd5y5y.toFixed(2)}%（2×10Y−5Y 换算）`)
    if (slope5y10y != null) evidence.push(`5Y-10Y 期限斜率 ${slope5y10y >= 0 ? '+' : ''}${slope5y10y.toFixed(2)}%（长端预期${slope5y10y >= 0 ? '更高' : '更低'}）`)
    if (currentGap != null) evidence.push(`10Y 预期高于已实现 CPI YoY ${currentGap.toFixed(2)}%（通胀预期溢价）`)
    if (momentum.chg1m != null) evidence.push(`10Y 盈亏平衡近 1 月变动 ${momentum.chg1m >= 0 ? '+' : ''}${momentum.chg1m.toFixed(2)}%`)
    if (recentEvents.length > 0) evidence.push(`近 10 年出现 ${events.length} 次脱锚事件（|偏差|≥0.8%，最近峰值 ${recentEvents[recentEvents.length - 1].peakDeviation.toFixed(2)}%）`)

    const data: InflationAnchorData = {
      breakevenHistory: {
        dates,
        series: [
          { name: '5Y', tenor: '5Y', data: dates.map(d => t5yMap.get(d) ?? null) },
          { name: '10Y', tenor: '10Y', data: dates.map(d => t10yMap.get(d) ?? null) },
        ],
      },
      anchorDeviation: {
        currentDeviation10y: lastDev != null ? +lastDev.toFixed(3) : null,
        zScore: zScoreVal != null ? +zScoreVal.toFixed(2) : null,
        percentile1y: percentile1y != null ? +percentile1y.toFixed(1) : null,
        percentile5y: percentile5y != null ? +percentile5y.toFixed(1) : null,
        anchorStatus,
        anchorDesc,
      },
      termStructure: { slope5y10y, fwd5y5y },
      termHistory: {
        dates,
        series: [
          { name: '5Y-10Y 斜率', data: slopeArr },
          { name: '5Y5Y 远期', data: fwdArr },
        ],
      },
      realYieldCurve: { tenors: ryTenors, values: ryValues },
      realYieldHistory: {
        dates: ryDates,
        series: ryTenors.map((tn, i) => ({ name: `${tn} 实际利率`, data: rySeriesData[i] })),
      },
      zScoreHistory: { dates, data: zArr },
      inflationGap: {
        dates,
        breakeven10y: be10Arr,
        cpiYoy: cpiYoyArr,
        gap: gapArr,
        currentGap,
      },
      momentum,
      forwardReturns,
      deAnchoringEvents: recentEvents,
      currentSnapshot: {
        breakeven5y: cur5y,
        breakeven10y: cur10y,
        realYield5y: ryLatestDate != null ? dfii5Map.get(ryLatestDate) ?? null : null,
        realYield10y: ryLatestDate != null ? dfii10Map.get(ryLatestDate) ?? null : null,
        realYield20y: ryLatestDate != null ? dfii20Map.get(ryLatestDate) ?? null : null,
        realYield30y: ryLatestDate != null ? dfii30Map.get(ryLatestDate) ?? null : null,
        fedTargetPct: FED_TARGET,
      },
      signal: { direction, strength, confidence, evidence },
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

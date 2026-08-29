// ── 通用分析引擎：相关性 / 事件研究 / 统计工具 ──
// 零依赖，服务端纯函数，供各决策模块复用

export interface SeriesPoint {
  date: string
  value: number
}

// ==== 统计基础 ====

export function mean(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((s, v) => s + v, 0) / nums.length
}

export function std(nums: number[]): number {
  if (nums.length < 2) return 0
  const m = mean(nums)
  return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / nums.length)
}

export function percentileRank(values: number[], v: number): number {
  if (values.length < 2) return 50
  const sorted = [...values].sort((a, b) => a - b)
  const below = sorted.filter(x => x < v).length
  return +((below / (sorted.length - 1)) * 100).toFixed(1)
}

export function zScore(values: number[], v: number): number {
  const m = mean(values)
  const s = std(values)
  return s === 0 ? 0 : (v - m) / s
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

// ==== 收益率 ====

export function logReturns(points: SeriesPoint[]): SeriesPoint[] {
  const out: SeriesPoint[] = []
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value
    const cur = points[i].value
    if (prev > 0 && cur > 0) {
      out.push({ date: points[i].date, value: Math.log(cur / prev) })
    }
  }
  return out
}

// ==== 按日期对齐两条序列（交集）====

export function alignByDate(a: SeriesPoint[], b: SeriesPoint[]): { date: string; a: number; b: number }[] {
  const bMap = new Map(b.map(p => [p.date, p.value]))
  const out: { date: string; a: number; b: number }[] = []
  for (const p of a) {
    const bv = bMap.get(p.date)
    if (bv != null && isFinite(bv) && isFinite(p.value)) {
      out.push({ date: p.date, a: p.value, b: bv })
    }
  }
  return out
}

// ==== 相关 ====

export function corr(ax: number[], bx: number[]): number {
  const n = Math.min(ax.length, bx.length)
  if (n < 3) return 0
  const a = ax.slice(-n)
  const b = bx.slice(-n)
  const ma = mean(a)
  const mb = mean(b)
  let cov = 0, sa2 = 0, sb2 = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    cov += da * db
    sa2 += da * da
    sb2 += db * db
  }
  if (sa2 === 0 || sb2 === 0) return 0
  return +(cov / Math.sqrt(sa2 * sb2)).toFixed(4)
}

// 滚动相关系数序列（窗口 N 个数据点）
export function rollingCorr(a: SeriesPoint[], b: SeriesPoint[], window: number): { date: string; value: number }[] {
  const aligned = alignByDate(a, b)
  const out: { date: string; value: number }[] = []
  for (let i = window; i <= aligned.length; i++) {
    const seg = aligned.slice(i - window, i)
    const r = corr(seg.map(p => p.a), seg.map(p => p.b))
    out.push({ date: seg[seg.length - 1].date, value: r })
  }
  return out
}

// 领先滞后相关：lag>0 表示 a 领先 b（b 的第 i+lag 日与 a 的第 i 日对齐）
// 适用于同一交易日历的两条序列（如 A 股资金流与沪深300）
export function leadLagCorr(a: SeriesPoint[], b: SeriesPoint[], maxLag: number): { lag: number; corr: number }[] {
  const bMap = new Map(b.map(p => [String(p.date), p.value]))
  const aDates = a.map(p => String(p.date))
  const out: { lag: number; corr: number }[] = []
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const ax: number[] = []
    const bx: number[] = []
    for (let i = 0; i < aDates.length; i++) {
      const j = i + lag
      if (j < 0 || j >= aDates.length) continue
      const bv = bMap.get(aDates[j])
      if (bv != null) {
        ax.push(a[i].value)
        bx.push(bv)
      }
    }
    out.push({ lag, corr: corr(ax, bx) })
  }
  return out
}

// ==== 事件研究 ====
// 给定事件日期流与资产价格序列，统计事件发生后 N 个交易日的收益分布
// 收益定义：以事件日之前最近一个交易日收盘价为基准（避免事件当天 BUG），
// 或事件日当天的收盘（若事件日有价格）→ 使用 eventDay 当收盘

export interface EventStudyRow {
  date: string
  rets: Record<string, number | null>
}

export interface HorizonStats {
  n: number
  mean: number
  median: number
  winRate: number
  p25: number
  p75: number
  best: number
  worst: number
}

export interface EventStudyResult {
  nEvents: number
  events: EventStudyRow[]
  horizons: Record<string, HorizonStats>
}

function forwardReturns(priceDates: string[], priceMap: Map<string, number>, baseDate: string, horizons: number[]): Record<string, number | null> {
  // 找到 baseDate 之前最近有价格的一天作为基准
  let baseIdx = -1
  for (let i = 0; i < priceDates.length; i++) {
    if (priceDates[i] <= baseDate) baseIdx = i
    else break
  }
  if (baseIdx < 0) return {}
  const base = priceMap.get(priceDates[baseIdx])
  if (base == null || base === 0) return {}
  const rets: Record<string, number | null> = {}
  for (const h of horizons) {
    const j = baseIdx + h
    if (j < priceDates.length) {
      const fwd = priceMap.get(priceDates[j])
      rets[String(h)] = fwd != null && fwd > 0 ? +((fwd / base) - 1).toFixed(4) : null
    } else {
      rets[String(h)] = null
    }
  }
  return rets
}

export function eventStudy(
  prices: SeriesPoint[],
  eventDates: string[],
  horizons: number[]
): EventStudyResult {
  const priceDates = prices.map(p => String(p.date)).sort()
  const priceMap = new Map(priceDates.map((d, i) => [d, prices[i].value]))

  const events: EventStudyRow[] = []
  for (const ev of eventDates) {
    const rets = forwardReturns(priceDates, priceMap, String(ev), horizons)
    events.push({ date: String(ev), rets })
  }

  const horizonsOut: Record<string, HorizonStats> = {}
  for (const h of horizons) {
    const vals = events.map(e => e.rets[String(h)]).filter((v): v is number => v != null && isFinite(v))
    if (vals.length === 0) {
      horizonsOut[String(h)] = { n: 0, mean: 0, median: 0, winRate: 0, p25: 0, p75: 0, best: 0, worst: 0 }
      continue
    }
    const sorted = [...vals].sort((a, b) => a - b)
    horizonsOut[String(h)] = {
      n: vals.length,
      mean: +mean(vals).toFixed(4),
      median: +quantile(sorted, 0.5).toFixed(4),
      winRate: +(vals.filter(v => v > 0).length / vals.length).toFixed(4),
      p25: +quantile(sorted, 0.25).toFixed(4),
      p75: +quantile(sorted, 0.75).toFixed(4),
      best: +sorted[sorted.length - 1].toFixed(4),
      worst: +sorted[0].toFixed(4),
    }
  }

  return { nEvents: events.length, events, horizons: horizonsOut }
}

// ==== 信号分级 ====

export type SignalStrength = 'strong' | 'moderate' | 'weak'

export function strengthOf(z: number): SignalStrength {
  if (z >= 2) return 'strong'
  if (z >= 1) return 'moderate'
  return 'weak'
}

export const STRENGTH_LABEL: Record<SignalStrength, string> = {
  strong: '强',
  moderate: '中',
  weak: '弱',
}

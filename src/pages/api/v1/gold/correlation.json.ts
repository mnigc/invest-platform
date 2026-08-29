export const prerender = false

import type { APIRoute } from 'astro'
import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'
import {
  type SeriesPoint, corr, rollingCorr, logReturns, alignByDate,
  zScore, percentileRank, eventStudy, type SignalStrength,
} from '../../../../lib/analysis'

async function safeQuery(sql: string, params?: any[]): Promise<any[]> {
  try {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error('[gold/correlation] safeQuery', err.message)
    return []
  }
}

type CorrBand = 'inverse' | 'weakening' | 'broken' | 'positive'

const BAND_LABEL: Record<CorrBand, { label: string; desc: string }> = {
  inverse: { label: '正常负相关', desc: '美元走弱利好黄金，经典范式生效' },
  weakening: { label: '相关性弱化', desc: '负相关减弱，范式开始松动' },
  broken: { label: '相关性失效', desc: '负相关消失，黄金可能由其他因素定价（地缘/避险）' },
  positive: { label: '正相关区间', desc: '黄金与美元同涨同跌，极端联动范式' },
}

function bandOf(c: number): CorrBand {
  if (c < -0.4) return 'inverse'
  if (c < -0.15) return 'weakening'
  if (c < 0.15) return 'broken'
  return 'positive'
}

// 从滚动相关序列检测档位切换事件（连续同档位只记一次）
function bandSwitchEvents(corrSeries: { date: string; value: number }[]): { date: string; from: string; to: string }[] {
  const events: { date: string; from: string; to: string }[] = []
  let prevBand: CorrBand | null = null
  for (const p of corrSeries) {
    const band = bandOf(p.value)
    if (prevBand != null && band !== prevBand) {
      events.push({ date: p.date, from: prevBand, to: band })
    }
    prevBand = band
  }
  return events
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : 0
}

// 双特征 OLS：y = b0 + b1*x1 + b2*x2
function ols2(y: number[], x1: number[], x2: number[]): { b0: number; b1: number; b2: number } {
  const n = Math.min(y.length, x1.length, x2.length)
  const yy = y.slice(-n), xx1 = x1.slice(-n), xx2 = x2.slice(-n)
  const my = mean(yy), m1 = mean(xx1), m2 = mean(xx2)
  let S11 = 0, S12 = 0, S22 = 0, Sy1 = 0, Sy2 = 0
  for (let i = 0; i < n; i++) {
    const d1 = xx1[i] - m1, d2 = xx2[i] - m2, dy = yy[i] - my
    S11 += d1 * d1; S12 += d1 * d2; S22 += d2 * d2
    Sy1 += dy * d1; Sy2 += dy * d2
  }
  const det = S11 * S22 - S12 * S12
  if (Math.abs(det) < 1e-12) return { b0: my, b1: 0, b2: 0 }
  const b1 = (Sy1 * S22 - Sy2 * S12) / det
  const b2 = (Sy2 * S11 - Sy1 * S12) / det
  const b0 = my - b1 * m1 - b2 * m2
  return { b0, b1, b2 }
}

interface ResidPoint {
  date: string
  residualZ: number | null
  fitted: number | null
  actualLog: number | null
}

function buildResidualZ(goldPointZ: SeriesPoint[], dxyZ: SeriesPoint[], dfiiZ: SeriesPoint[], horizon: number): ResidPoint[] {
  // DXY 20d 动量（对数收益）序列
  const dxyRet = logReturns(dxyZ)
  const dfiiMap = new Map<string, number>()
  for (const p of dfiiZ) dfiiMap.set(String(p.date), p.value)

  let curDxyRet: number | null = null
  let curDfii: number | null = null
  const samples: { date: string; y: number; x1: number | null; x2: number | null }[] = []

  for (const p of goldPointZ) {
    const d = String(p.date)
    // 维护当前 DXY 动量（FFILL）
    const matching = dxyRet.find(r => String(r.date) === d)
    if (matching) curDxyRet = matching.value
    else if (dxyRet.length === 0) curDxyRet = null
    // DFII10 FFILL
    const dfii = dfiiMap.get(d)
    if (dfii != null) curDfii = dfii
    samples.push({
      date: d,
      y: p.value > 0 ? Math.log(p.value) : NaN,
      x1: curDfii,
      x2: curDxyRet,
    })
  }

  const complete = samples.filter(s => !isNaN(s.y) && s.x1 != null && s.x2 != null) as { date: string; y: number; x1: number; x2: number }[]
  const tail = complete.slice(-horizon)
  if (tail.length < 60) return []

  const coef = ols2(tail.map(s => s.y), tail.map(s => s.x1), tail.map(s => s.x2))
  const resid = complete.map(s => s.y - (coef.b0 + coef.b1 * s.x1 + coef.b2 * s.x2))

  // 用滚动 1Y 窗口标准化残差
  const out: ResidPoint[] = []
  const window = 250
  for (let i = 0; i < resid.length; i++) {
    const start = Math.max(0, i - window)
    const seg = resid.slice(start, i + 1)
    const z = seg.length >= 40 ? Math.abs(mean(seg)) < 1e-9 ? 0 : zScore(seg, resid[i]) : null
    out.push({
      date: complete[i].date,
      residualZ: z != null ? +z.toFixed(3) : null,
      fitted: null,
      actualLog: null,
    })
  }
  return out
}

export const GET = withCache(async () => {
  const horizon = 5 * 260

  const [goldRows, dxyRows, dfiiRows, t10yieRows] = await Promise.all([
    safeQuery(`
      SELECT price_date, close_price FROM gold_price_history
      WHERE source IN ('yfinance', 'gold-api', 'LOCAL-XLSX', 'FRED')
        AND currency = 'USD' AND unit = 'OZ'
        AND price_date >= DATE_SUB(CURDATE(), INTERVAL 5 YEAR)
      ORDER BY price_date ASC`),
    safeQuery(`
      SELECT p.trade_date, p.close_price FROM asset_prices p JOIN assets a ON a.id = p.asset_id
      WHERE a.symbol = 'DX-Y.NYB' AND p.close_price IS NOT NULL
        AND p.trade_date >= DATE_SUB(CURDATE(), INTERVAL 5 YEAR)
      ORDER BY p.trade_date ASC`),
    safeQuery(`
      SELECT d.period_date, d.value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id
      WHERE i.code = 'DFII10' AND i.region = 'US' AND d.value IS NOT NULL
        AND d.period_date >= DATE_SUB(CURDATE(), INTERVAL 5 YEAR)
      ORDER BY d.period_date ASC`),
    safeQuery(`
      SELECT d.period_date, d.value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id
      WHERE i.code = 'T10YIE' AND i.region = 'US' AND d.value IS NOT NULL
        AND d.period_date >= DATE_SUB(CURDATE(), INTERVAL 5 YEAR)
      ORDER BY d.period_date ASC`),
  ])

  const goldZ: SeriesPoint[] = goldRows.map((r: any) => ({ date: String(r.price_date).slice(0, 10), value: Number(r.close_price) }))
  const dxyZ: SeriesPoint[] = dxyRows.map((r: any) => ({ date: String(r.trade_date).slice(0, 10), value: Number(r.close_price) }))
  const dfiiZ: SeriesPoint[] = dfiiRows.map((r: any) => ({ date: String(r.period_date).slice(0, 10), value: Number(r.value) }))
  const t10yieZ: SeriesPoint[] = t10yieRows.map((r: any) => ({ date: String(r.period_date).slice(0, 10), value: Number(r.value) }))

  // —— 1. 双轴价格（近 2Y，用于页面对照）——
  const priceChart = alignByDate(goldZ, dxyZ).slice(-520).map(p => ({ date: p.date, gold: +p.a.toFixed(2), dxy: p.b != null ? +p.b.toFixed(2) : null }))

  // —— 2. 收益率滚动相关（20/60/120）——
  const goldRet = logReturns(goldZ)
  const dxyRetAll = logReturns(dxyZ)
  const corr20 = rollingCorr(goldRet, dxyRetAll, 20)
  const corr60 = rollingCorr(goldRet, dxyRetAll, 60)
  const corr120 = rollingCorr(goldRet, dxyRetAll, 120)
  const corrChart = corr60.slice(-1040).map(p => ({ date: p.date, value: p.value }))

  // —— 3. 状态机 ——
  const latest60 = corr60.length ? corr60[corr60.length - 1].value : 0
  const latest20 = corr20.length ? corr20[corr20.length - 1].value : 0
  const latest120 = corr120.length ? corr120[corr120.length - 1].value : 0
  const band = bandOf(latest60)
  const bandInfo = BAND_LABEL[band]

  // —— 4. 档位切换事件（5Y）——
  const switches = bandSwitchEvents(corr60)

  // —— 5. 事件研究：相关性失效 → 金价 20/60/120 ——
  const brokenEvents = switches
    .filter(s => s.to === 'broken' || s.to === 'positive')
    .map(s => s.date)
  const brokenStudy = eventStudy(goldZ, brokenEvents, [20, 60, 120])

  // —— 6. 双因子定价残差 ——
  const residSeries = buildResidualZ(goldZ, dxyZ, dfiiZ, horizon)
  const latestResid = residSeries.length ? residSeries[residSeries.length - 1] : null
  const residVals = residSeries.map(r => r.residualZ).filter((v): v is number => v != null) as number[]
  const latestResidZ = latestResid?.residualZ ?? 0
  const residPercentile = residVals.length > 1 ? percentileRank(residVals, latestResidZ) : 50

  // —— 7. 事件研究：残差极端 → 金价后市 ——
  const extremeEvents: { date: string; dir: 'overvalued' | 'undervalued' }[] = []
  let lastDir = ''
  for (const r of residSeries) {
    if (r.residualZ == null) continue
    if (r.residualZ >= 2) {
      if (lastDir !== 'over') { extremeEvents.push({ date: r.date, dir: 'overvalued' }); lastDir = 'over' }
    } else if (r.residualZ <= -2) {
      if (lastDir !== 'under') { extremeEvents.push({ date: r.date, dir: 'undervalued' }); lastDir = 'under' }
    }
  }
  const extremeOver = extremeEvents.filter(e => e.dir === 'overvalued').map(e => e.date)
  const extremeUnder = extremeEvents.filter(e => e.dir === 'undervalued').map(e => e.date)
  const overStudy = eventStudy(goldZ, extremeOver, [20, 60, 120])
  const underStudy = eventStudy(goldZ, extremeUnder, [20, 60, 120])

  // —— 8. 信号卡 ——
  let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral'
  let strength: SignalStrength = 'weak'
  let confidence = 0
  const evidence: string[] = []
  const counterEvidence: string[] = []
  const historical: { label: string; n: number; median: number; winRate: number }[] = []

  const color = (r: number) => (r >= 0 ? '红' : '绿')
  void color
  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`

  evidence.push(`双因子定价残差 z = ${latestResidZ >= 0 ? '+' : ''}${latestResidZ.toFixed(2)}（5Y 分位 ${residPercentile.toFixed(0)}）`)
  evidence.push(`黄金-美元收益率滚动相关（60 日）：${latest60.toFixed(2)}，解析为「${bandInfo.label}」`)
  evidence.push(`最新金价 ${goldZ.length ? goldZ[goldZ.length - 1].value.toFixed(2) : '--'} / DXY ${dxyZ.length ? dxyZ[dxyZ.length - 1].value.toFixed(2) : '--'}`)

  if (latestResidZ >= 2) {
    direction = 'bearish'
    evidence.push('残差严重为正：金价高于实际利率+美元模型定价，存高估风险')
  } else if (latestResidZ <= -2) {
    direction = 'bullish'
    evidence.push('残差严重为负：金价低于实际利率+美元模型定价，存在低估机会')
  } else {
    evidence.push('残差处于 ±2σ 内，金价与双因子定价模型基本一致')
  }

  if (band === 'broken' || band === 'positive') {
    evidence.push(`关注相关性「${bandInfo.label}」：传统美元定价逻辑失效，金价可能由地缘/其他因素独立定价`)
  }

  const hs = brokenStudy.horizons['60']
  if (brokenStudy.nEvents > 0 && hs && hs.n >= 3) {
    historical.push({
      label: `相关失效后 60 日`,
      n: brokenStudy.nEvents,
      median: hs.median,
      winRate: hs.winRate,
    })
  }
  const overH = overStudy.horizons['60']
  if (overStudy.nEvents > 0 && overH && overH.n >= 3) {
    historical.push({
      label: `残差高估后 60 日`,
      n: overStudy.nEvents,
      median: overH.median,
      winRate: overH.winRate,
    })
  }
  const underH = underStudy.horizons['60']
  if (underStudy.nEvents > 0 && underH && underH.n >= 3) {
    historical.push({
      label: `残差低估后 60 日`,
      n: underStudy.nEvents,
      median: underH.median,
      winRate: underH.winRate,
    })
  }

  const absZ = Math.abs(latestResidZ)
  strength = absZ >= 2.5 ? 'strong' : absZ >= 1.5 ? 'moderate' : 'weak'
  confidence = Math.round(Math.min(95, 45 + absZ * 15 + (strength === 'weak' ? 0 : 10) - (counterEvidence.length ? 10 : 0)))

  const signal = {
    id: 'gold-pricing-residual',
    module: 'gold',
    title: '黄金定价残差 + 美元关联信号',
    direction,
    strength,
    confidence: Math.max(20, Math.min(95, confidence)),
    evidence: [...evidence, ...historical.map(h => `历史：${h.label} 均值收益 ${fmtPct(h.median)}（${h.n} 次，胜率 ${fmtPct(h.winRate)}）`)],
    counterEvidence,
    historical,
    updatedAt: new Date().toISOString().slice(0, 10),
  }

  const data = {
    updatedAt: new Date().toISOString().slice(0, 10),
    latest: {
      gold: goldZ.length ? +goldZ[goldZ.length - 1].value.toFixed(2) : null,
      dxy: dxyZ.length ? +dxyZ[dxyZ.length - 1].value.toFixed(2) : null,
      corr20: +latest20.toFixed(3),
      corr60: +latest60.toFixed(3),
      corr120: +latest120.toFixed(3),
      band,
      bandLabel: bandInfo.label,
      bandDesc: bandInfo.desc,
      dfii10: dfiiZ.length ? +dfiiZ[dfiiZ.length - 1].value.toFixed(2) : null,
      t10yie: t10yieZ.length ? +t10yieZ[t10yieZ.length - 1].value.toFixed(2) : null,
      residZ: app(latestResidZ),
      residPercentile,
    },
    // 展示近 2Y 的对齐价格
    priceChart,
    // 滚动相关序列（近 2Y，20/60/120）
    corrChart: {
      s20: corr20.slice(-520).map(p => ({ date: p.date, value: +(p.value).toFixed(3) })),
      s60: corr60.slice(-520).map(p => ({ date: p.date, value: +(p.value).toFixed(3) })),
      s120: corr120.slice(-520).map(p => ({ date: p.date, value: +(p.value).toFixed(3) })),
    },
    bandSwitches: switches.slice(-12).map(s => ({ date: s.date, from: s.from, to: s.to })),
    residSeries: residSeries.slice(-520).map(p => ({ date: p.date, z: p.residualZ })),
    extremes: extremeEvents.slice(-15),
    eventStudies: {
      broken: brokenStudy,
      overvalued: overStudy,
      undervalued: underStudy,
    },
    signal,
  }

  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}, 300)

function app(v: number | null): number | null {
  return v != null ? +v.toFixed(2) : null
}

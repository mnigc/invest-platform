export const prerender = false

import type { APIRoute } from 'astro'
import { query, queryOne } from '../../../../lib/db'
import type { Anomaly, AnomalyResponse, BacktestSnapshot, BacktestSummary, BacktestResponse, RegimeType, RegimeSignal } from '../../../../lib/core'

const SIGNAL_NAMES: Record<string, string> = {
  cfnai: 'CFNAI 景气', cpi: 'CPI 通胀', fedfunds: '联邦利率',
  dgs10: '10Y 收益率', dgs2: '2Y 收益率', t10yie: '盈亏平衡通胀',
  vix: 'VIX 波动率', bbb: '信用利差 (BBB)', dfii10: 'TIPS 实际利率',
  sp500Pe: 'SP500 市盈率', erp: '股权风险溢价', slope: '期限利差 (10Y-2Y)',
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

async function valAtDate(code: string, asOf: string): Promise<number | null> {
  try {
    const row = await queryOne<any>(
      `SELECT d.value FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = ? AND d.period_date <= ? AND d.value IS NOT NULL
       ORDER BY d.period_date DESC LIMIT 1`,
      [code, asOf]
    )
    return row ? Number(row.value) : null
  } catch { return null }
}

function decideRegime(signals: Map<string, RegimeSignal>): { regime: RegimeType; score: number } {
  const ok = (name: string) => (signals.get(name)?.score ?? 0) === 1
  const ko = (name: string) => (signals.get(name)?.score ?? 0) === -1
  const neutral = (name: string) => (signals.get(name)?.score ?? 0) === 0

  const growthOk = ok('cfnai')
  const inflationHigh = ko('cpi')
  const stress = ko('vix') || ko('bbb')
  const slopeNormal = ok('slope')

  if (growthOk && !inflationHigh && !stress && slopeNormal) return { regime: 'GOLDILOCKS', score: 10 }
  if (growthOk && !inflationHigh && stress) return { regime: 'RISK_ON', score: 7 }
  if (growthOk && inflationHigh && !stress) return { regime: 'OVERHEAT', score: 6 }
  if (growthOk && inflationHigh && stress) return { regime: 'STAGFLATION', score: 4 }
  if (!growthOk && inflationHigh && stress) return { regime: 'STAGFLATION', score: 3 }
  if (!growthOk && !inflationHigh && stress) return { regime: 'RISK_OFF', score: 2 }
  if (neutral('cfnai') && ok('fedfunds') && !stress) return { regime: 'RECOVERY', score: 5 }

  return { regime: 'UNKNOWN', score: 0 }
}

const LABELS: Record<RegimeType, string> = {
  GOLDILOCKS: '金发女孩', RISK_ON: '风险偏好', OVERHEAT: '过热',
  STAGFLATION: '滞胀', RISK_OFF: '风险规避', RECOVERY: '复苏', UNKNOWN: '不确定',
}

async function detectRegime(asOf?: string) {
  const cfnai = await valAtDate('CFNAI', asOf ?? new Date().toISOString().slice(0, 10))
  const cpi = await valAtDate('CPI', asOf ?? new Date().toISOString().slice(0, 10))
  const fedfunds = await valAtDate('FEDFUNDS', asOf ?? new Date().toISOString().slice(0, 10))
  const dgs10 = await valAtDate('DGS10', asOf ?? new Date().toISOString().slice(0, 10))
  const dgs2 = await valAtDate('DGS2', asOf ?? new Date().toISOString().slice(0, 10))
  const t10yie = await valAtDate('T10YIE', asOf ?? new Date().toISOString().slice(0, 10))
  const vix = await valAtDate('VIXCLS', asOf ?? new Date().toISOString().slice(0, 10))
  const bbb = await valAtDate('BAMLC0A4CBBB', asOf ?? new Date().toISOString().slice(0, 10))
  const dfii10 = await valAtDate('DFII10', asOf ?? new Date().toISOString().slice(0, 10))

  const f = (v: number | null, fallback: number) => v ?? fallback
  const gCfnai = f(cfnai, 0.05)
  const gCpi = f(cpi, 3.0)
  const gFedfunds = f(fedfunds, 5.25)
  const gDgs10 = f(dgs10, 4.30)
  const gDgs2 = f(dgs2, 4.70)
  const gT10yie = f(t10yie, 2.20)
  const gVix = f(vix, 14.0)
  const gBbb = f(bbb, 1.20)
  const gDfii10 = f(dfii10, 1.80)
  const slope = +(gDgs10 - gDgs2).toFixed(4)

  const sig = (code: string, val: number | string, score: -1 | 0 | 1, detail?: string): RegimeSignal => ({
    name: SIGNAL_NAMES[code] || code, value: val, score, detail,
  })

  const signals: RegimeSignal[] = [
    sig('cfnai', gCfnai.toFixed(3), gCfnai > 0 ? 1 : gCfnai < -0.5 ? -1 : 0,
      gCfnai > 0 ? '高于零，经济扩张' : '低于零，经济收缩'),
    sig('cpi', `${gCpi.toFixed(1)}%`, gCpi < 3 ? 1 : gCpi < 5 ? 0 : -1,
      gCpi < 3 ? '通胀受控' : gCpi < 5 ? '通胀偏高' : '通胀严重'),
    sig('fedfunds', `${gFedfunds.toFixed(2)}%`, gFedfunds > 5 ? 0 : gFedfunds > 2 ? 1 : gFedfunds > 0 ? 0 : -1,
      gFedfunds > 5 ? '紧缩周期' : '正常或宽松'),
    sig('t10yie', `${gT10yie.toFixed(2)}%`, gT10yie < 2.5 ? 1 : gT10yie < 3.5 ? 0 : -1,
      gT10yie < 2.5 ? '通胀预期温和' : '通胀预期偏高'),
    sig('vix', gVix.toFixed(2), gVix < 20 ? 1 : gVix < 30 ? 0 : -1,
      gVix < 20 ? '低波动，市场平静' : gVix < 30 ? '波动偏高' : '恐慌水平'),
    sig('bbb', `${gBbb.toFixed(2)}%`, gBbb < 1.5 ? 1 : gBbb < 2.5 ? 0 : -1,
      gBbb < 1.5 ? '信用市场宽松' : gBbb < 2.5 ? '信用正常' : '信用紧张'),
    sig('slope', `${slope.toFixed(2)}%`, slope > 0 ? 1 : slope > -0.5 ? 0 : -1,
      slope > 0 ? '曲线正常陡峭' : slope > -0.5 ? '平坦' : '深度倒挂，衰退信号'),
    sig('dfii10', `${gDfii10.toFixed(2)}%`, gDfii10 < 2 ? 1 : gDfii10 < 3 ? 0 : -1,
      gDfii10 < 2 ? '实际利率偏低，流动性宽松' : '实际利率偏高'),
  ]

  const smap = new Map<string, RegimeSignal>()
  signals.forEach(s => smap.set(s.name, s))
  const { regime, score } = decideRegime(smap)

  const signalCount = signals.filter(s => s.score !== 0).length
  const maxScore = signalCount * 0.15
  const confidence = signalCount > 0
    ? clamp(Math.abs(score) / Math.max(maxScore, 0.01) * 100, 0, 100)
    : 0

  return { signals, confidence: Math.round(confidence), regime, label: LABELS[regime] }
}

async function latestVal(code: string): Promise<number | null> {
  try {
    const row = await queryOne<any>(
      `SELECT d.value FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = ? AND d.value IS NOT NULL
       ORDER BY d.period_date DESC LIMIT 1`,
      [code]
    )
    return row ? Number(row.value) : null
  } catch { return null }
}

async function valNDaysAgo(code: string, offset: number): Promise<number | null> {
  try {
    const row = await queryOne<any>(
      `SELECT d.value FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = ? AND d.value IS NOT NULL
       ORDER BY d.period_date DESC LIMIT 1 OFFSET ?`,
      [code, offset]
    )
    return row ? Number(row.value) : null
  } catch { return null }
}

async function detectAnomalies(): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = []

  const dgs10 = await latestVal('DGS10')
  const dgs2 = await latestVal('DGS2')
  const vix = await latestVal('VIXCLS')
  const bbb = await latestVal('BAMLC0A4CBBB')
  const cpi = await latestVal('CPI')
  const fedfunds = await latestVal('FEDFUNDS')
  const cfnai = await latestVal('CFNAI')
  const dfii10 = await latestVal('DFII10')
  const t10yie = await latestVal('T10YIE')
  const vixPrev = await valNDaysAgo('VIXCLS', 22)

  const f = (v: number | null, fb: number) => v ?? fb
  const gDgs10 = f(dgs10, 4.3)
  const gDgs2 = f(dgs2, 4.7)
  const gVix = f(vix, 14)
  const gBbb = f(bbb, 1.2)
  const gCpi = f(cpi, 3.0)
  const gFedfunds = f(fedfunds, 5.25)
  const gCfnai = f(cfnai, 0.05)
  const gDfii10 = f(dfii10, 1.8)
  const gT10yie = f(t10yie, 2.2)
  const slope = gDgs10 - gDgs2

  if (slope < -0.5) {
    anomalies.push({
      id: 'yield-curve-deep-inversion',
      title: '深度收益率曲线倒挂',
      description: '10Y-2Y 利差深度倒挂，历史衰退信号',
      severity: 'high', indicator: 'DGS10, DGS2',
      currentValue: `${slope.toFixed(2)}%`, threshold: '< -0.50%',
    })
  }

  if (gBbb > 2.5 && gVix > 25) {
    anomalies.push({
      id: 'credit-panic',
      title: '信用市场恐慌',
      description: '信用利差扩大 + 波动率飙升，系统性压力信号',
      severity: 'critical', indicator: 'BAMLC0A4CBBB, VIXCLS',
      currentValue: `BBB ${gBbb.toFixed(2)}% / VIX ${gVix.toFixed(1)}`,
      threshold: 'BBB > 2.5% & VIX > 25',
    })
  }

  if (gCpi > 5 && gCpi > gFedfunds) {
    anomalies.push({
      id: 'inflation-out-of-control',
      title: '通胀远超政策利率',
      description: '实际利率深度为负，央行滞后于通胀曲线',
      severity: 'high', indicator: 'CPI, FEDFUNDS',
      currentValue: `CPI ${gCpi.toFixed(1)}% > Fed ${gFedfunds.toFixed(2)}%`,
      threshold: 'CPI > FedFunds',
    })
  }

  if (gCfnai < -0.7) {
    anomalies.push({
      id: 'cfnai-recession',
      title: '经济活动深度收缩',
      description: 'CFNAI 低于 -0.7，经济进入衰退区',
      severity: 'high', indicator: 'CFNAI',
      currentValue: gCfnai.toFixed(3), threshold: '< -0.70',
    })
  }

  if (gCfnai < 0 && gCpi > 4) {
    anomalies.push({
      id: 'stagflation-signal',
      title: '滞胀风险',
      description: '经济增长放缓 + 通胀高企，类1970s滞胀情景',
      severity: 'high', indicator: 'CFNAI, CPI',
      currentValue: `CFNAI ${gCfnai.toFixed(3)} / CPI ${gCpi.toFixed(1)}%`,
      threshold: 'CFNAI < 0 & CPI > 4%',
    })
  }

  if (gDfii10 > 2.5) {
    anomalies.push({
      id: 'real-rate-spike',
      title: '实际利率偏高',
      description: 'TIPS 实际利率超过 2.5%，流动性收紧信号',
      severity: 'medium', indicator: 'DFII10',
      currentValue: `${gDfii10.toFixed(2)}%`, threshold: '> 2.50%',
    })
  }

  if (gT10yie > 3 && gCpi < 3) {
    anomalies.push({
      id: 'expectation-deanchor',
      title: '通胀预期脱锚',
      description: '盈亏平衡通胀率高于实际CPI，市场预期远超现实',
      severity: 'medium', indicator: 'T10YIE, CPI',
      currentValue: `T10YIE ${gT10yie.toFixed(2)}% / CPI ${gCpi.toFixed(1)}%`,
      threshold: 'T10YIE > 3% & CPI < 3%',
    })
  }

  if (gVix > 20 && vixPrev !== null && vixPrev > 0) {
    const vixChange = (gVix - vixPrev) / vixPrev
    if (vixChange > 0.4) {
      anomalies.push({
        id: 'volatility-shock',
        title: '波动率冲击',
        description: `VIX 一月内飙升 ${(vixChange * 100).toFixed(0)}%，市场恐慌情绪急剧升温`,
        severity: 'medium', indicator: 'VIXCLS',
        currentValue: `${gVix.toFixed(1)} (${(vixChange * 100).toFixed(0)}% MoM)`,
        threshold: '月变化 > 40%',
      })
    }
  }

  return anomalies
}

function addMonths(date: string, n: number): string {
  const d = new Date(date)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

function monthEnds(start: string, end: string): string[] {
  const dates: string[] = []
  let d = new Date(start)
  const endD = new Date(end)
  while (d <= endD) {
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    const me = lastDay <= endD ? lastDay : endD
    dates.push(me.toISOString().slice(0, 10))
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
  }
  return dates
}

export const GET = async ({ request }) => {
  const url = new URL(request.url)
  const path = url.pathname
  const subPath = path.split('/').pop()

  if (subPath === 'anomalies.json') {
    return await handleAnomalies()
  } else if (subPath === 'backtest.json') {
    return await handleBacktest(url)
  }

  return new Response(
    JSON.stringify({ success: false, error: 'Not found' }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  )
}

async function handleAnomalies(): Promise<Response> {
  try {
    const anomalies = await detectAnomalies()
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          anomalies,
          totalCount: anomalies.length,
          highCount: anomalies.filter(a => a.severity === 'high' || a.severity === 'critical').length,
          updatedAt: new Date().toISOString().slice(0, 10),
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[Anomaly]', err.message)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

async function handleBacktest(url: URL): Promise<Response> {
  try {
    const startDate = url.searchParams.get('startDate') || '2010-01-01'
    const endDate = url.searchParams.get('endDate') || new Date().toISOString().slice(0, 10)

    const prices = await query<any>(
      `SELECT ap.trade_date, ap.close_price
       FROM asset_prices ap
       JOIN assets a ON a.id = ap.asset_id
       WHERE a.symbol = '^GSPC' AND ap.trade_date BETWEEN ? AND ?
       ORDER BY ap.trade_date ASC`,
      [startDate, endDate]
    )

    if (prices.length < 2) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            snapshots: [],
            summaries: [],
            overall: { startDate, endDate, totalSnapshots: 0, avgReturn1m: 0, avgReturn3m: 0, avgReturn6m: 0, avgReturn12m: 0 },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const priceMap = new Map<string, number>()
    prices.forEach((p: any) => priceMap.set(p.trade_date.toISOString().slice(0, 10), Number(p.close_price)))
    const sortedDates = [...priceMap.keys()].sort()

    function priceAt(date: string): number | null {
      for (let i = sortedDates.length - 1; i >= 0; i--) {
        if (sortedDates[i] <= date) return priceMap.get(sortedDates[i])!
      }
      return null
    }

    const evalDates = monthEnds(startDate, endDate)
    const snapshots: BacktestSnapshot[] = []

    for (const date of evalDates) {
      const spPrice = priceAt(date)
      if (spPrice === null) continue

      const regime = await detectRegime(date)

      const forwardMonths = [1, 3, 6, 12] as const
      const returns: { 1: number; 3: number; 6: number; 12: number } = { 1: 0, 3: 0, 6: 0, 12: 0 }

      for (const m of forwardMonths) {
        const fwdDate = addMonths(date, m)
        const fwdPrice = priceAt(fwdDate)
        if (fwdPrice && fwdPrice > 0) {
          returns[m] = +(fwdPrice / spPrice - 1).toFixed(4)
        }
      }

      snapshots.push({
        date,
        regime: regime.regime,
        label: regime.label,
        confidence: regime.confidence,
        sp500Price: spPrice,
        forwardReturns: returns,
      })
    }

    const byRegime = new Map<RegimeType, BacktestSnapshot[]>()
    for (const s of snapshots) {
      const arr = byRegime.get(s.regime) || []
      arr.push(s)
      byRegime.set(s.regime, arr)
    }

    const summaries: BacktestSummary[] = []
    for (const [regime, snaps] of byRegime) {
      const n = snaps.length
      const avg = (field: (s: BacktestSnapshot) => number) =>
        +(snaps.reduce((sum, s) => sum + field(s), 0) / n).toFixed(4)
      const winRate = (field: (s: BacktestSnapshot) => number) =>
        +(snaps.filter(s => field(s) > 0).length / n).toFixed(4)

      summaries.push({
        regime,
        label: LABELS[regime] || regime,
        count: n,
        avgConfidence: avg(s => s.confidence),
        avgReturn1m: avg(s => s.forwardReturns[1]),
        avgReturn3m: avg(s => s.forwardReturns[3]),
        avgReturn6m: avg(s => s.forwardReturns[6]),
        avgReturn12m: avg(s => s.forwardReturns[12]),
        winRate1m: winRate(s => s.forwardReturns[1]),
        winRate3m: winRate(s => s.forwardReturns[3]),
        winRate6m: winRate(s => s.forwardReturns[6]),
        winRate12m: winRate(s => s.forwardReturns[12]),
      })
    }

    summaries.sort((a, b) => b.count - a.count)

    const total = snapshots.length
    const overall = {
      startDate,
      endDate,
      totalSnapshots: total,
      avgReturn1m: +(snapshots.reduce((s, x) => s + x.forwardReturns[1], 0) / Math.max(total, 1)).toFixed(4),
      avgReturn3m: +(snapshots.reduce((s, x) => s + x.forwardReturns[3], 0) / Math.max(total, 1)).toFixed(4),
      avgReturn6m: +(snapshots.reduce((s, x) => s + x.forwardReturns[6], 0) / Math.max(total, 1)).toFixed(4),
      avgReturn12m: +(snapshots.reduce((s, x) => s + x.forwardReturns[12], 0) / Math.max(total, 1)).toFixed(4),
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: { snapshots, summaries, overall },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[RegimeBacktest]', err.message)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

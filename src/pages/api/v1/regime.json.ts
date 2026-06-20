export const prerender = false

import type { APIRoute } from 'astro'
import { query, queryOne } from '../../../lib/db'
import { withCache } from '../../../lib/cache'
import type { RegimeType, RegimeSignal, RegimeResponse } from '../../../lib/core'

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

export const GET = withCache(async () => {
  try {
    const result = await detectRegime()
    return new Response(
      JSON.stringify({
        success: true,
        data: { ...result, updatedAt: new Date().toISOString().slice(0, 10) },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[Regime]', err.message)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}, 600)

export const prerender = false

import { query, queryOne } from '../../../lib/db'
import { withCache } from '../../../lib/cache'
import { toDateStr } from '../../../lib/date'
import type { RegimeType, RegimeSignal } from '../../../lib/core'

const SIGNAL_NAMES: Record<string, string> = {
  cfnai: 'CFNAI 景气', cpi: 'CPI 通胀', fedfunds: '联邦利率',
  dgs10: '10Y 收益率', dgs2: '2Y 收益率', t10yie: '盈亏平衡通胀',
  vix: 'VIX 波动率', bbb: '信用利差 (BBB)', dfii10: 'TIPS 实际利率',
  sp500Pe: 'SP500 市盈率', erp: '股权风险溢价', slope: '期限利差 (10Y-2Y)',
}

// 指标代码到 FRED code 的映射（用于查询历史数据）
const INDICATOR_CODE_MAP: Record<string, string> = {
  cfnai: 'CFNAI', cpi: 'CPI', fedfunds: 'FEDFUNDS',
  dgs10: 'DGS10', dgs2: 'DGS2', t10yie: 'T10YIE',
  vix: 'VIXCLS', bbb: 'BAMLC0A4CBBB', dfii10: 'DFII10',
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

async function valAtDate(code: string, asOf: string, region: string = 'US'): Promise<number | null> {
  try {
    const row = await queryOne<any>(
      `SELECT d.value FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = ? AND i.region = ? AND d.period_date <= ? AND d.value IS NOT NULL
       ORDER BY d.period_date DESC LIMIT 1`,
      [code, region, asOf]
    )
    return row ? Number(row.value) : null
  } catch { return null }
}

async function sparklineData(code: string, months: number = 12): Promise<{ date: string; value: number }[]> {
  try {
    const fredCode = INDICATOR_CODE_MAP[code]
    if (!fredCode) return []
    // 按时间窗取数而非 LIMIT 行数：日频与月频序列「12 个月」对应的行数差一个量级
    const since = new Date()
    since.setMonth(since.getMonth() - months)
    const rows = await query<any>(
      `SELECT d.period_date, d.value FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = ? AND i.region = 'US' AND d.value IS NOT NULL AND d.period_date >= ?
       ORDER BY d.period_date DESC`,
      [fredCode, toDateStr(since)]
    )
    return rows.reverse().map((r: any) => ({
      date: toDateStr(r.period_date),
      value: Number(r.value),
    }))
  } catch { return [] }
}

// 「一年前」基期的最大允许偏差：月频序列发布常滞后数周，超窗视为基期缺失
const YoY_WINDOW_DAYS = 45

async function yoyAtDate(code: string, asOf: string, region: string = 'US'): Promise<number | null> {
  try {
    const rows = await query<any>(
      `SELECT d.period_date, d.value FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = ? AND i.region = ? AND d.period_date <= ? AND d.value IS NOT NULL
       ORDER BY d.period_date DESC LIMIT 24`,
      [code, region, asOf]
    )
    if (!rows || rows.length < 2) return null
    const current = Number(rows[0].value)
    const asOfMs = new Date(toDateStr(rows[0].period_date)).getTime()
    const yearAgoTargetMs = asOfMs - 365.25 * 24 * 3600 * 1000
    let yearAgo: number | null = null
    let minDiff = Number.POSITIVE_INFINITY
    for (const r of rows) {
      const diff = Math.abs(new Date(toDateStr(r.period_date)).getTime() - yearAgoTargetMs)
      if (diff < minDiff) { minDiff = diff; yearAgo = Number(r.value) }
    }
    // 基期距「一年前」过远（序列历史不足或断档）→ 不产出失真的同比
    if (yearAgo == null || yearAgo === 0 || minDiff > YoY_WINDOW_DAYS * 24 * 3600 * 1000) return null
    return +(((current - yearAgo) / yearAgo) * 100).toFixed(2)
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
  const asOfDate = asOf ?? new Date().toISOString().slice(0, 10)

  // 全部 16 个查询互相独立，一次性并行发出（Neon WebSocket 每查询一个往返，
  // 串行链在冷启动时会线性放大首屏延迟）
  const [cfnai, cpi, fedfunds, dgs10, dgs2, t10yie, vix, bbb, dfii10,
    sparkCfnai, sparkCpi, sparkFedfunds, sparkT10yie, sparkVix, sparkBbb, sparkDfii10] = await Promise.all([
    valAtDate('CFNAI', asOfDate, 'US'),
    yoyAtDate('CPI', asOfDate, 'US'),
    valAtDate('FEDFUNDS', asOfDate, 'US'),
    valAtDate('DGS10', asOfDate, 'US'),
    valAtDate('DGS2', asOfDate, 'US'),
    valAtDate('T10YIE', asOfDate, 'US'),
    valAtDate('VIXCLS', asOfDate, 'US'),
    valAtDate('BAMLC0A4CBBB', asOfDate, 'US'),
    valAtDate('DFII10', asOfDate, 'US'),
    sparklineData('cfnai', 12),
    sparklineData('cpi', 12),
    sparklineData('fedfunds', 12),
    sparklineData('t10yie', 12),
    sparklineData('vix', 12),
    sparklineData('bbb', 12),
    sparklineData('dfii10', 12),
  ])

  // 数据缺失的信号保持「中性」并标注，不再用硬编码默认值冒充真实数据参与判定
  const signalMap = new Map<string, RegimeSignal>()
  const sig = (code: string, val: number | string, score: -1 | 0 | 1, detail?: string, sparkline?: { date: string; value: number }[]): RegimeSignal => {
    const s: RegimeSignal = { name: SIGNAL_NAMES[code] || code, value: val, score, detail, sparkline }
    signalMap.set(code, s)
    return s
  }
  const missing = (code: string, sparkline?: { date: string; value: number }[]) =>
    sig(code, '—', 0, '数据缺失', sparkline)

  const slope = dgs10 != null && dgs2 != null ? +(dgs10 - dgs2).toFixed(4) : null

  const signals: RegimeSignal[] = [
    cfnai != null
      ? sig('cfnai', cfnai.toFixed(3), cfnai > 0 ? 1 : cfnai < -0.5 ? -1 : 0,
          cfnai > 0 ? '高于零，经济扩张' : '低于零，经济收缩', sparkCfnai)
      : missing('cfnai', sparkCfnai),
    cpi != null
      ? sig('cpi', `${cpi.toFixed(1)}%`, cpi < 3 ? 1 : cpi < 5 ? 0 : -1,
          cpi < 3 ? '通胀受控' : cpi < 5 ? '通胀偏高' : '通胀严重', sparkCpi)
      : missing('cpi', sparkCpi),
    fedfunds != null
      ? sig('fedfunds', `${fedfunds.toFixed(2)}%`, fedfunds > 5 ? 0 : fedfunds > 2 ? 1 : fedfunds > 0 ? 0 : -1,
          fedfunds > 5 ? '紧缩周期' : '正常或宽松', sparkFedfunds)
      : missing('fedfunds', sparkFedfunds),
    t10yie != null
      ? sig('t10yie', `${t10yie.toFixed(2)}%`, t10yie < 2.5 ? 1 : t10yie < 3.5 ? 0 : -1,
          t10yie < 2.5 ? '通胀预期温和' : '通胀预期偏高', sparkT10yie)
      : missing('t10yie', sparkT10yie),
    vix != null
      ? sig('vix', vix.toFixed(2), vix < 20 ? 1 : vix < 30 ? 0 : -1,
          vix < 20 ? '低波动，市场平静' : vix < 30 ? '波动偏高' : '恐慌水平', sparkVix)
      : missing('vix', sparkVix),
    bbb != null
      ? sig('bbb', `${bbb.toFixed(2)}%`, bbb < 1.5 ? 1 : bbb < 2.5 ? 0 : -1,
          bbb < 1.5 ? '信用市场宽松' : bbb < 2.5 ? '信用正常' : '信用紧张', sparkBbb)
      : missing('bbb', sparkBbb),
    slope != null
      ? sig('slope', `${slope.toFixed(2)}%`, slope > 0 ? 1 : slope > -0.5 ? 0 : -1,
          slope > 0 ? '曲线正常陡峭' : slope > -0.5 ? '平坦' : '深度倒挂，衰退信号')
      : missing('slope'),
    dfii10 != null
      ? sig('dfii10', `${dfii10.toFixed(2)}%`, dfii10 < 2 ? 1 : dfii10 < 3 ? 0 : -1,
          dfii10 < 2 ? '实际利率偏低，流动性宽松' : '实际利率偏高', sparkDfii10)
      : missing('dfii10', sparkDfii10),
  ]

  const { regime, score } = decideRegime(signalMap)

  // confidence = 体制得分强度（0~10 尺度）× 输入数据完整度：
  // score 是各体制的固定量级分，旧实现按 0~1 量纲设分母导致恒为 0/100；
  // 完整度因子让「数据缺失被中性化」的判定相应降低置信度而非虚高。
  const inputs = [cfnai, cpi, fedfunds, dgs10, dgs2, t10yie, vix, bbb, dfii10]
  const completeness = inputs.filter(v => v != null).length / inputs.length
  const confidence = clamp(Math.round((Math.abs(score) / 10) * 100 * completeness), 0, 100)

  return { signals, confidence, regime, label: LABELS[regime] }
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
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}, 600)

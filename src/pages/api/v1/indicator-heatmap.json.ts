export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';

interface IndicatorDef {
  code: string
  region: string
  label: string
  aggregate: 'avg' | 'sum'
}

const US: IndicatorDef[] = [
  { code: 'GDP', region: 'US', label: 'GDP', aggregate: 'avg' },
  { code: 'CPI', region: 'US', label: 'CPI', aggregate: 'avg' },
  { code: 'PPI', region: 'US', label: 'PPI', aggregate: 'avg' },
  { code: 'PCE', region: 'US', label: 'PCE', aggregate: 'avg' },
  { code: 'RSXFS', region: 'US', label: '零售销售', aggregate: 'avg' },
  { code: 'UMCSENT', region: 'US', label: '消费者信心', aggregate: 'avg' },
  { code: 'UNRATE', region: 'US', label: '失业率', aggregate: 'avg' },
  { code: 'FEDFUNDS', region: 'US', label: '联邦基金利率', aggregate: 'avg' },
  { code: 'DGS10', region: 'US', label: '10Y收益率', aggregate: 'avg' },
  { code: 'VIXCLS', region: 'US', label: 'VIX', aggregate: 'avg' },
];

const CN: IndicatorDef[] = [
  { code: 'GDP', region: 'CN', label: 'GDP', aggregate: 'avg' },
  { code: 'CPI', region: 'CN', label: 'CPI', aggregate: 'avg' },
  { code: 'PPI', region: 'CN', label: 'PPI', aggregate: 'avg' },
  { code: 'PMI', region: 'CN', label: 'PMI', aggregate: 'avg' },
  { code: 'RETAIL', region: 'CN', label: '社消零售', aggregate: 'avg' },
  { code: 'CN_TREASURY_10Y', region: 'CN', label: '10Y收益率', aggregate: 'avg' },
  { code: 'NORTHBOUND_FLOW', region: 'CN', label: '北向资金', aggregate: 'sum' },
  { code: 'CN_TOTAL_RES', region: 'CN', label: '外汇储备', aggregate: 'avg' },
];

interface MonthlyPoint {
  ym: string
  value: number
}

interface IndicatorSeries {
  label: string
  monthly: MonthlyPoint[]
}

interface CountryHeatmap {
  indicator: string
  ym: string
  zScore: number
  rawValue: number
}

async function loadMonthly(def: IndicatorDef): Promise<IndicatorSeries> {
  // Special handling for GDP (quarterly data needs months filled)
  if (def.code === 'GDP') {
    const rows = await query<any>(
      `SELECT period_date, value FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = 'GDP' AND i.region = ? AND d.value IS NOT NULL ORDER BY period_date`,
      [def.region]
    )
    const filled: MonthlyPoint[] = []
    let prevCum = 0 // for CN cumulative de-cumulation
    for (const r of rows) {
      const date = String(r.period_date).slice(0, 10)
      const month = parseInt(date.slice(5, 7))
      const year = date.slice(0, 4)
      const rawValue = Number(r.value)
      // CN GDP is year-to-date cumulative; de-cumulate to get single-quarter value
      const qValue = def.region === 'CN' ? rawValue - prevCum : rawValue
      if (def.region === 'CN') prevCum = rawValue
      // Fill all 3 months of the quarter with the same value
      const qStart = Math.floor((month - 1) / 3) * 3 + 1
      for (let m = qStart; m < qStart + 3; m++) {
        filled.push({ ym: `${year}-${String(m).padStart(2, '0')}`, value: qValue })
      }
    }
    return { label: def.label, monthly: filled }
  }

  const fn = def.aggregate === 'sum' ? 'SUM' : 'AVG'
  const rows = await query<any>(
    `SELECT DATE_FORMAT(period_date, '%Y-%m') as ym, ${fn}(value) as val
     FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id
     WHERE i.code = ? AND i.region = ? AND d.value IS NOT NULL
     GROUP BY ym ORDER BY ym`,
    [def.code, def.region]
  )
  return { label: def.label, monthly: rows.map((r: any) => ({ ym: r.ym, value: Number(r.val) })) }
}

function computeZScore(monthly: MonthlyPoint[]): { ym: string; zScore: number; rawValue: number }[] {
  if (monthly.length < 3) return []
  const vals = monthly.map(p => p.value)
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length
  const std = Math.sqrt(variance)
  if (std === 0) return monthly.map(p => ({ ym: p.ym, zScore: 0, rawValue: p.value }))
  return monthly.map(p => ({ ym: p.ym, zScore: +( (p.value - mean) / std ).toFixed(2), rawValue: p.value }))
}

function getLastNMonths(data: { ym: string; zScore: number; rawValue: number }[], n: number): CountryHeatmap[] {
  const sorted = [...data].sort((a, b) => a.ym.localeCompare(b.ym))
  return sorted.slice(-n)
}

export const GET = withCache(async () => {
  try {
    const [usSeries, cnSeries] = await Promise.all([
      Promise.all(US.map(loadMonthly)),
      Promise.all(CN.map(loadMonthly)),
    ])

    const usResult: CountryHeatmap[] = []
    for (const s of usSeries) {
      const scored = computeZScore(s.monthly)
      const recent = getLastNMonths(scored, 24)
      for (const p of recent) {
        usResult.push({ indicator: s.label, ym: p.ym, zScore: p.zScore, rawValue: p.rawValue })
      }
    }

    const cnResult: CountryHeatmap[] = []
    for (const s of cnSeries) {
      const scored = computeZScore(s.monthly)
      const recent = getLastNMonths(scored, 24)
      for (const p of recent) {
        cnResult.push({ indicator: s.label, ym: p.ym, zScore: p.zScore, rawValue: p.rawValue })
      }
    }

    // Compute months list
    const allYms = new Set<string>()
    for (const r of usResult) allYms.add(r.ym)
    for (const r of cnResult) allYms.add(r.ym)
    const months = Array.from(allYms).sort()

    return new Response(JSON.stringify({
      success: true,
      data: { us: usResult, cn: cnResult, months },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e.message || '查询失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}, 600)

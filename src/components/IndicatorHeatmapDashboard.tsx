import { useEffect, useMemo, useState } from 'react'
import { MacroCard } from './ui/MacroCard'
import { THEME } from './ui/theme'
import { LoadingSkeleton } from './ui/LoadingSkeleton'
import { HeatmapMatrix } from './charts/HeatmapMatrix'

interface HeatmapCell {
  row: string
  col: string
  value: number
}

interface HeatmapPoint {
  indicator: string
  ym: string
  zScore: number
  rawValue: number
}

interface ApiData {
  us: HeatmapPoint[]
  cn: HeatmapPoint[]
  months: string[]
}

function toCells(points: HeatmapPoint[]): HeatmapCell[] {
  return points.map(p => ({ row: p.indicator, col: p.ym, value: p.zScore }))
}

// ── Rule-based macro summary engine ──

interface IndicatorLatest {
  name: string
  zScore: number
  rawValue: number
}

function getLatest(points: HeatmapPoint[], indicator: string): IndicatorLatest | null {
  const filtered = points.filter(p => p.indicator === indicator)
  if (!filtered.length) return null
  const latest = filtered.reduce((a, b) => a.ym > b.ym ? a : b)
  return { name: indicator, zScore: latest.zScore, rawValue: latest.rawValue }
}

function classify(z: number): 'hot' | 'warm' | 'neutral' | 'cool' | 'cold' {
  if (z > 1.5) return 'hot'
  if (z > 0.5) return 'warm'
  if (z > -0.5) return 'neutral'
  if (z > -1.5) return 'cool'
  return 'cold'
}

function labelCn(c: string): string {
  return { hot: '偏热', warm: '温和偏热', neutral: '中性', cool: '温和偏冷', cold: '偏冷' }[c]
}

function generateUsSummary(points: HeatmapPoint[]): string {
  const get = (name: string) => getLatest(points, name)
  const parts: string[] = []

  // Inflation
  const cpi = get('CPI')
  const ppi = get('PPI')
  const pce = get('PCE')
  const inflSens = [cpi, ppi, pce].filter(Boolean) as IndicatorLatest[]
  if (inflSens.length) {
    const avg = inflSens.reduce((a, b) => a + b.zScore, 0) / inflSens.length
    const cl = classify(avg)
    const detail = inflSens.map(s => `${s.name}=${s.rawValue.toFixed(1)}`).join('、')
    parts.push(`通胀${labelCn(cl)}（${detail}，综合z=${avg.toFixed(1)}）`)
  }

  // Growth
  const gdp = get('GDP')
  const retail = get('零售销售')
  const growthSens = [gdp, retail].filter(Boolean) as IndicatorLatest[]
  if (growthSens.length) {
    const avg = growthSens.reduce((a, b) => a + b.zScore, 0) / growthSens.length
    const cl = classify(avg)
    parts.push(`经济增长${labelCn(cl)}（GDP z=${gdp?.zScore.toFixed(1) ?? '--'}，零售 z=${retail?.zScore.toFixed(1) ?? '--'}）`)
  }

  // Labor (inverted: high unemployment z = bad)
  const unrate = get('失业率')
  if (unrate) {
    const cl = classify(-unrate.zScore) // invert
    parts.push(`就业市场${labelCn(cl)}（失业率 z=${unrate.zScore.toFixed(1)}，数值越低说明就业越紧张）`)
  }

  // Policy
  const ffr = get('联邦基金利率')
  if (ffr) {
    const cl = classify(ffr.zScore)
    parts.push(`货币政策${labelCn(cl)}（联邦基金利率 z=${ffr.zScore.toFixed(1)}）`)
  }

  // Sentiment
  const vix = get('VIX')
  const umcsent = get('消费者信心')
  if (vix) {
    const cl = classify(-vix.zScore) // inverted: high vix = fear
    parts.push(`市场情绪${labelCn(cl)}（VIX z=${vix.zScore.toFixed(1)}）`)
  }
  if (umcsent) {
    const cl = classify(umcsent.zScore)
    parts.push(`消费者信心${labelCn(cl)}（z=${umcsent.zScore.toFixed(1)}）`)
  }

  return parts.join('；')
}

function generateCnSummary(points: HeatmapPoint[]): string {
  const get = (name: string) => getLatest(points, name)
  const parts: string[] = []

  // Inflation
  const cpi = get('CPI')
  const ppi = get('PPI')
  const inflSens = [cpi, ppi].filter(Boolean) as IndicatorLatest[]
  if (inflSens.length) {
    const avg = inflSens.reduce((a, b) => a + b.zScore, 0) / inflSens.length
    const cl = classify(avg)
    parts.push(`通胀${labelCn(cl)}（CPI z=${cpi?.zScore.toFixed(1) ?? '--'}，PPI z=${ppi?.zScore.toFixed(1) ?? '--'}）`)
  }

  // Growth
  const gdp = get('GDP')
  const retail = get('社消零售')
  const pmi = get('PMI')
  const growthSens = [gdp, retail, pmi].filter(Boolean) as IndicatorLatest[]
  if (growthSens.length) {
    const avg = growthSens.reduce((a, b) => a + b.zScore, 0) / growthSens.length
    const cl = classify(avg)
    parts.push(`经济增长${labelCn(cl)}（GDP z=${gdp?.zScore.toFixed(1) ?? '--'}，零售 z=${retail?.zScore.toFixed(1) ?? '--'}，PMI z=${pmi?.zScore.toFixed(1) ?? '--'}）`)
  }

  // Rates
  const bond10y = get('10Y收益率')
  if (bond10y) {
    const cl = classify(bond10y.zScore)
    parts.push(`利率水平${labelCn(cl)}（10Y收益率 z=${bond10y.zScore.toFixed(1)}）`)
  }

  // Flows
  const north = get('北向资金')
  if (north) {
    const cl = classify(north.zScore)
    parts.push(`外资流向${labelCn(cl)}（北向资金 z=${north.zScore.toFixed(1)}）`)
  }

  // Reserves
  const fx = get('外汇储备')
  if (fx) {
    const cl = classify(fx.zScore)
    parts.push(`外汇储备${labelCn(cl)}（z=${fx.zScore.toFixed(1)}）`)
  }

  return parts.join('；')
}

function Summary({ text, color }: { text: string; color: string }) {
  if (!text) return null
  return (
    <div style={{
      marginTop: '12px', padding: '10px 14px',
      background: 'rgba(148,163,184,0.06)', borderRadius: '8px',
      border: `1px solid ${color}20`,
      fontSize: '12px', lineHeight: 1.7, color: THEME.textSecondary,
    }}>
      <span style={{ color: THEME.textMuted, fontWeight: 600 }}>综合研判：</span>
      {text}
    </div>
  )
}

export default function IndicatorHeatmapDashboard() {
  const [data, setData] = useState<ApiData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/v1/indicator-heatmap.json')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!json.success) throw new Error(json.error || '加载失败')
        if (!cancelled) setData(json.data)
      } catch (e: any) {
        if (!cancelled) setError(e.message || '网络错误')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const usCells = useMemo(() => data ? toCells(data.us) : [], [data])
  const cnCells = useMemo(() => data ? toCells(data.cn) : [], [data])
  const usSummary = useMemo(() => data ? generateUsSummary(data.us) : '', [data])
  const cnSummary = useMemo(() => data ? generateCnSummary(data.cn) : '', [data])

  if (loading) return <LoadingSkeleton type="card" height={600} />
  if (error) return <div style={{ padding: '14px 18px', borderRadius: '12px', background: THEME.redBg, color: THEME.red, fontSize: '13px', border: '1px solid rgba(242,54,69,0.2)' }}>⚠ {error}</div>
  if (!data) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ padding: '14px 18px', background: THEME.bgCard, borderRadius: '12px', border: `1px solid ${THEME.borderLight}`, fontSize: '13px', lineHeight: 1.7, color: THEME.textSecondary }}>
        <p style={{ margin: 0, fontWeight: 600, color: THEME.textPrimary }}>如何解读？</p>
        <p style={{ margin: '4px 0 0', fontSize: '12px' }}>
          每行是一个经济指标，每列是一个月份。颜色表示该指标当月值在自身历史中的位置：
        </p>
        <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '11px', alignItems: 'center' }}>
          <span><span style={{ color: THEME.green }}>■</span> 偏冷 (低于均值)</span>
          <span><span style={{ color: THEME.textMuted }}>■</span> 中性 (接近均值)</span>
          <span><span style={{ color: THEME.red }}>■</span> 偏热 (高于均值)</span>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: '11px', color: THEME.textMuted }}>
          颜色深浅 = 偏离程度（Z-Score：-3 ~ +3）。红色越深→经济越热，绿色越深→经济越冷。底部综合研判基于最新月份各指标 Z-Score 自动生成。
        </p>
      </div>

      <MacroCard title="美国宏观经济热力图" variant="elevated">
        <HeatmapMatrix data={usCells} min={-3} max={3} height={400} />
        <Summary text={usSummary} color={THEME.cyan} />
      </MacroCard>

      <MacroCard title="中国宏观经济热力图" variant="elevated">
        <HeatmapMatrix data={cnCells} min={-3} max={3} height={360} />
        <Summary text={cnSummary} color={THEME.red} />
      </MacroCard>
    </div>
  )
}

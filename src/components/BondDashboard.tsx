import { useEffect, useMemo, useState } from 'react'
import { TreasuryCurveChart } from './charts/TreasuryCurveChart'
import { MultiTenorTrendChart } from './charts/MultiTenorTrendChart'
import { CurveDynamicsChart } from './charts/CurveDynamicsChart'
import { MacroCard } from './ui/MacroCard'
import { LoadingSkeleton } from './ui/LoadingSkeleton'
import { THEME } from './ui/theme'

interface SeriesPoint {
  date: string
  value: number
}

interface BondSeries {
  code: string
  name_zh: string
  maturity: string
  latest: SeriesPoint | null
  previous: SeriesPoint | null
  change: number | null
  history: SeriesPoint[]
}

interface CurveShapeAssessment {
  shape: 'steepening' | 'flattening' | 'inverted' | 'normal'
  label: string
  description: string
  spread10y2y: number | null
  spreadPercentile1y: number | null
  spreadPercentile5y: number | null
}

interface RegionData {
  latestDate: string
  series: BondSeries[]
  curveShape?: CurveShapeAssessment | null
}

interface Props {
  data: RegionData
  region: 'US' | 'CN'
}

const MATURITY_ORDER = ['1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y']

function findSeries(region: RegionData, maturity: string): BondSeries | undefined {
  return region.series.find((s) => s.maturity === maturity)
}

function calcSpread(region: RegionData, shortMat: string, longMat: string): { value: number | null; change: number | null } {
  const short = findSeries(region, shortMat)
  const long = findSeries(region, longMat)
  if (!short?.latest || !long?.latest) return { value: null, change: null }
  const value = long.latest.value - short.latest.value
  const prev = short.previous && long.previous ? long.previous.value - short.previous.value : null
  const change = prev !== null ? value - prev : null
  return { value, change }
}

const SECTION_GAP = '20px'

function SpreadCard({ label, value, change }: { label: string; value: number | null; change: number | null }) {
  if (value == null) return null
  const isUp = (change || 0) >= 0
  return (
    <div style={{
      padding: '14px 18px', background: THEME.bgCard, borderRadius: '12px',
      border: `1px solid ${THEME.borderLight}`, display: 'flex', flexDirection: 'column', gap: '6px',
      flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: '11px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary, lineHeight: 1.2 }}>
        {value > 0 ? '+' : ''}{value.toFixed(2)}%
      </div>
      {change != null && (
        <div style={{
          fontSize: '12px', fontWeight: 700, fontFamily: THEME.fontMono,
          color: isUp ? THEME.green : THEME.red,
        }}>
          {isUp ? '↑' : '↓'} {Math.abs(change).toFixed(2)}bp
        </div>
      )}
    </div>
  )
}

function CurveShapeBadge({ shape }: { shape?: CurveShapeAssessment | null }) {
  if (!shape) return null
  const colorMap: Record<string, string> = {
    inverted: THEME.red,
    steepening: THEME.gold,
    flattening: THEME.cyan,
    normal: THEME.green,
  }
  const bgMap: Record<string, string> = {
    inverted: 'rgba(242,54,69,0.12)',
    steepening: 'rgba(245,158,11,0.12)',
    flattening: 'rgba(6,182,212,0.12)',
    normal: 'rgba(8,153,129,0.12)',
  }
  const color = colorMap[shape.shape] || THEME.textSecondary
  return (
    <span style={{
      fontSize: '11px',
      padding: '4px 10px',
      borderRadius: '8px',
      background: bgMap[shape.shape] || THEME.blueDim,
      color,
      fontFamily: THEME.fontMono,
      letterSpacing: '0.04em',
      fontWeight: 600,
      border: `1px solid ${color}40`,
    }}>
      {shape.label}
    </span>
  )
}

function CurveDynamicsSection({ region }: { region: 'US' | 'CN' }) {
  const [history, setHistory] = useState<any[] | null>(null)
  const [meta, setMeta] = useState<{
    latest: any
    percentiles: any
    latestRmse: number | null
    lambda: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/v1/bonds/curve-dynamics.json?region=${region}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!json.success) throw new Error(json.error || '加载失败')
        if (!cancelled) {
          setHistory(json.data.history || [])
          setMeta({
            latest: json.data.latest,
            percentiles: json.data.percentiles,
            latestRmse: json.data.latestRmse,
            lambda: json.data.lambda,
          })
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || '网络错误')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [region])

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: SECTION_GAP }}>
        <LoadingSkeleton type="chart" height={340} />
        <LoadingSkeleton type="card" height={340} />
      </div>
    )
  }
  if (error) {
    return (
      <div style={{
        padding: '14px 18px', borderRadius: '12px',
        background: THEME.redBg, color: THEME.red, fontSize: '13px',
        border: `1px solid rgba(242,54,69,0.2)`,
      }}>
        ⚠️ {error}
      </div>
    )
  }
  if (!history || history.length === 0 || !meta?.latest) return null

  const factors = [
    { key: 'level', label: '水平 (Level β₀)', desc: '反映长期利率水平，受长期通胀预期与中性利率影响', color: THEME.blue },
    { key: 'slope', label: '斜率 (Slope β₁)', desc: '短端减长端的利差，负值代表曲线倒挂', color: THEME.gold },
    { key: 'curvature', label: '曲率 (Curvature β₂)', desc: '中期凸起程度，反映曲线弯曲方向', color: THEME.cyan },
  ] as const

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: SECTION_GAP, alignItems: 'start' }}>
      <MacroCard title="Nelson-Siegel 三因子分解 (近 250 交易日)" variant="elevated">
        <CurveDynamicsChart history={history} height={340} />
        <div style={{ marginTop: '10px', fontSize: '11px', color: THEME.textMuted, fontFamily: THEME.fontMono }}>
          &lambda; = {meta.lambda} &nbsp;&middot;&nbsp; 拟合 RMSE = {meta.latestRmse?.toFixed(4) ?? '--'}
        </div>
      </MacroCard>

      <MacroCard title="当前因子水平 & 历史分位" variant="elevated">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {factors.map((f) => {
            const v = (meta.latest as any)[f.key] as number | null
            const p = (meta.percentiles as any)[f.key] as number | null
            return (
              <div key={f.key} style={{
                padding: '14px 16px',
                background: THEME.bgElevated,
                borderRadius: '12px',
                border: `1px solid ${THEME.borderLight}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                  <span style={{ fontSize: '13px', color: THEME.textSecondary, fontWeight: 600 }}>{f.label}</span>
                  <span style={{ fontSize: '20px', fontWeight: 700, fontFamily: THEME.fontMono, color: f.color }}>
                    {v == null ? '--' : v.toFixed(3)}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: THEME.textMuted, marginBottom: '10px', lineHeight: 1.5 }}>
                  {f.desc}
                </div>
                {p != null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '10px', color: THEME.textMuted, fontWeight: 600 }}>分位</span>
                    <div style={{ flex: 1, height: '6px', background: THEME.borderColor, borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(100, Math.max(0, p))}%`,
                        height: '100%',
                        background: f.color,
                        borderRadius: '3px',
                      }} />
                    </div>
                    <span style={{ fontSize: '12px', fontFamily: THEME.fontMono, color: f.color, fontWeight: 700, minWidth: '40px', textAlign: 'right' }}>
                      {p.toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </MacroCard>
    </div>
  )
}

export default function BondDashboard({ data: regionData, region }: Props) {
  const tenYear = useMemo(() => findSeries(regionData, '10Y'), [regionData])

  const curveSeries = useMemo(() => {
    const latest: { maturity: string; yield: number }[] = []
    const previous: { maturity: string; yield: number }[] = []
    regionData.series.forEach((s) => {
      if (s.latest) latest.push({ maturity: s.maturity, yield: s.latest.value })
      if (s.previous) previous.push({ maturity: s.maturity, yield: s.previous.value })
    })
    latest.sort((a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity))
    previous.sort((a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity))
    const out = []
    if (latest.length) out.push({ date: regionData.latestDate || '最新', points: latest })
    if (previous.length) out.push({ date: previous[0]?.maturity ? '上一交易日' : '前期', points: previous })
    return out
  }, [regionData])

  const spreads = useMemo(() => {
    if (region === 'US') {
      return {
        '2Y-10Y': calcSpread(regionData, '2Y', '10Y'),
        '10Y-30Y': calcSpread(regionData, '10Y', '30Y'),
        '3M-10Y': calcSpread(regionData, '3M', '10Y'),
      }
    }
    return {
      '2Y-10Y': calcSpread(regionData, '2Y', '10Y'),
      '10Y-30Y': calcSpread(regionData, '10Y', '30Y'),
    }
  }, [regionData, region])

  // Hero 区快览的关键期限（除 10Y 外，因为 10Y 是主数字）
  const heroTenors = useMemo(() => {
    const keys = region === 'US' ? ['2Y', '5Y', '30Y'] : ['2Y', '5Y', '30Y']
    return keys.map((m) => findSeries(regionData, m)).filter(Boolean) as BondSeries[]
  }, [regionData, region])

  const shape = regionData.curveShape

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SECTION_GAP }}>
      {/* ===== 第一行：Hero + 收益率曲线 ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: SECTION_GAP, alignItems: 'stretch' }}>
        <MacroCard title={`${region === 'US' ? '美国' : '中国'}10年期国债收益率`} variant="elevated">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
            {/* 10Y 大数字 */}
            <div>
              <div style={{ fontSize: '11px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', fontWeight: 600 }}>
                最新值 &middot; {regionData.latestDate || '--'}
              </div>
              <div style={{ fontSize: '44px', fontWeight: 800, fontFamily: THEME.fontMono, color: THEME.textPrimary, lineHeight: 1.1 }}>
                {tenYear?.latest ? tenYear.latest.value.toFixed(3) : '--'}<span style={{ fontSize: '24px' }}>%</span>
              </div>
            </div>
            {/* 日变动标签 */}
            {tenYear?.change != null && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 14px',
                borderRadius: '8px', alignSelf: 'flex-start', fontSize: '14px', fontWeight: 700, fontFamily: THEME.fontMono,
                color: tenYear.change >= 0 ? THEME.green : THEME.red,
                background: tenYear.change >= 0 ? 'rgba(8,153,129,0.12)' : 'rgba(242,54,69,0.12)',
              }}>
                {tenYear.change >= 0 ? '↑' : '↓'} {Math.abs(tenYear.change * 100).toFixed(1)} bp
              </div>
            )}

            {/* 其他关键期限快览 */}
            {heroTenors.length > 0 && (
              <>
                <div style={{
                  height: '1px', background: THEME.borderLight, margin: '4px 0',
                }} />
                <div style={{
                  display: 'grid', gridTemplateColumns: `repeat(${heroTenors.length}, 1fr)`,
                  gap: '10px',
                }}>
                  {heroTenors.map((s) => {
                    const isUp = (s.change || 0) >= 0
                    return (
                      <div key={s.maturity} style={{
                        padding: '10px 12px', background: THEME.bgElevated, borderRadius: '10px',
                        border: `1px solid ${THEME.borderLight}`, display: 'flex', flexDirection: 'column', gap: '3px',
                      }}>
                        <span style={{ fontSize: '11px', color: THEME.textMuted, fontFamily: THEME.fontMono, fontWeight: 600 }}>{s.maturity}</span>
                        <span style={{ fontSize: '17px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary, lineHeight: 1.2 }}>
                          {s.latest ? s.latest.value.toFixed(3) : '--'}%
                        </span>
                        {s.change != null && (
                          <span style={{
                            fontSize: '11px', fontFamily: THEME.fontMono, fontWeight: 700,
                            color: isUp ? THEME.green : THEME.red,
                          }}>
                            {isUp ? '+' : ''}{(s.change * 100).toFixed(1)}bp
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* 数据来源 */}
            <div style={{ fontSize: '11px', color: THEME.textMuted, marginTop: 'auto', paddingTop: '6px', borderTop: `1px solid ${THEME.borderLight}` }}>
              来源: {region === 'US' ? 'FRED / 美国财政部' : '中债登 / akshare'}
            </div>
          </div>
        </MacroCard>

        <MacroCard
          title="收益率曲线"
          variant="elevated"
          badge={shape ? <CurveShapeBadge shape={shape} /> : undefined}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
            <div style={{ flex: 1 }}>
              <TreasuryCurveChart series={curveSeries} height={280} />
            </div>
            {shape && (
              <div style={{ padding: '10px 14px', background: THEME.bgElevated, borderRadius: '10px', fontSize: '12px', color: THEME.textSecondary, lineHeight: 1.6, border: `1px solid ${THEME.borderLight}` }}>
                <strong style={{ color: THEME.textPrimary }}>{shape.label}</strong> &middot; {shape.description}
                {shape.spread10y2y != null && (
                  <span style={{ marginLeft: '10px', fontFamily: THEME.fontMono, color: shape.spread10y2y >= 0 ? THEME.green : THEME.red, fontWeight: 600 }}>
                    10Y-2Y = {(shape.spread10y2y * 100).toFixed(1)}bp
                  </span>
                )}
                {shape.spreadPercentile1y != null && (
                  <span style={{ marginLeft: '10px', color: THEME.textMuted }}>
                    1Y分位 {shape.spreadPercentile1y.toFixed(0)}%
                  </span>
                )}
              </div>
            )}
          </div>
        </MacroCard>
      </div>

      {/* ===== 第二行：期限利差卡片 ===== */}
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
        {Object.entries(spreads).map(([label, s]) => (
          <SpreadCard key={label} label={label} value={s.value} change={s.change} />
        ))}
      </div>

      {/* ===== 第三行：多期限走势图 + 各期限表格 ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: SECTION_GAP, alignItems: 'start' }}>
        <MacroCard
          title={`${region === 'US' ? '美国' : '中国'}国债收益率走势（多期限对比）`}
          variant="elevated"
          badge={<span style={{ fontSize: '11px', color: THEME.textMuted, fontFamily: THEME.fontMono }}>点击下方按钮切换期限</span>}
        >
          <MultiTenorTrendChart series={regionData.series} height={360} />
        </MacroCard>

        <MacroCard title="各期限收益率一览" variant="elevated">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.borderColor}` }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', color: THEME.textMuted, fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>期限</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', color: THEME.textMuted, fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>收益率</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', color: THEME.textMuted, fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>日变动</th>
                </tr>
              </thead>
              <tbody>
                {regionData.series.map((s) => {
                  const change = s.change
                  const isUp = (change || 0) >= 0
                  return (
                    <tr key={s.maturity} style={{ borderBottom: `1px solid ${THEME.borderLight}` }}>
                      <td style={{ padding: '10px 12px', color: THEME.textPrimary, fontFamily: THEME.fontMono, fontWeight: 600 }}>{s.maturity}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: THEME.textPrimary, fontFamily: THEME.fontMono, fontWeight: 700 }}>
                        {s.latest ? s.latest.value.toFixed(3) + '%' : '--'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: THEME.fontMono, fontWeight: 700, color: isUp ? THEME.green : THEME.red }}>
                        {change != null ? (isUp ? '+' : '') + (change * 100).toFixed(1) + 'bp' : '--'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </MacroCard>
      </div>

      {/* ===== 第四行：Nelson-Siegel 三因子分解 ===== */}
      <CurveDynamicsSection region={region} />
    </div>
  )
}

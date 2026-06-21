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
      padding: '18px 20px', background: THEME.bgCard, borderRadius: '14px',
      border: `1px solid ${THEME.borderLight}`, display: 'flex', flexDirection: 'column',
      alignItems: 'center', textAlign: 'center', gap: '8px', minWidth: 0,
    }}>
      <div style={{ fontSize: '11px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 800, fontFamily: THEME.fontMono, color: THEME.textPrimary, lineHeight: 1.1 }}>
        {value > 0 ? '+' : ''}{value.toFixed(2)}%
      </div>
      {change != null && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '3px',
          padding: '2px 8px', borderRadius: '6px',
          fontSize: '12px', fontWeight: 700, fontFamily: THEME.fontMono,
          color: isUp ? THEME.green : THEME.red,
          background: isUp ? THEME.greenBg : THEME.redBg,
        }}>
          {isUp ? '↑' : '↓'} {Math.abs(change * 100).toFixed(1)}bp
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

// ── Curve Shape 说明条 ──
function CurveShapeSummary({ shape }: { shape?: CurveShapeAssessment | null }) {
  if (!shape) return null
  const colorMap: Record<string, string> = {
    inverted: THEME.red,
    steepening: THEME.gold,
    flattening: THEME.cyan,
    normal: THEME.green,
  }
  const color = colorMap[shape.shape] || THEME.textSecondary
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
      padding: '12px 16px', marginTop: '12px',
      background: 'rgba(255,255,255,0.02)', borderRadius: '8px',
      border: `1px solid ${THEME.borderLight}`,
      fontSize: '12px', lineHeight: 1.5,
    }}>
      <CurveShapeBadge shape={shape} />
      <span style={{ color: THEME.textSecondary }}>{shape.description}</span>
      {shape.spread10y2y != null && (
        <span style={{ fontFamily: THEME.fontMono, color: shape.spread10y2y >= 0 ? THEME.green : THEME.red, fontWeight: 600 }}>
          10Y-2Y = {(shape.spread10y2y * 100).toFixed(1)}bp
        </span>
      )}
      {shape.spreadPercentile1y != null && (
        <span style={{ color: THEME.textMuted }}>
          1Y分位 {shape.spreadPercentile1y.toFixed(0)}%
        </span>
      )}
    </div>
  )
}

function DailyBondSummary({
  region, tenYear, shape, spreads, latestDate,
}: {
  region: 'US' | 'CN'
  tenYear: BondSeries | undefined
  shape: CurveShapeAssessment | null | undefined
  spreads: Record<string, { value: number | null; change: number | null }>
  latestDate: string
}) {
  const spread10y2y = spreads['2Y-10Y']
  const summaryItems: string[] = []
  if (tenYear?.latest) {
    summaryItems.push(`${region === 'US' ? '美国' : '中国'}10年期国债收益率当前报 ${tenYear.latest.value.toFixed(3)}%`)
  }
  if (tenYear?.change != null) {
    summaryItems.push(`日间${tenYear.change >= 0 ? '上行' : '下行'} ${Math.abs(tenYear.change * 100).toFixed(1)}bp`)
  }
  if (shape) {
    summaryItems.push(`收益率曲线形态：${shape.description}`)
  }
  if (spread10y2y?.value != null) {
    summaryItems.push(`2Y-10Y 利差 ${spread10y2y.value >= 0 ? '+' : ''}${(spread10y2y.value * 100).toFixed(1)}bp（${spread10y2y.value >= 0 ? '正常' : '倒挂'}）`)
  }

  return (
    <div style={{
      padding: '18px 20px', background: THEME.bgElevated, borderRadius: '14px',
      border: `1px solid ${THEME.borderLight}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={THEME.cyan} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: THEME.fontDisplay, letterSpacing: '0.03em', color: THEME.textPrimary }}>
          今日债市 · {latestDate}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.7, color: THEME.textSecondary }}>
        {summaryItems.join('；')}。
      </p>
    </div>
  )
}

const BOND_EDUCATION_OPEN = true

function BondEducation({ region }: { region: 'US' | 'CN' }) {
  const title = region === 'US' ? '美国国债' : '中国国债'
  const [open, setOpen] = useState(BOND_EDUCATION_OPEN)

  return (
    <div style={{
      borderRadius: '14px', border: `1px solid ${THEME.borderLight}`,
      background: THEME.bgCard, overflow: 'hidden',
    }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '14px 18px', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={THEME.cyan} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <span style={{ flex: 1, fontSize: '13px', fontWeight: 700, fontFamily: THEME.fontDisplay, letterSpacing: '0.03em', color: THEME.textPrimary }}>
          {title}收益率 · 一图读懂
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={THEME.textMuted} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      {open && (
        <div style={{ padding: '0 18px 16px', fontSize: '13px', lineHeight: 1.7, color: THEME.textSecondary }}>
          <p style={{ margin: '0 0 14px 0' }}>
            <span style={{ color: THEME.textPrimary, fontWeight: 700 }}>{title}</span>
            是{region === 'US' ? '美国联邦政府' : '中国中央政府'}为筹集财政资金而发行的债券，以国家信用为担保，被公认为全球最安全的资产之一。其<strong>收益率（利率）</strong>不仅是政府的借钱成本，更是全球金融市场的"定海神针"——所有资产的定价都或多或少参考它。
          </p>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px',
          }}>
            {/* 利率上行 */}
            <div style={{ borderRadius: '10px', border: `1px solid ${THEME.borderLight}`, background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
              <div style={{
                padding: '10px 14px', fontSize: '12px', fontWeight: 700, fontFamily: THEME.fontDisplay, letterSpacing: '0.04em',
                color: THEME.red, background: 'rgba(242,54,69,0.06)', borderBottom: '1px solid rgba(242,54,69,0.15)',
              }}>
                📈 利率上行
              </div>
              <div style={{ padding: '10px 14px' }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: THEME.textMuted, marginBottom: '4px' }}>触发因素：</div>
                <ul style={{ margin: '6px 0 12px 0', paddingLeft: '18px' }}>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>经济过热、通胀高企</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>央行加息（FOMC / 人行）</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>国债供给大增（财政赤字扩大）</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>全球避险情绪降温，资金从债市流出</li>
                </ul>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: THEME.textMuted, marginBottom: '4px' }}>市场影响：</div>
                <ul style={{ margin: '6px 0 0 0', paddingLeft: '18px' }}>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>债市价格下跌，债券持有人亏损</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>股市估值承压（贴现率上升）</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>房贷、企业融资成本上升</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>美元/人民币走强（利差吸引）</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>黄金吸引力下降（持有成本增加）</li>
                </ul>
              </div>
            </div>

            {/* 利率下行 */}
            <div style={{ borderRadius: '10px', border: `1px solid ${THEME.borderLight}`, background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
              <div style={{
                padding: '10px 14px', fontSize: '12px', fontWeight: 700, fontFamily: THEME.fontDisplay, letterSpacing: '0.04em',
                color: THEME.green, background: 'rgba(8,153,129,0.06)', borderBottom: '1px solid rgba(8,153,129,0.15)',
              }}>
                📉 利率下行
              </div>
              <div style={{ padding: '10px 14px' }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: THEME.textMuted, marginBottom: '4px' }}>触发因素：</div>
                <ul style={{ margin: '6px 0 12px 0', paddingLeft: '18px' }}>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>经济放缓、衰退风险</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>央行降息 / 宽松政策</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>通胀回落、通缩压力</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>避险资金涌入（地缘危机 / 金融危机）</li>
                </ul>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: THEME.textMuted, marginBottom: '4px' }}>市场影响：</div>
                <ul style={{ margin: '6px 0 0 0', paddingLeft: '18px' }}>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>债市价格上涨，债券持有人盈利</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>股市估值修复，成长风格受益</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>房贷、企业融资成本下降</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>美元/人民币走弱</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>黄金等避险资产受追捧</li>
                </ul>
              </div>
            </div>

            {/* 利差说明 */}
            <div style={{ gridColumn: 'span 2', borderRadius: '10px', border: `1px solid ${THEME.borderLight}`, background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
              <div style={{
                padding: '10px 14px', fontSize: '12px', fontWeight: 700, fontFamily: THEME.fontDisplay, letterSpacing: '0.04em',
                color: THEME.cyan, background: 'rgba(6,182,212,0.06)', borderBottom: '1px solid rgba(6,182,212,0.15)',
              }}>
                📊 利差（期限利差）
              </div>
              <div style={{ padding: '10px 14px' }}>
                <p style={{ margin: '0 0 10px 0', fontSize: '12.5px', lineHeight: 1.6 }}>
                  <span style={{ color: THEME.textPrimary, fontWeight: 700 }}>期限利差</span> = 长期国债收益率 − 短期国债收益率（如 10Y-2Y），是债券市场最重要的信号之一。
                </p>
                <ul style={{ margin: '0 0 10px 0', paddingLeft: '18px' }}>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>
                    <span style={{ color: THEME.green, fontWeight: 700 }}>利差为正（曲线正常）</span>：长端利率高于短端，反映市场预期经济正常增长、通胀合理。利差越大，说明市场对未来经济越乐观。
                  </li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>
                    <span style={{ color: THEME.red, fontWeight: 700 }}>利差倒挂（曲线倒挂）</span>：短端利率高于长端，是历史上最精准的衰退预警信号之一。逻辑：市场预期未来经济走弱、央行会降息，所以长端利率反而低于短端。
                  </li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>
                    <span style={{ color: THEME.textPrimary, fontWeight: 600 }}>利差收窄 / 平坦化</span>：市场对未来增长趋于谨慎，货币政策可能面临转折。
                  </li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>
                    <span style={{ color: THEME.textPrimary, fontWeight: 600 }}>利差走阔 / 陡峭化</span>：通常出现在降息周期初期——短端利率快速下降（央行降息），长端利率还在反映通胀预期，二者差距拉大。
                  </li>
                </ul>
                <div style={{
                  marginTop: '10px', padding: '10px 14px', borderRadius: '8px',
                  background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.15)',
                  fontSize: '12px', lineHeight: 1.6,
                }}>
                  📌 自 1970 年代以来，美国历次经济衰退之前几乎都出现了 10Y-2Y 收益率曲线倒挂，是公认的最可靠领先指标之一。
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
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
    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: SECTION_GAP, alignItems: 'stretch' }}>
      <MacroCard title="Nelson-Siegel 三因子分解 (近 250 交易日)" variant="elevated">
        <CurveDynamicsChart history={history} height={340} />
        <div style={{ marginTop: '10px', fontSize: '11px', color: THEME.textMuted, fontFamily: THEME.fontMono }}>
          &lambda; = {meta.lambda} &nbsp;&middot;&nbsp; 拟合 RMSE = {meta.latestRmse?.toFixed(4) ?? '--'}
        </div>
      </MacroCard>

      <MacroCard title="当前因子水平 & 历史分位" variant="elevated">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
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
      <DailyBondSummary region={region} tenYear={tenYear} shape={shape} spreads={spreads} latestDate={regionData.latestDate} />

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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <MacroCard title="收益率曲线" variant="elevated">
            <TreasuryCurveChart series={curveSeries} height={280} />
            <CurveShapeSummary shape={shape} />
          </MacroCard>
        </div>
      </div>

      {/* ===== 第二行：期限利差卡片 ===== */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${region === 'US' ? 3 : 2}, 1fr)`,
        gap: '16px',
      }}>
        {Object.entries(spreads).map(([label, s]) => (
          <SpreadCard key={label} label={label} value={s.value} change={s.change} />
        ))}
      </div>

      {/* ===== 第三行：多期限走势图 + 各期限表格 ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: SECTION_GAP, alignItems: 'stretch' }}>
        <MacroCard
          title={`${region === 'US' ? '美国' : '中国'}国债收益率走势（多期限对比）`}
          variant="elevated"
          badge={<span style={{ fontSize: '11px', color: THEME.textMuted, fontFamily: THEME.fontMono }}>点击下方按钮切换期限</span>}
        >
          <MultiTenorTrendChart series={regionData.series} height={360} />
        </MacroCard>

        <MacroCard title="各期限收益率一览" variant="elevated">
          <div style={{ overflow: 'auto', flex: 1 }}>
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
                    <tr
                      key={s.maturity}
                      style={{
                        borderBottom: `1px solid ${THEME.borderLight}`,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(59,130,246,0.06)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
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

      {/* ===== 科普 ===== */}
      <BondEducation region={region} />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { fetchApi } from '../../lib/api'
import { MacroCard } from '../ui/MacroCard'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { THEME } from '../ui/theme'

interface RegimeSignal {
  name: string
  value: number | string
  score: -1 | 0 | 1
  detail?: string
}

interface RegimeData {
  regime: string
  label: string
  confidence: number
  signals: RegimeSignal[]
  updatedAt: string
}

const REGIME_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  GOLDILOCKS: { label: '金发女孩', color: '#089981', bg: 'rgba(8,153,129,0.12)' },
  RISK_ON: { label: '风险偏好', color: THEME.blue, bg: THEME.blueDim },
  OVERHEAT: { label: '过热', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  STAGFLATION: { label: '滞胀', color: THEME.red, bg: THEME.redBg },
  RISK_OFF: { label: '风险规避', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
  RECOVERY: { label: '复苏', color: THEME.cyan, bg: THEME.cyanDim },
  UNKNOWN: { label: '不确定', color: THEME.textMuted, bg: THEME.bgCard },
}

export default function MarketRegimePanel() {
  const [data, setData] = useState<RegimeData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchApi<RegimeData>('/regime').then(r => {
      if (!cancelled) { setData(r); setLoading(false) }
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading || !data) return <LoadingSkeleton type="card" rows={5} />

  const rs = REGIME_STYLES[data.regime] || REGIME_STYLES.UNKNOWN
  const goodCount = data.signals.filter(s => s.score === 1).length
  const badCount = data.signals.filter(s => s.score === -1).length

  return (
    <MacroCard title="市场制式识别" badge={data.label}>
      <div style={{
        padding: '20px', textAlign: 'center',
        background: rs.bg, borderRadius: '12px', border: `1px solid ${rs.color}30`,
        marginBottom: '16px',
      }}>
        <div style={{ fontSize: '11px', color: THEME.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '4px' }}>当前状态</div>
        <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: THEME.fontDisplay, letterSpacing: '0.06em', color: rs.color }}>{data.regime}</div>
        <div style={{ fontSize: '13px', color: rs.color, marginTop: '4px', fontWeight: 500 }}>{data.label}</div>
        <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: THEME.green, background: THEME.greenBg, padding: '2px 8px', borderRadius: '4px' }}>积极 {goodCount}</span>
          <span style={{ fontSize: '12px', color: THEME.textMuted, background: THEME.bgCard, padding: '2px 8px', borderRadius: '4px' }}>中性 {data.signals.length - goodCount - badCount}</span>
          <span style={{ fontSize: '12px', color: THEME.red, background: THEME.redBg, padding: '2px 8px', borderRadius: '4px' }}>风险 {badCount}</span>
        </div>
        <div style={{ marginTop: '12px' }}>
          <div style={{ height: '6px', background: THEME.borderColor, borderRadius: '3px', overflow: 'hidden', maxWidth: '200px', margin: '0 auto' }}>
            <div style={{
              height: '100%', width: `${data.confidence}%`,
              background: `linear-gradient(90deg, ${THEME.red}, ${THEME.gold}, ${THEME.green})`,
              borderRadius: '3px', transition: 'width 0.6s ease',
            }} />
          </div>
          <div style={{ fontSize: '10px', color: THEME.textMuted, marginTop: '4px', fontFamily: THEME.fontMono }}>置信度 {data.confidence}%</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>信号明细 ({data.signals.length})</div>
        {data.signals.map(s => {
          const dotColor = s.score === 1 ? THEME.green : s.score === -1 ? THEME.red : THEME.textMuted
          return (
            <div key={s.name} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '6px 10px', background: THEME.bgCard, borderRadius: '6px',
              border: `1px solid ${THEME.borderLight}`,
            }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: THEME.textSecondary, width: '100px', flexShrink: 0 }}>{s.name}</span>
              <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary, width: '80px', textAlign: 'right' }}>{s.value}</span>
              <span style={{ fontSize: '11px', color: THEME.textMuted, flex: 1, textAlign: 'right' }}>{s.detail || ''}</span>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: '12px', fontSize: '10px', color: THEME.textMuted, textAlign: 'right', fontFamily: THEME.fontMono }}>
        更新: {data.updatedAt}
      </div>
    </MacroCard>
  )
}

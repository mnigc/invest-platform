import { useEffect, useState } from 'react'
import { fetchApi } from '../../lib/api'
import { MacroCard } from '../ui/MacroCard'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'

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

function getRegimeStyles(): Record<string, { label: string; color: string; bg: string }> {
  return {
    GOLDILOCKS: { label: '金发女孩', color: 'var(--green)', bg: 'var(--green-bg)' },
    RISK_ON: { label: '风险偏好', color: 'var(--accent-blue)', bg: 'var(--accent-blue-dim)' },
    OVERHEAT: { label: '过热', color: 'var(--accent-gold)', bg: 'var(--accent-gold-dim)' },
    STAGFLATION: { label: '滞胀', color: 'var(--red)', bg: 'var(--red-bg)' },
    RISK_OFF: { label: '风险规避', color: 'var(--red)', bg: 'var(--red-bg)' },
    RECOVERY: { label: '复苏', color: 'var(--accent-cyan)', bg: 'var(--accent-cyan-dim)' },
    UNKNOWN: { label: '不确定', color: 'var(--text-muted)', bg: 'var(--bg-card)' },
  }
}

export default function MarketRegimePanel() {
  const [data, setData] = useState<RegimeData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchApi<RegimeData>('/regime.json').then(r => {
      if (!cancelled) { setData(r); setLoading(false) }
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading || !data) return <LoadingSkeleton type="card" rows={5} />

  const rs = getRegimeStyles()[data.regime] || getRegimeStyles().UNKNOWN
  const goodCount = data.signals.filter(s => s.score === 1).length
  const badCount = data.signals.filter(s => s.score === -1).length

  return (
    <MacroCard title="市场制式识别" badge={data.label}>
      <div style={{
        padding: '20px', textAlign: 'center',
        background: rs.bg, borderRadius: '12px', border: `1px solid ${rs.color}30`,
        marginBottom: '16px',
      }}>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '4px' }}>当前状态</div>
        <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '0.06em', color: rs.color }}>{data.regime}</div>
        <div style={{ fontSize: '13px', color: rs.color, marginTop: '4px', fontWeight: 500 }}>{data.label}</div>
        <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: 'var(--green)', background: 'var(--green-bg)', padding: '2px 8px', borderRadius: '4px' }}>积极 {goodCount}</span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-card)', padding: '2px 8px', borderRadius: '4px' }}>中性 {data.signals.length - goodCount - badCount}</span>
          <span style={{ fontSize: '12px', color: 'var(--red)', background: 'var(--red-bg)', padding: '2px 8px', borderRadius: '4px' }}>风险 {badCount}</span>
        </div>
        <div style={{ marginTop: '12px' }}>
          <div style={{ height: '6px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden', maxWidth: '200px', margin: '0 auto' }}>
            <div style={{
              height: '100%', width: `${data.confidence}%`,
              background: `linear-gradient(90deg, var(--red), var(--accent-gold), var(--green))`,
              borderRadius: '3px', transition: 'width 0.6s ease',
            }} />
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>置信度 {data.confidence}%</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>信号明细 ({data.signals.length})</div>
        {data.signals.map(s => {
          const dotColor = s.score === 1 ? 'var(--green)' : s.score === -1 ? 'var(--red)' : 'var(--text-muted)'
          return (
            <div key={s.name} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '6px 10px', background: 'var(--bg-card)', borderRadius: '6px',
              border: `1px solid var(--border-light)`,
            }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', width: '100px', flexShrink: 0 }}>{s.name}</span>
              <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', width: '80px', textAlign: 'right' }}>{s.value}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', flex: 1, textAlign: 'right' }}>{s.detail || ''}</span>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: '12px', fontSize: '10px', color: 'var(--text-muted)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        更新: {data.updatedAt}
      </div>
    </MacroCard>
  )
}

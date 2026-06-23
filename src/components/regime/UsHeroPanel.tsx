import { useEffect, useState } from 'react'
import { fetchApi } from '../../lib/api'
import { MacroCard } from '../ui/MacroCard'

interface CoreIndex { name: string; code: string; value: number; change: number }
interface RegimeSignal { name: string; value: number | string; score: -1 | 0 | 1; detail?: string }

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

const FALLBACK_INDICES: CoreIndex[] = [
  { name: 'S&P 500', code: 'SPX', value: 5487.03, change: 0.25 },
  { name: 'NASDAQ 100', code: 'NDX', value: 19685.42, change: 0.68 },
  { name: 'Dow Jones', code: 'DJI', value: 38920.35, change: -0.12 },
  { name: 'Russell 2000', code: 'RUT', value: 2042.18, change: -0.45 },
  { name: '费城半导体', code: 'SOX', value: 5320.18, change: 1.25 },
  { name: 'VIX 波动率', code: 'VIX', value: 14.32, change: -2.15 },
  { name: '10Y 美债收益率', code: 'US10Y', value: 4.25, change: 0.08 },
  { name: '2Y 美债收益率', code: 'US2Y', value: 4.68, change: -0.03 },
]

export default function UsHeroPanel({ indices }: { indices?: CoreIndex[] | null }) {
  const [regime, setRegime] = useState<{ regime: string; label: string; confidence: number; signals: RegimeSignal[] } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchApi<any>('/regime.json').then(r => {
      if (!cancelled) { setRegime(r); setLoading(false) }
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const apiIndices = indices && indices.length > 0
    ? indices.map((d: any) => ({
        name: d.name,
        code: d.symbol?.replace('^', '') || '',
        value: d.price,
        change: d.change,
      }))
    : []

  const filledIndices: CoreIndex[] = [...apiIndices]
  for (const fb of FALLBACK_INDICES) {
    if (!apiIndices.some((a) => a.code === fb.code)) {
      filledIndices.push(fb)
    }
  }

  const finalIndices = filledIndices.length > 0 ? filledIndices : FALLBACK_INDICES

  const rs = regime ? getRegimeStyles()[regime.regime] || getRegimeStyles().UNKNOWN : getRegimeStyles().UNKNOWN
  const goodCount = regime ? regime.signals.filter((s: RegimeSignal) => s.score === 1).length : 0
  const badCount = regime ? regime.signals.filter((s: RegimeSignal) => s.score === -1).length : 0
  const neutralCount = regime ? regime.signals.length - goodCount - badCount : 0

  return (
    <MacroCard title="市场总览" badge={regime?.regime || '加载中'} variant="elevated">
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '20px', alignItems: 'start' }}>
        <div style={{
          padding: '14px 16px', background: rs.bg, borderRadius: '12px',
          border: `1px solid var(--border-light)`, minHeight: '100%',
        }}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '2px' }}>当前市场制式</div>
          <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '0.04em', color: rs.color, lineHeight: 1.2 }}>
            {regime?.regime || '...'}
          </div>
          <div style={{ fontSize: '11px', color: rs.color, marginTop: '2px', fontWeight: 500 }}>
            {regime?.label || ''}
          </div>

          <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', color: 'var(--green)', background: 'var(--green-bg)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>积极 {goodCount}</span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-card)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>中性 {neutralCount}</span>
            <span style={{ fontSize: '11px', color: 'var(--red)', background: 'var(--red-bg)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>风险 {badCount}</span>
          </div>

          <div style={{ marginTop: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>识别置信度</span>
              <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{regime?.confidence || 0}%</span>
            </div>
            <div style={{ height: '5px', background: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${regime?.confidence || 0}%`,
                background: `linear-gradient(90deg, var(--red), var(--accent-cyan), var(--green))`,
                borderRadius: '2px', transition: 'width 0.6s ease',
              }} />
            </div>
          </div>

          {regime && regime.signals.length > 0 && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {regime.signals.slice(0, 6).map((s: RegimeSignal) => {
                const dotColor = s.score === 1 ? 'var(--green)' : s.score === -1 ? 'var(--red)' : 'var(--text-muted)'
                return (
                  <div key={s.name} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '5px 8px', background: 'var(--bg-card)', borderRadius: '6px',
                    border: `1px solid var(--border-light)`,
                  }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', flexShrink: 0 }}>{s.value}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>核心指数 · 最近交易日</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
            {finalIndices.map(idx => {
              const isUp = idx.change >= 0
              return (
                <div key={idx.code} style={{
                  padding: '12px 10px', background: 'var(--bg-card)', borderRadius: '10px',
                  border: `1px solid var(--border-light)`, display: 'flex', flexDirection: 'column', gap: '6px',
                  transition: 'all 0.2s',
                }}>
                  <div style={{ marginBottom: '2px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{idx.code}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>{idx.name}</div>
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', lineHeight: 1.2 }}>
                    {typeof idx.value === 'number' ? idx.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                  </div>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: '2px',
                    fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono)',
                    color: isUp ? 'var(--green)' : 'var(--red)',
                    padding: '2px 6px', borderRadius: '4px', alignSelf: 'flex-start',
                    background: isUp ? 'var(--green-bg)' : 'var(--red-bg)',
                  }}>
                    {isUp ? '↑' : '↓'} {Math.abs(idx.change).toFixed(2)}%
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{
            marginTop: '12px', padding: '10px 14px', fontSize: '12px',
            background: 'var(--accent-blue-dim)', borderRadius: '8px', color: 'var(--text-secondary)',
            border: `1px solid var(--border-light)`, lineHeight: 1.5,
          }}>
            <span style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>解读：</span>
            {regime?.regime === 'RISK_ON' && '市场处于风险偏好状态，股指大概率维持上行趋势，关注 FOMC 会议纪要与通胀数据。'}
            {regime?.regime === 'GOLDILOCKS' && '经济处于金发女孩状态——增长温和、通胀可控，为风险资产提供有利环境。'}
            {regime?.regime === 'OVERHEAT' && '市场过热迹象明显，通胀压力上升，可能触发更激进的紧缩政策，关注防御性板块。'}
            {regime?.regime === 'STAGFLATION' && '滞胀风险上升：经济增长停滞叠加通胀压力，现金与短债为相对安全的配置选择。'}
            {regime?.regime === 'RISK_OFF' && '市场风险规避情绪主导，避险资产（黄金、美债、美元）表现可期。'}
            {regime?.regime === 'RECOVERY' && '经济处于复苏早期，政策支持力度较大，周期性板块与成长股可重点关注。'}
            {regime?.regime === 'UNKNOWN' && '市场信号混杂，建议等待更明确的方向信号，控制仓位与波动风险。'}
            {!regime && '数据加载中...'}
          </div>
        </div>
      </div>
    </MacroCard>
  )
}

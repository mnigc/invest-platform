import { MacroCard } from '../../ui/MacroCard'

const regime = 'RISK_ON'
const riskLevel = 1
const riskRatio = '35/100'
const vix = 13.85
const vixChange = 0.42
const vixUp = true
const vixTerm = 'Contango (7.2 → 15.3)'
const putCall = 0.85
const aaiiBull = 48.2
const aaiiBear = 22.5

export default function UsMarketRegime() {
  return (
    <MacroCard title="市场制式" badge={regime}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
        <div style={{ padding: '14px 16px', background: 'var(--accent-blue-dim)', borderRadius: '10px', border: '1px solid rgba(59,130,246,0.2)' }}>
          <div style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '0.06em', color: 'var(--accent-blue)' }}>{regime}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            <div>规避/偏好 {riskRatio}</div>
            <div>风险等级 {riskLevel}</div>
          </div>
        </div>
        <div style={{ padding: '12px 14px', background: 'var(--bg-card)', borderRadius: '10px', border: `1px solid var(--border-light)` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>VIX</span>
            <span style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{vix}</span>
            <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: vixUp ? 'var(--red)' : 'var(--green)' }}>
              {vixUp ? '+' : ''}{vixChange.toFixed(2)}
            </span>
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{vixTerm}</div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid var(--border-light)`, paddingTop: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>市场情绪</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
          {[
            { label: 'Put/Call', val: putCall.toFixed(2) },
            { label: 'AAII 牛', val: `${aaiiBull}%`, color: 'var(--red)' },
            { label: 'AAII 熊', val: `${aaiiBear}%`, color: 'var(--green)' },
            { label: '牛熊差', val: `${(aaiiBull - aaiiBear).toFixed(1)}%`, color: 'var(--red)' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '8px 6px', background: 'var(--bg-card)', borderRadius: '8px', border: `1px solid var(--border-light)` }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color || 'var(--text-primary)' }}>{s.val}</span>
            </div>
          ))}
        </div>
      </div>
    </MacroCard>
  )
}

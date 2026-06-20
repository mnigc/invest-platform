import { MacroCard } from '../../ui/MacroCard'
import { THEME } from '../../ui/theme'

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
        <div style={{ padding: '14px 16px', background: THEME.blueDim, borderRadius: '10px', border: '1px solid rgba(59,130,246,0.2)' }}>
          <div style={{ fontSize: '18px', fontWeight: 800, fontFamily: THEME.fontDisplay, letterSpacing: '0.06em', color: THEME.blue }}>{regime}</div>
          <div style={{ fontSize: '12px', color: THEME.textSecondary, marginTop: '4px' }}>
            <div>规避/偏好 {riskRatio}</div>
            <div>风险等级 {riskLevel}</div>
          </div>
        </div>
        <div style={{ padding: '12px 14px', background: THEME.bgCard, borderRadius: '10px', border: `1px solid ${THEME.borderLight}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '10px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>VIX</span>
            <span style={{ fontSize: '24px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary }}>{vix}</span>
            <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: THEME.fontMono, color: vixUp ? THEME.red : THEME.green }}>
              {vixUp ? '+' : ''}{vixChange.toFixed(2)}
            </span>
          </div>
          <div style={{ fontSize: '9px', color: THEME.textMuted, fontFamily: THEME.fontMono }}>{vixTerm}</div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${THEME.borderLight}`, paddingTop: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>市场情绪</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
          {[
            { label: 'Put/Call', val: putCall.toFixed(2) },
            { label: 'AAII 牛', val: `${aaiiBull}%`, color: THEME.red },
            { label: 'AAII 熊', val: `${aaiiBear}%`, color: THEME.green },
            { label: '牛熊差', val: `${(aaiiBull - aaiiBear).toFixed(1)}%`, color: THEME.red },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '8px 6px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
              <span style={{ fontSize: '11px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontSize: '16px', fontWeight: 700, fontFamily: THEME.fontMono, color: s.color || THEME.textPrimary }}>{s.val}</span>
            </div>
          ))}
        </div>
      </div>
    </MacroCard>
  )
}

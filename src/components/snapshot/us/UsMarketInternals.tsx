import { MacroCard } from '../../ui/MacroCard'
import { MacroBadge } from '../../ui/MacroBadge'
import { THEME } from '../../ui/theme'

const breadth = { advance: 2850, decline: 1850, newHigh: 128, newLow: 35 }
const maDist = { above20: 62, above50: 55, above200: 48 }
const mag7 = [
  { name: 'NVDA', perf: 2.85, up: true }, { name: 'AAPL', perf: 0.52, up: true },
  { name: 'MSFT', perf: 0.38, up: true }, { name: 'AMZN', perf: 1.15, up: true },
  { name: 'GOOGL', perf: -0.22, up: false }, { name: 'META', perf: 1.62, up: true },
  { name: 'TSLA', perf: -1.85, up: false },
]
const sox = 5320.45; const soxChange = 1.85; const soxUp = true

export default function UsMarketInternals() {
  const adPct = ((breadth.advance / (breadth.advance + breadth.decline)) * 100).toFixed(0)

  return (
    <MacroCard title="市场内部结构" badge="广度偏弱">
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>市场广度</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
          {[
            { label: '涨', val: breadth.advance, color: THEME.green },
            { label: '跌', val: breadth.decline, color: THEME.red },
            { label: '新高', val: breadth.newHigh, color: THEME.green },
            { label: '新低', val: breadth.newLow, color: THEME.red },
            { label: 'AD%', val: `${adPct}%` },
          ].map(b => (
            <div key={b.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '8px 4px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
              <span style={{ fontSize: '11px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{b.label}</span>
              <span style={{ fontSize: '16px', fontWeight: 700, fontFamily: THEME.fontMono, color: b.color || THEME.textPrimary }}>{b.val}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>均线分布</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 14px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
          {[
            { label: '% > MA20', val: maDist.above20 },
            { label: '% > MA50', val: maDist.above50 },
            { label: '% > MA200', val: maDist.above200 },
          ].map(m => (
            <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: THEME.textMuted, width: '56px', fontWeight: 500 }}>{m.label}</span>
              <div style={{ flex: 1, height: '6px', background: THEME.borderColor, borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${m.val}%`, background: THEME.blue, borderRadius: '2px' }} />
              </div>
              <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary, width: '36px', textAlign: 'right' }}>{m.val}%</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${THEME.borderLight}`, paddingTop: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>科技七巨头 (Mag7) 1D</span>
          <span style={{ fontSize: '12px', color: THEME.textMuted, fontFamily: THEME.fontMono }}>
            SOX {sox.toFixed(0)} <span style={{ color: soxUp ? THEME.green : THEME.red }}>{soxUp ? '+' : ''}{soxChange.toFixed(2)}%</span>
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
          {mag7.map(m => (
            <div key={m.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '8px 4px', background: THEME.bgCard, borderRadius: '6px', border: `1px solid ${THEME.borderLight}` }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: THEME.textPrimary, fontFamily: THEME.fontMono }}>{m.name}</span>
              <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: THEME.fontMono, color: m.up ? THEME.green : THEME.red }}>
                {m.up ? '+' : ''}{m.perf.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </MacroCard>
  )
}

import { MacroCard } from '../../ui/MacroCard'
import { MacroBadge } from '../../ui/MacroBadge'
import { THEME } from '../../ui/theme'

const swVal = {
  top3: [
    { name: '食品饮料', pe: 28.5, pb: 6.2, pct5y: 65 },
    { name: '计算机', pe: 52.3, pb: 4.8, pct5y: 72 },
    { name: '电子', pe: 45.8, pb: 5.1, pct5y: 58 },
  ],
  bottom3: [
    { name: '银行', pe: 6.2, pb: 0.6, pct5y: 22 },
    { name: '建筑', pe: 8.5, pb: 0.8, pct5y: 18 },
    { name: '钢铁', pe: 12.3, pb: 1.1, pct5y: 35 },
  ],
}
const broadPE = 16.8; const broad5yPct = 45; const broadSignal = '中性偏低'

export default function CnValuation() {
  return (
    <MacroCard title="估值体系" badge={broadSignal}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>全市场</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', background: THEME.blueDim, borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)' }}>
          <span style={{ fontSize: '32px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.blue }}>{broadPE}</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '11px', color: THEME.textMuted }}>全市场 PE (TTM)</span>
            <div style={{ height: '4px', background: THEME.borderColor, borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${broad5yPct}%`, background: THEME.blue, borderRadius: '2px' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: THEME.textMuted, marginTop: '2px' }}>
              <span>近5年 {broad5yPct}% 分位</span>
              <span>{broadSignal}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>高估行业 TOP3</div>
        {swVal.top3.map(s => (
          <div key={s.name} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 60px', gap: '8px', alignItems: 'center', padding: '8px 10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}`, marginBottom: '4px' }}>
            <span style={{ fontSize: '13px', color: THEME.textPrimary, fontWeight: 500 }}>{s.name}</span>
            <span style={{ fontSize: '12px', color: THEME.textSecondary, fontFamily: THEME.fontMono }}>PE {s.pe.toFixed(1)}</span>
            <span style={{ fontSize: '12px', color: THEME.textSecondary, fontFamily: THEME.fontMono }}>PB {s.pb.toFixed(1)}</span>
            <span style={{ fontSize: '12px', fontFamily: THEME.fontMono, color: '#F59E0B', textAlign: 'right' }}>{s.pct5y}%</span>
          </div>
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${THEME.borderLight}`, paddingTop: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>低估行业 BOTTOM 3</div>
        {swVal.bottom3.map(s => (
          <div key={s.name} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 60px', gap: '8px', alignItems: 'center', padding: '8px 10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}`, marginBottom: '4px' }}>
            <span style={{ fontSize: '13px', color: THEME.textPrimary, fontWeight: 500 }}>{s.name}</span>
            <span style={{ fontSize: '12px', color: THEME.textSecondary, fontFamily: THEME.fontMono }}>PE {s.pe.toFixed(1)}</span>
            <span style={{ fontSize: '12px', color: THEME.textSecondary, fontFamily: THEME.fontMono }}>PB {s.pb.toFixed(1)}</span>
            <span style={{ fontSize: '12px', fontFamily: THEME.fontMono, color: THEME.cyan, textAlign: 'right' }}>{s.pct5y}%</span>
          </div>
        ))}
      </div>
    </MacroCard>
  )
}

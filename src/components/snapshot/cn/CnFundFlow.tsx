import { MacroCard } from '../../ui/MacroCard'
import { THEME } from '../../ui/theme'

const northbound = { daily: -38.5, weekly: -125.3, monthly: 215.8, dailyUp: false, weeklyUp: false, monthlyUp: true }
const marginBalance = 15230; const marginChange = -42.8; const marginUp = false
const mainForceDaily = -185.6; const mainForceUp = false
const etfFlows = [
  { name: '科创50ETF', flow: 12.5, up: true },
  { name: '沪深300ETF', flow: -8.3, up: false },
  { name: '中证500ETF', flow: 5.8, up: true },
  { name: '创业板ETF', flow: -3.2, up: false },
]

const valClr = (up: boolean) => up ? THEME.red : THEME.green
const arrSvg = (up: boolean) => up
  ? <polyline points="18 15 12 9 6 15" fill="none" stroke="currentColor" strokeWidth="2.5" />
  : <polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" strokeWidth="2.5" />

export default function CnFundFlow() {
  return (
    <MacroCard title="资金面全景" badge="日频">
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>北向资金 (亿元)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {[
            { label: '当日', val: northbound.daily, up: northbound.dailyUp },
            { label: '本周', val: northbound.weekly, up: northbound.weeklyUp },
            { label: '本月', val: northbound.monthly, up: northbound.monthlyUp },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', color: THEME.textMuted, fontWeight: 500 }}>{item.label}</span>
                <svg width="8" height="8" viewBox="0 0 24 24" style={{ color: THEME.textMuted }}>{arrSvg(item.up)}</svg>
              </div>
              <span style={{ fontSize: '16px', fontWeight: 700, fontFamily: THEME.fontMono, color: valClr(item.up), textAlign: 'right' }}>
                {item.val >= 0 ? '+' : ''}{item.val.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>两融 & 主力</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          <div style={{ padding: '10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
            <span style={{ fontSize: '12px', color: THEME.textMuted, fontWeight: 500 }}>两融余额</span>
            <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary, textAlign: 'right', marginTop: '4px' }}>{marginBalance.toLocaleString()}亿</div>
          </div>
          <div style={{ padding: '10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
            <span style={{ fontSize: '12px', color: THEME.textMuted, fontWeight: 500 }}>两融变化</span>
            <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: THEME.fontMono, color: valClr(marginUp), textAlign: 'right', marginTop: '4px' }}>{marginChange >= 0 ? '+' : ''}{marginChange.toFixed(1)}亿</div>
          </div>
          <div style={{ padding: '10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
            <span style={{ fontSize: '12px', color: THEME.textMuted, fontWeight: 500 }}>主力净流</span>
            <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: THEME.fontMono, color: valClr(mainForceUp), textAlign: 'right', marginTop: '4px' }}>{mainForceDaily >= 0 ? '+' : ''}{mainForceDaily.toFixed(1)}亿</div>
          </div>
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${THEME.borderLight}`, paddingTop: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>ETF 资金申赎 (亿元)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
          {etfFlows.map(etf => (
            <div key={etf.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: THEME.bgCard, borderRadius: '6px', border: `1px solid ${THEME.borderLight}` }}>
              <span style={{ fontSize: '13px', color: THEME.textSecondary, fontWeight: 500 }}>{etf.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '14px', fontWeight: 700, fontFamily: THEME.fontMono, color: valClr(etf.up) }}>
                  {etf.flow >= 0 ? '+' : ''}{etf.flow.toFixed(1)}
                </span>
                <svg width="6" height="6" viewBox="0 0 24 24" style={{ color: THEME.textMuted }}>{arrSvg(etf.up)}</svg>
              </div>
            </div>
          ))}
        </div>
      </div>
    </MacroCard>
  )
}

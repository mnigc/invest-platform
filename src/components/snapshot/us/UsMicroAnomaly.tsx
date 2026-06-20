import { MacroCard } from '../../ui/MacroCard'
import { THEME } from '../../ui/theme'
import { MacroBadge } from '../../ui/MacroBadge'

const unusualVolume = [
  { name: 'SMCI', ratio: 3.5, change: 5.8, vol: '48M', up: true },
  { name: 'PLTR', ratio: 2.8, change: 4.2, vol: '65M', up: true },
  { name: 'MARA', ratio: 2.4, change: -3.5, vol: '32M', up: false },
]
const optionsFlow = [
  { name: 'NVDA', strikes: ['130C', '135C'], premium: '$12.5M', bullish: true },
  { name: 'TSLA', strikes: ['185P'], premium: '$8.2M', bullish: false },
  { name: 'AMD', strikes: ['165C'], premium: '$6.8M', bullish: true },
]
const momentumCandidates = [
  { name: 'ANET', reason: 'AI 交换机需求爆发', change: 3.2, up: true },
  { name: 'VST', reason: '电力需求主题, 连续放量', change: 2.8, up: true },
]
const reversalCandidates = [
  { name: 'XLE', reason: '能源板块超卖, RSI<30', change: -2.1, up: false },
  { name: 'KO', reason: '防御资金流出', change: -1.5, up: false },
]

export default function UsMicroAnomaly() {
  return (
    <MacroCard title="微观异动 & 选股线索" badge="3 个信号">
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>异常成交量 TOP3</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {unusualVolume.map(u => (
            <div key={u.name} style={{ padding: '10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary }}>{u.name}</span>
                <MacroBadge value={u.change} variant={u.up ? 'up' : 'down'} size="sm" showArrow={false} />
              </div>
              <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: THEME.textMuted, fontFamily: THEME.fontMono }}>
                <span>{u.ratio}x</span>
                <span>{u.vol}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>期权异动</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {optionsFlow.map(o => (
            <div key={o.name} style={{ padding: '10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary }}>{o.name}</span>
                <span style={{ color: o.bullish ? THEME.green : THEME.red }}>{o.bullish ? '▲' : '▼'}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: THEME.textMuted, fontFamily: THEME.fontMono }}>
                <span>{o.strikes.join('/')}</span>
                <span>{o.premium}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${THEME.borderLight}`, paddingTop: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>动量 / 反转候选</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {[
            { title: '动量候选', items: momentumCandidates },
            { title: '反转候选', items: reversalCandidates },
          ].map(section => (
            <div key={section.title}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                {section.title}
              </div>
              {section.items.map(c => (
                <div key={c.name} style={{ padding: '10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}`, marginBottom: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary }}>{c.name}</span>
                    <MacroBadge value={c.change} variant={c.up ? 'up' : 'down'} size="sm" showArrow={false} />
                  </div>
                  <div style={{ fontSize: '11px', color: THEME.textSecondary }}>{c.reason}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </MacroCard>
  )
}


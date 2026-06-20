import { MacroCard } from '../../ui/MacroCard'
import { THEME } from '../../ui/theme'

const policyHighlights = [
  { date: '06-15', event: '央行 LPR 1Y/5Y 维持不变', impact: '落地' as const },
  { date: '06-12', event: '发改委新基建投资方案发布', impact: '利好' as const },
  { date: '06-10', event: '证监会程序化交易新规征求意见', impact: '中性' as const },
  { date: '06-07', event: '国常会稳增长政策组合拳', impact: '利好' as const },
  { date: '06-05', event: '地产新政: 一线城市限购调整', impact: '利好' as const },
]
const riskFactors = [
  { name: '中美利差', val: '-210bp', direction: 'pressure' as const },
  { name: '人民币汇率', val: '7.25', direction: 'stable' as const },
  { name: '地缘风险', val: '科技封锁升级', direction: 'risk' as const },
  { name: '信用风险', val: '城投化解中', direction: 'stable' as const },
]
const nextEvents = [
  { date: '07-01', event: '6月PMI数据', impact: '高' as const },
  { date: '07-10', event: '社融/M2 数据', impact: '高' as const },
  { date: '07-15', event: 'Q2 GDP 初值', impact: '高' as const },
]

const impactColors = {
  '落地': { color: '#089981', bg: 'rgba(8,153,129,0.12)' },
  '利好': { color: THEME.cyan, bg: THEME.cyanDim },
  '中性': { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  '高': { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
} as Record<string, { color: string; bg: string }>

export default function CnPolicyRisk() {
  return (
    <MacroCard title="政策 & 风险" badge="密集观察期">
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>近期政策 (7日内)</div>
        {policyHighlights.map(p => {
          const ic = impactColors[p.impact] || impactColors['中性']
          return (
            <div key={p.event} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: THEME.bgCard, borderRadius: '6px', border: `1px solid ${THEME.borderLight}`, marginBottom: '4px' }}>
              <span style={{ fontSize: '11px', color: THEME.textMuted, fontFamily: THEME.fontMono, width: '44px' }}>{p.date}</span>
              <span style={{ flex: 1, fontSize: '12px', color: THEME.textSecondary }}>{p.event}</span>
              <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: ic.bg, color: ic.color }}>{p.impact}</span>
            </div>
          )
        })}
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>风险因素监控</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
          {riskFactors.map(r => {
            const dirColor = r.direction === 'pressure' ? THEME.red : r.direction === 'risk' ? '#F59E0B' : THEME.cyan
            return (
              <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
                <span style={{ fontSize: '12px', color: THEME.textMuted }}>{r.name}</span>
                <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: THEME.fontMono, color: dirColor }}>{r.val}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${THEME.borderLight}`, paddingTop: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>下一步待发事件</div>
        {nextEvents.map(e => {
          const ic = impactColors[e.impact] || impactColors['中性']
          return (
            <div key={e.event} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: THEME.bgCard, borderRadius: '6px', border: `1px solid ${THEME.borderLight}`, marginBottom: '4px' }}>
              <span style={{ fontSize: '11px', color: THEME.textMuted, fontFamily: THEME.fontMono, width: '44px' }}>{e.date}</span>
              <span style={{ flex: 1, fontSize: '12px', color: THEME.textSecondary }}>{e.event}</span>
              <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: ic.bg, color: ic.color }}>{e.impact}</span>
            </div>
          )
        })}
      </div>
    </MacroCard>
  )
}

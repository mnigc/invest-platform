import { MacroCard } from '../../ui/MacroCard'
import { THEME } from '../../ui/theme'

const events = [
  { date: '06-21', event: '四巫日 (Triple Witching)', impact: '高' as const },
  { date: '06-25', event: 'FOMC 讲话 — Waller', impact: '中' as const },
  { date: '06-27', event: '核心 PCE 5月数据', impact: '高' as const },
  { date: '06-28', event: '密歇根消费者信心指数', impact: '中' as const },
]
const ctaPositioning = '中性偏多'
const gammaExposure = '+$2.1B / 0dTE'
const vixFutures = 'Contango 12.5 → 16.8'
const tomorrowWatch = [
  'SPX 5450-5500 区间突破方向，VIX 14 以下是否继续压缩',
  'NVDA 是否守住 130 美元关键支撑，Mag7 内轮动（AAPL/META 接力）',
  '四巫日交割资金流向，关注 $5.5T 期权到期影响',
  '10Y 收益率 4.30% 关键位，若突破关注成长股压力',
  '能源板块超卖反弹机会，XLE RSI=28 是否触发技术买盘',
]

const impactColors = { '高': { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B' }, '中': { bg: THEME.cyanDim, color: THEME.cyan } }

export default function UsSentimentOutlook() {
  return (
    <MacroCard title="情绪定位 & 明日前瞻" badge="CTA 中性偏多">
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>CTA 定位</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {[
            { label: 'CTA 定位', val: ctaPositioning, color: THEME.cyan },
            { label: 'Gamma (0dTE)', val: gammaExposure, color: THEME.red },
            { label: 'VIX 期货', val: vixFutures },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '8px 6px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
              <span style={{ fontSize: '11px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: THEME.fontMono, color: s.color || THEME.textPrimary }}>{s.val}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>关键事件日历</div>
        {events.map(e => {
          const ic = impactColors[e.impact]
          return (
            <div key={e.event} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: THEME.bgCard, borderRadius: '6px', border: `1px solid ${THEME.borderLight}`, marginBottom: '4px' }}>
              <span style={{ fontSize: '11px', color: THEME.textMuted, fontFamily: THEME.fontMono, width: '44px' }}>{e.date}</span>
              <span style={{ flex: 1, fontSize: '12px', color: THEME.textSecondary }}>{e.event}</span>
              <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: ic.bg, color: ic.color }}>{e.impact}</span>
            </div>
          )
        })}
      </div>

      <div style={{ borderTop: `1px solid ${THEME.borderLight}`, paddingTop: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>明日 5 个观察重点</div>
        {tomorrowWatch.map((w, i) => (
          <div key={i} style={{ display: 'flex', gap: '8px', padding: '8px 10px', marginBottom: '6px', background: THEME.bgCard, borderRadius: '6px', borderLeft: `2px solid ${THEME.blue}` }}>
            <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textMuted, width: '16px', textAlign: 'center' }}>{i + 1}</span>
            <span style={{ fontSize: '12px', color: THEME.textSecondary, lineHeight: '1.5' }}>{w}</span>
          </div>
        ))}
      </div>
    </MacroCard>
  )
}

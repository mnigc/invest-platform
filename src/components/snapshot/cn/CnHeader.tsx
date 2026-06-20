import { THEME } from '../../ui/theme'

interface Props {
  data?: { tradeDate: string; sentiment: string; conclusion: string } | null
}

export default function CnHeader({ data }: Props) {
  const tradeDate = data?.tradeDate || '2026-06-18'
  const sentiment = data?.sentiment || 'neutral'
  const conclusion = data?.conclusion || 'A股震荡分化，政策宽松预期支撑，北向资金小幅流出'

  const sentColors: Record<string, { color: string; bg: string; border: string }> = {
    neutral: { color: THEME.cyan, bg: THEME.cyanDim, border: 'rgba(6,182,212,0.2)' },
    positive: { color: '#089981', bg: 'rgba(8,153,129,0.12)', border: 'rgba(8,153,129,0.2)' },
    negative: { color: THEME.red, bg: THEME.redBg, border: 'rgba(242,54,69,0.2)' },
  }
  const sc = sentColors[sentiment] || sentColors.neutral
  const genAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px',
      padding: '12px 16px', marginBottom: '12px', background: THEME.bgCard,
      border: `1px solid ${THEME.borderLight}`, borderRadius: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ background: THEME.bgCard, padding: '5px 10px', borderRadius: '8px', border: `1px solid ${THEME.borderLight}`, display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: THEME.textMuted }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={THEME.cyan} stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          交易日期 <strong style={{ color: THEME.textPrimary, fontFamily: THEME.fontMono }}>{tradeDate}</strong>
        </div>
        <div style={{ background: THEME.bgCard, padding: '5px 10px', borderRadius: '8px', border: `1px solid ${THEME.borderLight}`, display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: THEME.textMuted }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={THEME.cyan} stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          生成 {genAt}
        </div>
      </div>
      <span style={{ display: 'flex', alignItems: 'center', gap: '5px', marginLeft: 'auto', padding: '5px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, fontFamily: THEME.fontDisplay, letterSpacing: '0.06em', color: sc.color, background: sc.bg, border: `1px solid ${sc.border}` }}>
        {sentiment.toUpperCase()}
      </span>
      <div style={{ width: '100%', fontSize: '13px', color: THEME.textSecondary, lineHeight: '1.5', paddingTop: '8px', borderTop: `1px solid ${THEME.borderLight}`, marginTop: '8px' }}>
        {conclusion}
      </div>
    </div>
  )
}

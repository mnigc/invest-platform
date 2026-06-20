import { THEME } from '../../ui/theme'

interface Props {
  data?: { date: string; status: string; conclusion: string } | null
}

export default function UsHeader({ data }: Props) {
  const tradeDate = data?.date || '2026-06-18'
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  const status = data?.status || 'watch'
  const coreSummary = data?.conclusion || 'SPX 创历史新高后窄幅震荡，科技股领涨但广度收窄'

  const statusColors: Record<string, { color: string; bg: string; border: string }> = {
    watch: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.2)' },
    active: { color: THEME.cyan, bg: THEME.cyanDim, border: 'rgba(6,182,212,0.2)' },
  }
  const sc = statusColors[status] || statusColors.watch

  const pillStyle: React.CSSProperties = {
    background: THEME.bgCard, padding: '5px 10px', borderRadius: '8px',
    border: `1px solid ${THEME.borderLight}`,
    display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: THEME.textMuted,
  }

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px',
      padding: '12px 16px', marginBottom: '12px', background: THEME.bgCard,
      border: `1px solid ${THEME.borderLight}`, borderRadius: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={pillStyle}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={THEME.cyan} stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>基准日 (ET)</span>
          <strong style={{ color: THEME.textPrimary, fontWeight: 600, fontFamily: THEME.fontMono }}>{tradeDate}</strong>
        </div>
        <div style={pillStyle}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={THEME.cyan} stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>生成 {generatedAt}</span>
        </div>
      </div>
      <span style={{
        display: 'flex', alignItems: 'center', gap: '5px', marginLeft: 'auto',
        padding: '5px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
        fontFamily: THEME.fontDisplay, letterSpacing: '0.06em', color: sc.color,
        background: sc.bg, border: `1px solid ${sc.border}`,
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <span>{status.toUpperCase()}</span>
      </span>
      <div style={{
        width: '100%', fontSize: '13px', color: THEME.textSecondary, lineHeight: '1.5',
        paddingTop: '8px', borderTop: `1px solid ${THEME.borderLight}`, marginTop: '8px',
      }}>
        {coreSummary}
      </div>
    </div>
  )
}

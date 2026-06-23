interface Props {
  data?: { date: string; status: string; conclusion: string } | null
}

export default function UsHeader({ data }: Props) {
  const tradeDate = data?.date || '--'
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  const status = data?.status || 'watch'
  const coreSummary = data?.conclusion || '暂无数据'

  const statusColors: Record<string, { color: string; bg: string; border: string }> = {
    watch: { color: 'var(--accent-gold)', bg: 'var(--accent-gold-dim)', border: 'var(--border-light)' },
    active: { color: 'var(--accent-cyan)', bg: 'var(--accent-cyan-dim)', border: 'var(--border-light)' },
  }
  const sc = statusColors[status] || statusColors.watch

  const pillStyle: React.CSSProperties = {
    background: 'var(--bg-card)', padding: '5px 10px', borderRadius: '8px',
    border: `1px solid var(--border-light)`,
    display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-muted)',
  }

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px',
      padding: '12px 16px', marginBottom: '12px', background: 'var(--bg-card)',
      borderRadius: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={pillStyle}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={'var(--accent-cyan)'} stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>基准日 (ET)</span>
          <strong style={{ color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{tradeDate}</strong>
        </div>
        <div style={pillStyle}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={'var(--accent-cyan)'} stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>生成 {generatedAt}</span>
        </div>
      </div>
      <span style={{
        display: 'flex', alignItems: 'center', gap: '5px', marginLeft: 'auto',
        padding: '5px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
        fontFamily: 'var(--font-display)', letterSpacing: '0.06em', color: sc.color,
        background: sc.bg, border: `1px solid ${sc.border}`,
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <span>{status.toUpperCase()}</span>
      </span>
      <div style={{
        width: '100%', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5',
        paddingTop: '8px', marginTop: '8px',
      }}>
        {coreSummary}
      </div>
    </div>
  )
}

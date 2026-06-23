interface Props {
  periods: readonly string[]
  active: string
  onChange: (period: string) => void
  extra?: React.ReactNode
}

export function PeriodSelector({ periods, active, onChange, extra }: Props) {
  return (
    <div style={{
      display: 'flex',
      gap: '8px',
      marginBottom: '16px',
      flexWrap: 'wrap',
      alignItems: 'center',
    }}>
      {periods.map(p => (
        <button
          key={p}
          onClick={() => onChange(p)}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 500,
            fontFamily: 'var(--font-display)',
            letterSpacing: '0.03em',
            border: p === active ? `1px solid var(--accent-blue)` : '1px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: p === active ? 'var(--accent-blue-dim)' : 'var(--bg-card)',
            color: p === active ? 'var(--accent-blue)' : 'var(--text-secondary)',
          }}
        >
          {p}
        </button>
      ))}
      {extra && <span style={{ flex: 1 }} />}
      {extra}
    </div>
  )
}

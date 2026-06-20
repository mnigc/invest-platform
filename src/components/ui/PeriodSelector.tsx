import { THEME } from './theme'

interface Props {
  periods: readonly string[]
  active: string
  onChange: (period: string) => void
  extra?: React.ReactNode
}

const btnBase: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 500,
  fontFamily: THEME.fontDisplay,
  letterSpacing: '0.03em',
  border: '1px solid transparent',
  cursor: 'pointer',
  transition: 'all 0.2s',
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
            ...btnBase,
            border: p === active ? `1px solid ${THEME.blue}` : '1px solid transparent',
            background: p === active ? THEME.blueDim : THEME.bgCard,
            color: p === active ? THEME.blue : THEME.textSecondary,
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

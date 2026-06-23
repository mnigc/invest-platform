interface Props {
  value: number | null
  variant?: 'percent' | 'value'
}

export function TrendArrow({ value, variant = 'percent' }: Props) {
  if (value == null) return <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>--</span>

  const isUp = value >= 0
  const arrow = isUp ? '▲' : '▼'
  const display = variant === 'percent'
    ? `${isUp ? '+' : ''}${value.toFixed(2)}%`
    : `${isUp ? '+' : ''}${value.toFixed(2)}`

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '2px',
      fontSize: '12px',
      fontWeight: 600,
      fontFamily: 'var(--font-mono)',
      color: isUp ? 'var(--green)' : 'var(--red)',
    }}>
      {arrow}{display}
    </span>
  )
}

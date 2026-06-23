interface Props {
  value: number | string
  variant?: 'up' | 'down' | 'neutral' | 'hot' | 'cold'
  size?: 'sm' | 'md'
  showArrow?: boolean
}

const sizeStyles = {
  sm: { padding: '2px 6px', fontSize: '11px', gap: '3px' },
  md: { padding: '4px 10px', fontSize: '12px', gap: '4px' },
}

function makeVariantColors() {
  return {
    up: { color: 'var(--green)', bg: 'var(--green-bg)', border: 'var(--green-bg)' },
    down: { color: 'var(--red)', bg: 'var(--red-bg)', border: 'var(--red-bg)' },
    neutral: { color: 'var(--text-muted)', bg: 'var(--bg-card)', border: 'var(--border-light)' },
    hot: { color: 'var(--green)', bg: 'var(--green-bg)', border: 'var(--green-bg)' },
    cold: { color: 'var(--accent-cyan)', bg: 'var(--accent-cyan-dim)', border: 'var(--accent-cyan-dim)' },
  }
}

export function MacroBadge({ value, variant = 'neutral', size = 'md', showArrow = true }: Props) {
  const variantColors = makeVariantColors()
  const vc = variantColors[variant] || variantColors.neutral
  const ss = sizeStyles[size]

  const numVal = typeof value === 'string' ? parseFloat(value) : value
  const displayVal = typeof value === 'string' ? value : (numVal >= 0 ? '+' : '') + numVal.toFixed(2) + (variant === 'up' || variant === 'down' ? '%' : '')

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: ss.gap,
      padding: ss.padding,
      borderRadius: '4px',
      fontSize: ss.fontSize,
      fontWeight: 600,
      fontFamily: 'var(--font-mono)',
      color: vc.color,
      background: vc.bg,
      border: `1px solid ${vc.border}`,
      whiteSpace: 'nowrap',
    }}>
      {showArrow && (variant === 'up' ? '▲' : variant === 'down' ? '▼' : '')}
      {displayVal}
    </span>
  )
}

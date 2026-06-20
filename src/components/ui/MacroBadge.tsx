import { THEME } from './theme'

interface Props {
  value: number | string
  variant?: 'up' | 'down' | 'neutral' | 'hot' | 'cold'
  size?: 'sm' | 'md'
  showArrow?: boolean
}

const variantColors: Record<string, { color: string; bg: string; border: string }> = {
  up: { color: THEME.green, bg: THEME.greenBg, border: 'rgba(8, 153, 129, 0.2)' },
  down: { color: THEME.red, bg: THEME.redBg, border: 'rgba(242, 54, 69, 0.2)' },
  neutral: { color: THEME.textMuted, bg: THEME.bgCard, border: THEME.borderLight },
  hot: { color: THEME.green, bg: THEME.greenBg, border: 'rgba(8, 153, 129, 0.3)' },
  cold: { color: THEME.cyan, bg: THEME.cyanDim, border: 'rgba(6, 182, 212, 0.2)' },
}

const sizeStyles = {
  sm: { padding: '2px 6px', fontSize: '11px', gap: '3px' },
  md: { padding: '4px 10px', fontSize: '12px', gap: '4px' },
}

export function MacroBadge({ value, variant = 'neutral', size = 'md', showArrow = true }: Props) {
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
      fontFamily: THEME.fontMono,
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

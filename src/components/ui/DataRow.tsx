import { THEME } from './theme'
import { TrendArrow } from './TrendArrow'

interface Props {
  label: string
  sublabel?: string
  value: number | string | null
  change?: number | null
  unit?: string
  valueColor?: string
}

export function DataRow({ label, sublabel, value, change, unit, valueColor }: Props) {
  const displayValue = value != null
    ? `${typeof value === 'number' ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value}${unit || ''}`
    : '--'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '4px 8px',
      borderRadius: '4px',
      transition: 'background 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = THEME.bgCardHover)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <span style={{ fontSize: '13px', color: THEME.textSecondary }}>{label}</span>
        {sublabel && <span style={{ fontSize: '10px', color: THEME.textMuted }}>{sublabel}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          fontSize: '14px',
          fontWeight: 700,
          fontFamily: THEME.fontMono,
          color: valueColor || THEME.textPrimary,
        }}>
          {displayValue}
        </span>
        {change != null && <TrendArrow value={change} />}
      </div>
    </div>
  )
}

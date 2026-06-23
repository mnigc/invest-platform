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
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{label}</span>
        {sublabel && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{sublabel}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          fontSize: '14px',
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          color: valueColor || 'var(--text-primary)',
        }}>
          {displayValue}
        </span>
        {change != null && <TrendArrow value={change} />}
      </div>
    </div>
  )
}

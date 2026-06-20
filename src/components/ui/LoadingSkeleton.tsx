import { THEME } from './theme'

interface Props {
  rows?: number
  type?: 'card' | 'table' | 'chart'
  height?: number
}

export function LoadingSkeleton({ rows = 3, type = 'card', height }: Props) {
  const shimmerBase: React.CSSProperties = {
    background: `linear-gradient(90deg, ${THEME.bgCard} 25%, ${THEME.bgCardHover} 50%, ${THEME.bgCard} 75%)`,
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s ease-in-out infinite',
    borderRadius: '8px',
  }

  if (type === 'chart') {
    return (
      <div style={{
        ...shimmerBase,
        width: '100%',
        height: height || '360px',
        borderRadius: '12px',
      }} />
    )
  }

  const rowHeight = type === 'table' ? 28 : 16

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 0' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          ...shimmerBase,
          width: `${70 + Math.random() * 30}%`,
          height: `${rowHeight}px`,
        }} />
      ))}
    </div>
  )
}

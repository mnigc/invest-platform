interface Props {
  rows?: number
  type?: 'card' | 'table' | 'chart' | 'number'
  height?: number
  pulse?: boolean
}

export function LoadingSkeleton({ rows = 3, type = 'card', height, pulse = false }: Props) {
  const pulseClass = pulse ? 'loading-skeleton--pulse' : 'loading-skeleton--shimmer'

  if (type === 'chart') {
    return (
      <div className={`loading-skeleton loading-skeleton--chart ${pulseClass}`} style={{ height: height || 360 }} />
    )
  }

  if (type === 'number') {
    return (
      <div className={`loading-skeleton loading-skeleton--number ${pulseClass}`} />
    )
  }

  const rowHeight = type === 'table' ? 28 : 16

  return (
    <div className="loading-skeleton--rows">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`loading-skeleton ${pulseClass}`}
          style={{
            width: `${70 + Math.random() * 30}%`,
            height: `${rowHeight}px`,
            marginBottom: type === 'table' ? 0 : undefined,
            borderBottom: type === 'table' ? '1px solid var(--border-subtle)' : undefined,
          }}
        />
      ))}
    </div>
  )
}

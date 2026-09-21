import { useId } from 'react'

interface SparklineProps {
  data: { date: string; value: number }[]
  width?: number
  height?: number
  color?: string
  className?: string
}

export function Sparkline({
  data,
  width = 80,
  height = 28,
  color,
  className = '',
}: SparklineProps) {
  // 渐变 id 必须每实例唯一：只按 color 生成会让同页多个 Sparkline
  // 共享第一个 <defs>，面积色与折线色错配
  const gradientId = `sparkline-${useId()}`
  if (!data || data.length < 2) return null

  const values = data.map((d) => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const padding = 2
  const chartWidth = width - padding * 2
  const chartHeight = height - padding * 2

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * chartWidth
    const y = padding + chartHeight - ((v - min) / range) * chartHeight
    return `${x},${y}`
  })

  const pathD = `M${points.join(' L')}`

  // 判断趋势方向：最后一个值 vs 第一个值；颜色走 tokens 单一色源，明暗主题各自正确
  const trend = values[values.length - 1] - values[0]
  const strokeColor = color || (trend > 0 ? 'rgb(var(--c-up))' : trend < 0 ? 'rgb(var(--c-down))' : 'rgb(var(--c-text-3))')

  // 填充区域
  const fillPathD = `${pathD} L${padding + chartWidth},${padding + chartHeight} L${padding},${padding + chartHeight} Z`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <path
        d={fillPathD}
        fill={`url(#${gradientId})`}
      />
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={padding + chartWidth}
        cy={padding + chartHeight - ((values[values.length - 1] - min) / range) * chartHeight}
        r="2.5"
        fill={strokeColor}
      />
    </svg>
  )
}

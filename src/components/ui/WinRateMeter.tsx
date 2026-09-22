interface Props {
  /** 0 ~ 1 */
  value: number
  className?: string
}

/**
 * 胜率进度条：≥50% 涨色、<50% 跌色。
 * 细条设计（h-1），用于记分卡与表格单元格——回测类数据的核心视觉锚点。
 */
export function WinRateMeter({ value, className }: Props) {
  const pct = Math.min(100, Math.max(0, Math.round(value * 100)))
  return (
    <span
      role="img"
      aria-label={`胜率 ${pct}%`}
      className={`block h-1 w-full overflow-hidden rounded-full bg-surface-3 ${className ?? ''}`}
    >
      <span
        className={`block h-full rounded-full ${value >= 0.5 ? 'bg-up' : 'bg-down'}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  )
}

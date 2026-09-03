import type { ReactNode } from 'react'

export type TileTone = 'neutral' | 'up' | 'down' | 'warn' | 'info'
export type TileAccent = 'blue' | 'cyan' | 'gold' | 'red' | 'green' | 'none'

interface Props {
  label: string
  value: string
  sub?: string
  tone?: TileTone
  accent?: TileAccent
  flashKey?: string | number
  className?: string
  /** 鼠标移入时通过原生 title 弹出的说明文案 */
  tooltip?: ReactNode
}

const TONE_VALUE: Record<TileTone, string> = {
  neutral: 'text-ink',
  up: 'text-up',
  down: 'text-down',
  warn: 'text-warn',
  info: 'text-info',
}

const ACCENT_BAR: Record<Exclude<TileAccent, 'none'>, string> = {
  blue: 'border-l-accent',
  cyan: 'border-l-info',
  gold: 'border-l-warn',
  green: 'border-l-up',
  red: 'border-l-down',
}

/**
 * 统一 KPI 卡。
 * 数值强制 .num（等宽 + tabular-nums）—— 没有它，数字刷新时字宽会跳。
 *
 * 溢出兜底：label / value / sub 三个区域均使用原生 title 属性，
 * 鼠标移入即可看到被 truncate 截掉的完整文本，无需外部传 tooltip。
 */
export function StatTile({
  label,
  value,
  sub,
  tone = 'neutral',
  accent = 'none',
  flashKey,
  className,
  tooltip,
}: Props) {
  const tooltipText = tooltip != null ? String(tooltip) : undefined
  return (
    <div
      className={[
        'min-w-0 rounded-md border border-line bg-surface px-3 py-2.5',
        accent !== 'none' ? `border-l-2 ${ACCENT_BAR[accent]}` : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      title={tooltipText ?? value}
    >
      <div className="truncate text-2xs uppercase tracking-wider text-ink-3" title={label}>
        {label}
      </div>
      <div
        key={flashKey}
        className={`num truncate text-lg font-semibold leading-tight ${TONE_VALUE[tone]}`}
        title={value}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 truncate text-2xs text-ink-3" title={sub}>
          {sub}
        </div>
      )}
    </div>
  )
}

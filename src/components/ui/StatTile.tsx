export type TileTone = 'neutral' | 'up' | 'down' | 'warn' | 'info'
export type TileAccent = 'blue' | 'cyan' | 'gold' | 'red' | 'green' | 'none'

interface Props {
  label: string
  value: string
  sub?: string
  /** 数值颜色语义 */
  tone?: TileTone
  /** 左侧色条 */
  accent?: TileAccent
  /** 值变化时闪一下（终端惯用提示），传入会变化的值即可 */
  flashKey?: string | number
  className?: string
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
 */
export function StatTile({
  label,
  value,
  sub,
  tone = 'neutral',
  accent = 'none',
  flashKey,
  className,
}: Props) {
  return (
    <div
      className={[
        'min-w-0 rounded-md border border-line bg-surface px-3 py-2.5',
        accent !== 'none' ? `border-l-2 ${ACCENT_BAR[accent]}` : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="truncate text-2xs uppercase tracking-wider text-ink-3">
        {label}
      </div>
      <div
        key={flashKey}
        className={`num truncate text-lg font-semibold leading-tight ${TONE_VALUE[tone]}`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-2xs text-ink-3">{sub}</div>}
    </div>
  )
}

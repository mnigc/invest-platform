import { type CSSProperties, type ReactNode } from 'react'

export type CardAccent = 'blue' | 'cyan' | 'gold' | 'green' | 'red' | 'none'

interface Props {
  title?: string
  icon?: ReactNode
  badge?: ReactNode
  /** elevated = 更亮的表面，用于页面主视觉块 */
  variant?: 'default' | 'elevated'
  /** 左侧色条：用来表达涨跌/告警语义，默认无 */
  accent?: CardAccent
  padding?: 'sm' | 'md' | 'lg'
  /** 可点击卡片：加 hover 反馈 */
  interactive?: boolean
  children: ReactNode
  className?: string
  style?: CSSProperties
}

const ACCENT_BAR: Record<Exclude<CardAccent, 'none'>, string> = {
  blue: 'border-l-accent',
  cyan: 'border-l-info',
  gold: 'border-l-warn',
  green: 'border-l-up',
  red: 'border-l-down',
}

const PADDING = {
  sm: 'p-2.5',
  md: 'p-3.5',
  lg: 'p-5',
} as const

export function MacroCard({
  title,
  icon,
  badge,
  variant = 'default',
  accent = 'none',
  padding = 'md',
  interactive = false,
  children,
  className,
  style,
}: Props) {
  return (
    <section
      style={style}
      className={[
        'relative overflow-hidden rounded-lg border',
        variant === 'elevated' ? 'bg-surface-2' : 'bg-surface',
        'border-line',
        accent !== 'none' ? `border-l-2 ${ACCENT_BAR[accent]}` : '',
        interactive
          ? 'transition-colors duration-1 ease-terminal hover:border-line-strong hover:bg-surface-2'
          : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2.5">
          <h2 className="flex min-w-0 items-center gap-2 text-md font-medium tracking-wide text-ink">
            {icon && (
              <span className="flex shrink-0 text-ink-3" aria-hidden="true">
                {icon}
              </span>
            )}
            <span className="truncate">{title}</span>
          </h2>
          {badge}
        </header>
      )}
      <div className={PADDING[padding]}>{children}</div>
    </section>
  )
}

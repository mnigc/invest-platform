import { type ReactNode } from 'react'

interface Props {
  title?: string
  icon?: ReactNode
  badge?: string | ReactNode
  variant?: 'default' | 'elevated'
  accent?: 'blue' | 'cyan' | 'gold' | 'green' | 'red' | 'none'
  padding?: 'sm' | 'md' | 'lg'
  children: ReactNode
  className?: string
}

export function MacroCard({ title, icon, badge, variant = 'default', accent = 'none', padding = 'md', children, className }: Props) {
  const classes = [
    'macro-card',
    accent !== 'none' ? `macro-card--accent-${accent}` : '',
    padding !== 'md' ? `macro-card--${padding}` : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      {title && (
        <div className="macro-card__header">
          <div className="macro-card__title">
            {icon && <span style={{ color: 'var(--accent-blue)', display: 'flex' }}>{icon}</span>}
            <span>{title}</span>
          </div>
          {badge && typeof badge === 'string' ? (
            <span className="macro-card__badge">{badge}</span>
          ) : badge}
        </div>
      )}
      {children}
    </div>
  )
}

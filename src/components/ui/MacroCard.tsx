import { useState } from 'react'
import { THEME } from './theme'

interface Props {
  title?: string
  icon?: React.ReactNode
  badge?: string | React.ReactNode
  variant?: 'default' | 'elevated'
  children: React.ReactNode
  className?: string
}

export function MacroCard({ title, icon, badge, variant = 'default', children, className }: Props) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className={className}
      style={{
        background: THEME.bgCard,
        border: `1px solid ${hovered ? THEME.blue : THEME.borderLight}`,
        borderRadius: '16px',
        padding: '16px',
        transition: 'all 0.2s ease',
        boxShadow: variant === 'elevated' ? `0 4px 12px rgba(0,0,0,0.6)` : '0 1px 2px rgba(0,0,0,0.5)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {title && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '10px',
          paddingBottom: '8px',
          borderBottom: `1px solid ${THEME.borderLight}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {icon && <span style={{ color: THEME.blue, display: 'flex' }}>{icon}</span>}
            <span style={{
              fontSize: '15px',
              fontWeight: 600,
              fontFamily: THEME.fontDisplay,
              letterSpacing: '0.04em',
              color: THEME.textPrimary,
            }}>
              {title}
            </span>
          </div>
          {badge && typeof badge === 'string' ? (
            <span style={{
              fontSize: '12px',
              padding: '4px 12px',
              borderRadius: '8px',
              background: THEME.cyanDim,
              color: THEME.cyan,
              fontFamily: THEME.fontMono,
              letterSpacing: '0.04em',
              fontWeight: 600,
            }}>
              {badge}
            </span>
          ) : badge}
        </div>
      )}
      {children}
    </div>
  )
}

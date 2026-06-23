interface Props {
  title?: string
  icon?: React.ReactNode
  badge?: string | React.ReactNode
  variant?: 'default' | 'elevated'
  children: React.ReactNode
  className?: string
}

export function MacroCard({ title, icon, badge, variant = 'default', children, className }: Props) {
  return (
    <div className={className} style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '16px' }}>
      {title && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '10px',
          paddingBottom: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {icon && <span style={{ color: 'var(--accent-blue)', display: 'flex' }}>{icon}</span>}
            <span style={{
              fontSize: '15px',
              fontWeight: 600,
              fontFamily: 'var(--font-display)',
              letterSpacing: '0.04em',
              color: 'var(--text-primary)',
            }}>
              {title}
            </span>
          </div>
          {badge && typeof badge === 'string' ? (
            <span style={{
              fontSize: '12px',
              padding: '4px 12px',
              borderRadius: '8px',
              background: 'var(--accent-cyan-dim)',
              color: 'var(--accent-cyan)',
              fontFamily: 'var(--font-mono)',
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

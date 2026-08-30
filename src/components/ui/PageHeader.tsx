interface BreadcrumbItem {
  label: string
  href?: string
}

interface Props {
  title: string
  subtitle?: string
  breadcrumb?: BreadcrumbItem[]
  /** 右侧操作区（刷新、时间范围切换等） */
  actions?: React.ReactNode
}

export function PageHeader({ title, subtitle, breadcrumb, actions }: Props) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="面包屑" className="mb-1 flex items-center gap-1.5 text-xs text-ink-3">
            {breadcrumb.map((item, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && (
                  <span aria-hidden="true" className="text-line-strong">
                    /
                  </span>
                )}
                {item.href ? (
                  <a
                    href={item.href}
                    className="transition-colors duration-1 ease-terminal hover:text-accent"
                  >
                    {item.label}
                  </a>
                ) : (
                  <span>{item.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

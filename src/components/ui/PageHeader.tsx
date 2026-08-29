interface BreadcrumbItem {
  label: string
  href?: string
}

interface Props {
  title: string
  subtitle?: string
  breadcrumb?: BreadcrumbItem[]
}

export function PageHeader({ title, subtitle, breadcrumb }: Props) {
  return (
    <div className="page-header">
      {breadcrumb && breadcrumb.length > 0 && (
        <div className="breadcrumb">
          {breadcrumb.map((item, i) => (
            <span key={i}>
              {i > 0 && <span className="sep">/</span>}
              {item.href ? (
                <a href={item.href}>{item.label}</a>
              ) : (
                <span>{item.label}</span>
              )}
            </span>
          ))}
        </div>
      )}
      <h1>{title}</h1>
      {subtitle && <p className="subtitle">{subtitle}</p>}
    </div>
  )
}

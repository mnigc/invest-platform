import type { ReactNode } from 'react'

interface EmptyStateProps {
  title?: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
}

/** 统一空态：原先三个仪表盘各写一套内联 <div style={{padding:40,...}}> */
export function EmptyState({
  title = '暂无数据',
  description,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="text-ink-3">{icon}</div>}
      <div className="text-md text-ink-2">{title}</div>
      {description && (
        <p className="max-w-md text-xs leading-relaxed text-ink-3">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

interface ErrorStateProps {
  message: string
  onRetry?: () => void
}

/** 统一错误态：原先三处各写一套内联样式 */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-down/40 bg-down/10 px-4 py-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="shrink-0 text-down">
          !
        </span>
        <span className="min-w-0 break-words text-sm text-ink">{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors duration-1 ease-terminal hover:border-line-strong hover:bg-surface-2 hover:text-ink"
        >
          重试
        </button>
      )}
    </div>
  )
}

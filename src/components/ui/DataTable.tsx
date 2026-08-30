import type { ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  align?: 'left' | 'right'
  /** 数值列：等宽 + tabular-nums + 右对齐 */
  numeric?: boolean
  render: (row: T, index: number) => ReactNode
  className?: string
}

interface Props<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  /** 首列吸附（横向滚动时保持可见） */
  stickyFirst?: boolean
  caption?: string
  className?: string
}

/**
 * 通用数据表。
 * 自带横向滚动容器（移动端必需），数值列统一等宽数字。
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  stickyFirst = false,
  caption,
  className,
}: Props<T>) {
  const cellTone = (col: Column<T>) =>
    col.numeric ? 'text-right' : col.align === 'right' ? 'text-right' : 'text-left'

  return (
    <div
      className={[
        'overflow-x-auto rounded-lg border border-line bg-surface',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-surface-2">
            {columns.map((col, i) => (
              <th
                key={col.key}
                scope="col"
                className={[
                  'whitespace-nowrap px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-3',
                  cellTone(col),
                  stickyFirst && i === 0 ? 'sticky left-0 z-10 bg-surface-2' : '',
                  col.className,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={rowKey(row, ri)}
              className="border-t border-line transition-colors duration-1 ease-terminal hover:bg-surface-2"
            >
              {columns.map((col, ci) => (
                <td
                  key={col.key}
                  className={[
                    'whitespace-nowrap px-3 py-1.5 align-middle text-ink-2',
                    cellTone(col),
                    col.numeric ? 'num font-medium' : '',
                    stickyFirst && ci === 0 ? 'sticky left-0 z-10 bg-surface' : '',
                    col.className,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {col.render(row, ri)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {caption && <div className="border-t border-line px-3 py-2 text-2xs text-ink-3">{caption}</div>}
    </div>
  )
}

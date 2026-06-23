import { useState } from 'react'

export interface Column {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  render?: (value: any, row: any) => React.ReactNode
  width?: string
}

interface Props {
  columns: Column[]
  data: any[]
  onRowClick?: (row: any) => void
  maxRows?: number
}

export function MacroTable({ columns, data, onRowClick, maxRows = 20 }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const rows = data.slice(0, maxRows)

  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: '12px',
      overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: 'var(--bg-elevated)' }}>
            {columns.map(col => (
              <th key={col.key} style={{
                padding: '10px 16px',
                textAlign: col.align || 'left',
                fontWeight: 500,
                color: 'var(--text-muted)',
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontFamily: 'var(--font-mono)',
                width: col.width,
              }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              onClick={() => onRowClick?.(row)}
              style={{
                cursor: onRowClick ? 'pointer' : 'default',
                transition: 'background 0.15s',
                background: hoveredIdx === i ? 'var(--bg-elevated)' : 'transparent',
              }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '12px 16px',
                  borderTop: `1px solid var(--border-light)`,
                  textAlign: col.align || 'left',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                }}>
                  {col.render ? col.render(row[col.key], row) : row[col.key] ?? '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

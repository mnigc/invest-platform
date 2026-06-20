import { useState } from 'react'
import { THEME } from './theme'

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
      background: THEME.bgCard,
      borderRadius: '12px',
      overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: THEME.bgElevated }}>
            {columns.map(col => (
              <th key={col.key} style={{
                padding: '10px 16px',
                textAlign: col.align || 'left',
                fontWeight: 500,
                color: THEME.textMuted,
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontFamily: THEME.fontMono,
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
                background: hoveredIdx === i ? THEME.bgElevated : 'transparent',
              }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '12px 16px',
                  borderTop: `1px solid ${THEME.borderLight}`,
                  textAlign: col.align || 'left',
                  color: THEME.textSecondary,
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

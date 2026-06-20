import { useState, useMemo } from 'react'
import { useIndicatorData } from '../hooks/useIndicatorData'
import { TimeSeriesChart } from './charts/TimeSeriesChart'
import { BarChart } from './charts/BarChart'
import { PeriodSelector } from './ui/PeriodSelector'
import { MacroBadge } from './ui/MacroBadge'
import { THEME } from './ui/theme'

interface Indicator {
  code: string
  region: string
  name_zh: string
  unit: string
  frequency: string
}

const PERIODS = ['1M', '3M', '6M', '1Y', '5Y', '10Y', 'MAX'] as const
const BAR_CODES = new Set(['GDP', 'RSXFS'])

function getChange(prev: number | null, curr: number | null): number | null {
  if (prev == null || curr == null) return null
  return ((curr - prev) / prev) * 100
}

export default function IndicatorChart({ indicator }: { indicator: Indicator }) {
  const [period, setPeriod] = useState('MAX')
  const [yearly, setYearly] = useState(true)
  const { data, isLoading } = useIndicatorData(indicator.code, period, yearly)

  const isBar = BAR_CODES.has(indicator.code)
  const points = data?.points ?? []

  const tableData = useMemo(() => {
    const sorted = [...points].sort((a, b) => b.period_date.localeCompare(a.period_date))
    return sorted.slice(0, 20).map((row, i, arr) => {
      const prev = i < arr.length - 1 ? arr[i + 1].value : null
      return {
        date: row.period_date,
        value: row.value,
        change: getChange(prev, row.value),
        isEst: row.expected_cnt != null && row.cnt != null && row.cnt < row.expected_cnt,
      }
    })
  }, [points])

  return (
    <div>
      <PeriodSelector
        periods={PERIODS}
        active={period}
        onChange={setPeriod}
        extra={
          <button
            onClick={() => setYearly(y => !y)}
            style={{
              padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
              border: yearly ? `1px solid ${THEME.blue}` : '1px solid transparent',
              background: yearly ? THEME.blueDim : THEME.bgCard,
              color: yearly ? THEME.blue : THEME.textSecondary,
              cursor: 'pointer', fontFamily: THEME.fontDisplay, letterSpacing: '0.03em',
            }}
          >
            {yearly ? '按年度' : '按原始'}
          </button>
        }
      />

      {isBar ? (
        <BarChart data={points} loading={isLoading} name_zh={indicator.name_zh} unit={indicator.unit} />
      ) : (
        <TimeSeriesChart data={points} loading={isLoading} code={indicator.code} name_zh={indicator.name_zh} unit={indicator.unit} showBoomLine />
      )}

      <div style={{ marginTop: '16px', background: THEME.bgCard, borderRadius: '12px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: THEME.bgElevated }}>
              {['日期', '数值', '环比 (%)'].map(h => (
                <th key={h} style={{
                  padding: '10px 16px', textAlign: 'left', fontWeight: 500,
                  color: THEME.textMuted, fontSize: '10px', textTransform: 'uppercase',
                  letterSpacing: '0.08em', fontFamily: THEME.fontMono,
                }}>
                  {yearly ? h.replace('环比', '同比') : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableData.map(row => (
              <tr key={row.date} style={{ transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = THEME.bgElevated)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{
                  padding: '12px 16px', borderTop: `1px solid ${THEME.borderLight}`,
                  color: row.isEst ? THEME.textMuted : THEME.textSecondary,
                  fontStyle: row.isEst ? 'italic' : 'normal', fontSize: '12px',
                }}>
                  {row.date}{row.isEst ? '*' : ''}
                </td>
                <td style={{
                  padding: '12px 16px', borderTop: `1px solid ${THEME.borderLight}`,
                  color: THEME.textPrimary, fontWeight: 500, fontFamily: THEME.fontMono,
                  fontSize: '13px', letterSpacing: '0.02em',
                }}>
                  {row.value != null ? row.value.toFixed(3) : '-'}
                </td>
                <td style={{
                  padding: '12px 16px', borderTop: `1px solid ${THEME.borderLight}`,
                  fontSize: '12px',
                }}>
                  {row.change != null ? (
                    <MacroBadge value={row.change} variant={row.change >= 0 ? 'up' : 'down'} />
                  ) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

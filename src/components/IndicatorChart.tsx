import { useEffect, useMemo, useState } from 'react'
import { TimeSeriesChart } from './charts/TimeSeriesChart'
import { BarChart } from './charts/BarChart'
import { PeriodSelector } from './ui/PeriodSelector'
import { THEME } from './ui/theme'
import { MacroBadge } from './ui/MacroBadge'

interface Indicator {
  code: string
  region: string
  name_zh: string
  unit: string
  frequency: string
}

interface DataPoint {
  period_date: string
  value: number
  cnt?: number
  expected_cnt?: number
}

const PERIODS = ['1M', '3M', '6M', '1Y', '5Y', '10Y', 'MAX'] as const
const BAR_CODES = new Set(['GDP', 'RSXFS'])

function getChange(prev: number | null, curr: number | null): number | null {
  if (prev == null || curr == null || prev === 0) return null
  return ((curr - prev) / prev) * 100
}

function useIndicatorPoints(code: string, region: string, period: string, yearly: boolean) {
  const [points, setPoints] = useState<DataPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!code || !region) return
    const qp = new URLSearchParams()
    qp.set('period', period)
    qp.set('yearly', String(yearly))
    setLoading(true)
    fetch(`/api/v1/indicators/${region}/${code}.json?${qp}`, {
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) {
          if (json && json.success && json.data && Array.isArray(json.data.points)) {
            setPoints(json.data.points)
          } else {
            setPoints([])
          }
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [code, region, period, yearly])

  return { points, loading }
}

export default function IndicatorChart({ indicator, showTable = true }: { indicator: Indicator; showTable?: boolean }) {
  const [period, setPeriod] = useState('MAX')
  // GDP 默认按年度，其他指标默认按原始
  const [yearly, setYearly] = useState(indicator.code === 'GDP')
  const { points, loading } = useIndicatorPoints(indicator.code, indicator.region, period, yearly)

  const isBar = BAR_CODES.has(indicator.code)

  const tableData = useMemo(() => {
    const sorted = [...points].sort((a, b) => a.period_date.localeCompare(b.period_date))
    let prev: number | null = null
    const rows = sorted.map(p => {
      const row = {
        date: p.period_date,
        value: p.value,
        isEst: !!(p.cnt && p.cnt < 1),
        change: getChange(prev, p.value),
      }
      prev = p.value
      return row
    })
    return rows.reverse()
  }, [points])

  return (
    <div>
      <PeriodSelector
        periods={PERIODS}
        active={period}
        onChange={setPeriod}
        extra={
          <div
            role="tablist"
            style={{
              display: 'inline-flex',
              borderRadius: '8px',
              background: THEME.bgCard,
              border: `1px solid ${THEME.borderLight}`,
              padding: '3px',
              gap: '2px',
            }}
          >
            {([
              { key: false, label: '按原始' },
              { key: true, label: '按年度' },
            ] as const).map((opt) => {
              const active = yearly === opt.key
              return (
                <button
                  key={String(opt.key)}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setYearly(opt.key)}
                  style={{
                    padding: '5px 14px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    fontFamily: THEME.fontDisplay,
                    letterSpacing: '0.03em',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    background: active ? THEME.blue : 'transparent',
                    color: active ? THEME.textPrimary : THEME.textSecondary,
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        }
      />

      {isBar ? (
        <BarChart data={points} loading={loading} name_zh={indicator.name_zh} unit={indicator.unit} />
      ) : (
        <TimeSeriesChart
          data={points}
          loading={loading}
          code={indicator.code}
          name_zh={indicator.name_zh}
          unit={indicator.unit}
          showBoomLine
        />
      )}

      {showTable && (
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
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={'loading-' + i}>
                    <td colSpan={3} style={{ padding: '12px 16px', borderTop: `1px solid ${THEME.borderLight}` }}>
                      <div style={{
                        height: '12px',
                        background: `linear-gradient(90deg, ${THEME.bgCard} 25%, ${THEME.bgElevated} 50%, ${THEME.bgCard} 75%)`,
                        backgroundSize: '200% 100%',
                        animation: 'shimmer 1.5s ease-in-out infinite',
                        borderRadius: '4px',
                        width: 40 + (i * 13) % 60 + '%',
                      }} />
                    </td>
                  </tr>
                ))
              ) : tableData.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: '40px 16px', textAlign: 'center', color: THEME.textMuted, fontSize: '13px' }}>
                    暂无数据
                  </td>
                </tr>
              ) : (
                tableData.map((row) => (
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
                      {row.value != null ? Number(row.value).toFixed(3) : '-'}
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
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

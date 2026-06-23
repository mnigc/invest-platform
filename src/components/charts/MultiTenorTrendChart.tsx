import { useMemo, useState } from 'react'
import { useChart } from './useChart'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { useChartTheme } from '../ui/theme'

interface SeriesPoint {
  date: string
  value: number
}

interface BondSeries {
  code: string
  name_zh: string
  maturity: string
  latest: SeriesPoint | null
  previous: SeriesPoint | null
  change: number | null
  history: SeriesPoint[]
}

interface Props {
  series: BondSeries[]
  loading?: boolean
  height?: number
}

const DEFAULT_TENORS = ['2Y', '5Y', '10Y', '30Y']
const ALL_TENORS = ['1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y']

export function MultiTenorTrendChart({ series, loading, height = 340 }: Props) {
  const chartTheme = useChartTheme()
  const TENOR_COLORS: Record<string, string> = {
    '1M': chartTheme.purple,
    '3M': chartTheme.purple,
    '6M': chartTheme.pink,
    '1Y': chartTheme.pink,
    '2Y': chartTheme.red,
    '3Y': chartTheme.gold,
    '5Y': chartTheme.cyan,
    '7Y': chartTheme.green,
    '10Y': chartTheme.blue,
    '20Y': chartTheme.orange,
    '30Y': chartTheme.green,
  }
  const [selected, setSelected] = useState<string[]>(DEFAULT_TENORS)

  const { ref } = useChart(
    useMemo(() => {
      const picked = series.filter((s) => selected.includes(s.maturity))
      if (picked.length === 0) return null

      const dateSet = new Set<string>()
      picked.forEach((s) => s.history.forEach((p) => dateSet.add(p.date)))
      const dates = Array.from(dateSet).sort()

      return {
        tooltip: {
          trigger: 'axis',
          backgroundColor: chartTheme.bgCard,
          borderColor: chartTheme.borderLight,
          borderWidth: 1,
          textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
          valueFormatter: (v: any) => (v == null ? '--' : Number(v).toFixed(3) + '%'),
        },
        legend: {
          data: picked.map((s) => s.maturity),
          textStyle: { color: chartTheme.textSecondary, fontSize: 11 },
          top: 0,
        },
        grid: { left: 55, right: 20, top: 40, bottom: 56 },
        xAxis: {
          type: 'category',
          data: dates,
          axisLabel: { color: chartTheme.textMuted, fontSize: 10 },
          axisLine: { lineStyle: { color: chartTheme.borderColor } },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          axisLabel: {
            color: chartTheme.textMuted,
            fontSize: 11,
            formatter: '{value}%',
          },
          splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } },
        },
        dataZoom: [
          {
            type: 'slider', start: 70, end: 100, height: 18, bottom: 14,
            borderColor: chartTheme.borderColor, backgroundColor: chartTheme.bgCard,
            fillerColor: chartTheme.blueDim,
            handleIcon: 'path://M0,0 v9h9v-9H0z M-11,-1 h22v11 h-22 Z M-11,10 h22v11 h-22 Z',
            handleSize: '80%',
            handleStyle: { color: chartTheme.blue, borderColor: chartTheme.blue },
          },
        ],
        series: picked.map((s) => {
          const map = new Map(s.history.map((p) => [p.date, p.value]))
          return {
            type: 'line',
            name: s.maturity,
            data: dates.map((d) => map.get(d) ?? null),
            smooth: true,
            showSymbol: false,
            connectNulls: false,
            lineStyle: { width: 2, color: TENOR_COLORS[s.maturity] || chartTheme.cyan },
            emphasis: { focus: 'series' },
          }
        }),
      } as any
    }, [series, selected, chartTheme]),
    [series, selected, chartTheme],
  )

  if (loading) return <LoadingSkeleton type="chart" height={height} />
  if (!series || series.length === 0)
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
        NO DATA
      </div>
    )

  const toggle = (mat: string) => {
    setSelected((prev) =>
      prev.includes(mat) ? prev.filter((m) => m !== mat) : [...prev, mat].sort((a, b) => ALL_TENORS.indexOf(a) - ALL_TENORS.indexOf(b)),
    )
  }

  return (
    <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0' }}>
      {/* 期限选择器 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '0 12px 8px' }}>
        {series.map((s) => {
          const active = selected.includes(s.maturity)
          const color = TENOR_COLORS[s.maturity] || 'var(--accent-cyan)'
          return (
            <button
              key={s.maturity}
              onClick={() => toggle(s.maturity)}
              style={{
                padding: '3px 10px',
                fontSize: '11px',
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                borderRadius: '6px',
                cursor: 'pointer',
                border: `1px solid ${active ? color : 'var(--border-light)'}`,
                background: active ? `${color}20` : 'transparent',
                color: active ? color : 'var(--text-muted)',
                transition: 'all 0.15s ease',
              }}
            >
              {s.maturity}
            </button>
          )
        })}
      </div>
      <div ref={ref} style={{ width: '100%', height: `${height}px` }} />
    </div>
  )
}

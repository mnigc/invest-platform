import { useMemo, useState } from 'react'
import { useChart } from './useChart'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { THEME } from '../ui/theme'

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

// 默认选中的关键期限
const DEFAULT_TENORS = ['2Y', '5Y', '10Y', '30Y']
// 可选期限
const ALL_TENORS = ['1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y']

const TENOR_COLORS: Record<string, string> = {
  '1M': '#A855F7',
  '3M': '#A855F7',
  '6M': '#EC4899',
  '1Y': '#EC4899',
  '2Y': THEME.red,
  '3Y': THEME.gold,
  '5Y': THEME.cyan,
  '7Y': '#84CC16',
  '10Y': THEME.blue,
  '20Y': '#F97316',
  '30Y': THEME.green,
}

export function MultiTenorTrendChart({ series, loading, height = 340 }: Props) {
  const [selected, setSelected] = useState<string[]>(DEFAULT_TENORS)

  const { ref } = useChart(
    useMemo(() => {
      // 只取选中的期限
      const picked = series.filter((s) => selected.includes(s.maturity))
      if (picked.length === 0) return null

      // 收集所有日期（取并集，按升序）
      const dateSet = new Set<string>()
      picked.forEach((s) => s.history.forEach((p) => dateSet.add(p.date)))
      const dates = Array.from(dateSet).sort()

      return {
        tooltip: {
          trigger: 'axis',
          backgroundColor: THEME.bgCard,
          borderColor: THEME.borderLight,
          borderWidth: 1,
          textStyle: { color: THEME.textPrimary, fontSize: 12 },
          valueFormatter: (v: any) => (v == null ? '--' : Number(v).toFixed(3) + '%'),
        },
        legend: {
          data: picked.map((s) => s.maturity),
          textStyle: { color: THEME.textSecondary, fontSize: 11 },
          top: 0,
        },
        grid: { left: 55, right: 20, top: 40, bottom: 30 },
        xAxis: {
          type: 'category',
          data: dates,
          axisLabel: { color: THEME.textMuted, fontSize: 10 },
          axisLine: { lineStyle: { color: THEME.borderColor } },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          axisLabel: {
            color: THEME.textMuted,
            fontSize: 11,
            formatter: '{value}%',
          },
          splitLine: { lineStyle: { color: THEME.borderColor, type: 'dashed' } },
        },
        series: picked.map((s) => {
          const map = new Map(s.history.map((p) => [p.date, p.value]))
          return {
            type: 'line',
            name: s.maturity,
            data: dates.map((d) => map.get(d) ?? null),
            smooth: true,
            showSymbol: false,
            connectNulls: false,
            lineStyle: { width: 2, color: TENOR_COLORS[s.maturity] || THEME.cyan },
            emphasis: { focus: 'series' },
          }
        }),
      } as any
    }, [series, selected]),
    [series, selected],
  )

  if (loading) return <LoadingSkeleton type="chart" height={height} />
  if (!series || series.length === 0)
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: THEME.textMuted, fontSize: '13px' }}>
        NO DATA
      </div>
    )

  const toggle = (mat: string) => {
    setSelected((prev) =>
      prev.includes(mat) ? prev.filter((m) => m !== mat) : [...prev, mat].sort((a, b) => ALL_TENORS.indexOf(a) - ALL_TENORS.indexOf(b)),
    )
  }

  return (
    <div style={{ width: '100%', background: THEME.bgCard, borderRadius: '12px', padding: '12px 0' }}>
      {/* 期限选择器 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '0 12px 8px' }}>
        {series.map((s) => {
          const active = selected.includes(s.maturity)
          const color = TENOR_COLORS[s.maturity] || THEME.cyan
          return (
            <button
              key={s.maturity}
              onClick={() => toggle(s.maturity)}
              style={{
                padding: '3px 10px',
                fontSize: '11px',
                fontWeight: 600,
                fontFamily: THEME.fontMono,
                borderRadius: '6px',
                cursor: 'pointer',
                border: `1px solid ${active ? color : THEME.borderLight}`,
                background: active ? `${color}20` : 'transparent',
                color: active ? color : THEME.textMuted,
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

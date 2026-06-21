import { useMemo } from 'react'
import { useChart } from './useChart'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { THEME } from '../ui/theme'

interface FactorPoint {
  date: string
  level: number | null
  slope: number | null
  curvature: number | null
}

interface Props {
  history: FactorPoint[]
  loading?: boolean
  height?: number
}

export function CurveDynamicsChart({ history, loading, height = 320 }: Props) {
  const { ref } = useChart(
    useMemo(() => {
      if (!history || history.length === 0) return null

      const dates = history.map((h) => h.date)

      return {
        tooltip: {
          trigger: 'axis',
          backgroundColor: THEME.bgCard,
          borderColor: THEME.borderLight,
          borderWidth: 1,
          textStyle: { color: THEME.textPrimary, fontSize: 12 },
          valueFormatter: (v: any) => (v == null ? '--' : Number(v).toFixed(3)),
        },
        legend: {
          data: ['水平 (Level β₀)', '斜率 (Slope β₁)', '曲率 (Curvature β₂)'],
          textStyle: { color: THEME.textSecondary, fontSize: 11 },
          top: 0,
        },
        grid: { left: 50, right: 20, top: 40, bottom: 30 },
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
            formatter: (v: any) => (typeof v === 'number' ? v.toFixed(2) : v),
          },
          splitLine: { lineStyle: { color: THEME.borderColor, type: 'dashed' } },
        },
        series: [
          {
            type: 'line',
            name: '水平 (Level β₀)',
            data: history.map((h) => h.level),
            smooth: true,
            showSymbol: false,
            lineStyle: { width: 2, color: THEME.blue },
          },
          {
            type: 'line',
            name: '斜率 (Slope β₁)',
            data: history.map((h) => h.slope),
            smooth: true,
            showSymbol: false,
            lineStyle: { width: 2, color: THEME.gold },
          },
          {
            type: 'line',
            name: '曲率 (Curvature β₂)',
            data: history.map((h) => h.curvature),
            smooth: true,
            showSymbol: false,
            lineStyle: { width: 2, color: THEME.cyan },
          },
        ],
      } as any
    }, [history]),
    [history],
  )

  if (loading) return <LoadingSkeleton type="chart" height={height} />
  if (!history || history.length === 0)
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: THEME.textMuted, fontSize: '13px' }}>
        NO DATA
      </div>
    )

  return (
    <div style={{ width: '100%', background: THEME.bgCard, borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: `${height}px` }} />
    </div>
  )
}

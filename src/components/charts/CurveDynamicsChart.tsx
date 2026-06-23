import { useMemo } from 'react'
import { useChart } from './useChart'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { useChartTheme } from '../ui/theme'

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
  const chartTheme = useChartTheme()
  const { ref } = useChart(
    useMemo(() => {
      if (!history || history.length === 0) return null

      const dates = history.map((h) => h.date)

      return {
        tooltip: {
          trigger: 'axis',
          backgroundColor: chartTheme.bgCard,
          borderColor: chartTheme.borderLight,
          borderWidth: 1,
          textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
          valueFormatter: (v: any) => (v == null ? '--' : Number(v).toFixed(3)),
        },
        legend: {
          data: ['水平 (Level β₀)', '斜率 (Slope β₁)', '曲率 (Curvature β₂)'],
          textStyle: { color: chartTheme.textSecondary, fontSize: 11 },
          top: 0,
        },
        grid: { left: 50, right: 20, top: 40, bottom: 30 },
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
            formatter: (v: any) => (typeof v === 'number' ? v.toFixed(2) : v),
          },
          splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } },
        },
        series: [
          {
            type: 'line',
            name: '水平 (Level β₀)',
            data: history.map((h) => h.level),
            smooth: true,
            showSymbol: false,
            lineStyle: { width: 2, color: chartTheme.blue },
          },
          {
            type: 'line',
            name: '斜率 (Slope β₁)',
            data: history.map((h) => h.slope),
            smooth: true,
            showSymbol: false,
            lineStyle: { width: 2, color: chartTheme.gold },
          },
          {
            type: 'line',
            name: '曲率 (Curvature β₂)',
            data: history.map((h) => h.curvature),
            smooth: true,
            showSymbol: false,
            lineStyle: { width: 2, color: chartTheme.cyan },
          },
        ],
      } as any
    }, [history, chartTheme]),
    [history, chartTheme],
  )

  if (loading) return <LoadingSkeleton type="chart" height={height} />
  if (!history || history.length === 0)
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
        NO DATA
      </div>
    )

  return (
    <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: `${height}px` }} />
    </div>
  )
}

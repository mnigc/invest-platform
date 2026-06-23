import { useMemo } from 'react'
import { useChart } from './useChart'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { useChartTheme } from '../ui/theme'

interface CurvePoint {
  maturity: string
  yield: number
}

interface CurveSeries {
  date: string
  points: CurvePoint[]
}

interface Props {
  series: CurveSeries[]
  loading?: boolean
  height?: number
}

export function TreasuryCurveChart({ series, loading, height = 360 }: Props) {
  const chartTheme = useChartTheme()
  const LINE_COLORS = [chartTheme.blue, chartTheme.cyan, chartTheme.gold, chartTheme.green, chartTheme.purple]
  const { ref } = useChart(
    useMemo(() => {
      if (series.length === 0) return null
      const maturities = series[0].points.map(p => p.maturity)

      return {
        tooltip: {
          trigger: 'axis',
          backgroundColor: chartTheme.bgCard, borderColor: chartTheme.borderLight, borderWidth: 1,
          textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
        },
        legend: {
          data: series.map(s => s.date),
          textStyle: { color: chartTheme.textSecondary, fontSize: 11 },
          top: 0,
        },
        grid: { left: 60, right: 20, top: 40, bottom: 30 },
        xAxis: {
          type: 'category',
          data: maturities,
          axisLabel: { color: chartTheme.textMuted, fontSize: 11 },
          axisLine: { lineStyle: { color: chartTheme.borderColor } },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: chartTheme.textMuted, fontSize: 11, formatter: '{value}%' },
          splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } },
        },
        series: series.map((s, i) => ({
          type: 'line',
          name: s.date,
          data: s.points.map(p => p.yield),
          smooth: true,
          showSymbol: true,
          symbolSize: 6,
          lineStyle: { width: 2, color: LINE_COLORS[i % LINE_COLORS.length] },
        })),
      } as echarts.EChartsOption
    }, [series, chartTheme]),
    [series, chartTheme],
  )

  if (loading) return <LoadingSkeleton type="chart" height={height} />
  if (series.length === 0) return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>NO DATA</div>

  return (
    <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: `${height}px` }} />
    </div>
  )
}

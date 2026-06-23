import { useMemo } from 'react'
import { useChart } from './useChart'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { useChartTheme } from '../ui/theme'

interface ScatterPoint {
  x: number
  y: number
  label?: string
  size?: number
}

interface Props {
  data: ScatterPoint[]
  loading?: boolean
  xLabel?: string
  yLabel?: string
  height?: number
}

export function ScatterChart({ data, loading, xLabel, yLabel, height = 360 }: Props) {
  const chartTheme = useChartTheme()
  const { ref } = useChart(
    useMemo(() => {
      if (data.length === 0) return null

      return {
        tooltip: {
          backgroundColor: chartTheme.bgCard, borderColor: chartTheme.borderLight, borderWidth: 1,
          textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
          formatter: (params: any) => {
            const d = params.data
            return `${d[2] || ''}<br/>X: <strong>${Number(d[0]).toFixed(2)}</strong><br/>Y: <strong>${Number(d[1]).toFixed(2)}</strong>`
          },
        },
        grid: { left: 60, right: 20, top: 20, bottom: 50 },
        xAxis: {
          type: 'value', name: xLabel,
          axisLabel: { color: chartTheme.textMuted, fontSize: 11 },
          axisLine: { lineStyle: { color: chartTheme.borderColor } },
          splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } },
          nameTextStyle: { color: chartTheme.textSecondary, fontSize: 11 },
        },
        yAxis: {
          type: 'value', name: yLabel,
          axisLabel: { color: chartTheme.textMuted, fontSize: 11 },
          splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } },
          nameTextStyle: { color: chartTheme.textSecondary, fontSize: 11 },
        },
        series: [{
          type: 'scatter',
          symbolSize: (val: any) => (val[3] || 12),
          data: data.map(d => [d.x, d.y, d.label || '', d.size || 12]),
          itemStyle: { color: chartTheme.blue },
          emphasis: { itemStyle: { color: chartTheme.cyan } },
        }],
      } as echarts.EChartsOption
    }, [data, xLabel, yLabel, chartTheme]),
    [data, xLabel, yLabel, chartTheme],
  )

  if (loading) return <LoadingSkeleton type="chart" height={height} />
  if (data.length === 0) return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>NO DATA</div>

  return (
    <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: `${height}px` }} />
    </div>
  )
}

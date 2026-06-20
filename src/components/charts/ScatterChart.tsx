import { useMemo } from 'react'
import { useChart } from './useChart'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { THEME } from '../ui/theme'

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
  const { ref } = useChart(
    useMemo(() => {
      if (data.length === 0) return null

      return {
        tooltip: {
          backgroundColor: THEME.bgCard, borderColor: THEME.borderLight, borderWidth: 1,
          textStyle: { color: THEME.textPrimary, fontSize: 12 },
          formatter: (params: any) => {
            const d = params.data
            return `${d[2] || ''}<br/>X: <strong>${Number(d[0]).toFixed(2)}</strong><br/>Y: <strong>${Number(d[1]).toFixed(2)}</strong>`
          },
        },
        grid: { left: 60, right: 20, top: 20, bottom: 50 },
        xAxis: {
          type: 'value', name: xLabel,
          axisLabel: { color: THEME.textMuted, fontSize: 11 },
          axisLine: { lineStyle: { color: THEME.borderColor } },
          splitLine: { lineStyle: { color: THEME.borderColor, type: 'dashed' } },
          nameTextStyle: { color: THEME.textSecondary, fontSize: 11 },
        },
        yAxis: {
          type: 'value', name: yLabel,
          axisLabel: { color: THEME.textMuted, fontSize: 11 },
          splitLine: { lineStyle: { color: THEME.borderColor, type: 'dashed' } },
          nameTextStyle: { color: THEME.textSecondary, fontSize: 11 },
        },
        series: [{
          type: 'scatter',
          symbolSize: (val: any) => (val[3] || 12),
          data: data.map(d => [d.x, d.y, d.label || '', d.size || 12]),
          itemStyle: { color: THEME.blue },
          emphasis: { itemStyle: { color: THEME.cyan } },
        }],
      } as echarts.EChartsOption
    }, [data, xLabel, yLabel]),
    [data, xLabel, yLabel],
  )

  if (loading) return <LoadingSkeleton type="chart" height={height} />
  if (data.length === 0) return <div style={{ padding: '40px 0', textAlign: 'center', color: THEME.textMuted, fontSize: '13px' }}>NO DATA</div>

  return (
    <div style={{ width: '100%', background: THEME.bgCard, borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: `${height}px` }} />
    </div>
  )
}

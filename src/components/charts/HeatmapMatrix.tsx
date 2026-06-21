import { useMemo } from 'react'
import { useChart } from './useChart'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { THEME } from '../ui/theme'

interface HeatmapCell {
  row: string
  col: string
  value: number
}

interface Props {
  data: HeatmapCell[]
  loading?: boolean
  title?: string
  height?: number
  min?: number
  max?: number
}

export function HeatmapMatrix({ data, loading, height = 320, min, max }: Props) {
  const { ref } = useChart(
    useMemo(() => {
      if (data.length === 0) return null
      const rows = [...new Set(data.map(d => d.row))]
      const cols = [...new Set(data.map(d => d.col))].sort()
      const vals = data.map(d => d.value)
      const vMin = min ?? Math.min(...vals)
      const vMax = max ?? Math.max(...vals)

      return {
        tooltip: {
          position: 'top',
          backgroundColor: THEME.bgCard, borderColor: THEME.borderLight, borderWidth: 1,
          textStyle: { color: THEME.textPrimary, fontSize: 12 },
          formatter: (params: any) => `${params.data[0]}, ${params.data[1]}: <strong>${Number(params.data[2]).toFixed(2)}</strong>`,
        },
        grid: { left: 80, right: 20, top: 50, bottom: 50 },
        xAxis: { type: 'category', data: cols, position: 'top', axisLabel: { color: THEME.textMuted, fontSize: 10, rotate: 45 }, splitArea: { show: true, areaStyle: { color: [THEME.bgCard, THEME.bgElevated] } } },
        yAxis: { type: 'category', data: rows, axisLabel: { color: THEME.textSecondary, fontSize: 10 }, splitArea: { show: true, areaStyle: { color: [THEME.bgCard, THEME.bgElevated] } } },
        visualMap: { min: vMin, max: vMax, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: [THEME.green, THEME.bgCard, THEME.red] }, textStyle: { color: THEME.textMuted } },
        series: [{ type: 'heatmap', data: data.map(d => [d.col, d.row, d.value]), label: { show: true, color: THEME.textPrimary, fontSize: 10 }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } } }],
      } as echarts.EChartsOption
    }, [data, min, max]),
    [data, min, max],
  )

  if (loading) return <LoadingSkeleton type="chart" height={height} />
  if (data.length === 0) return <div style={{ padding: '40px 0', textAlign: 'center', color: THEME.textMuted, fontSize: '13px' }}>NO DATA</div>

  return (
    <div style={{ width: '100%', background: THEME.bgCard, borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: `${height}px` }} />
    </div>
  )
}

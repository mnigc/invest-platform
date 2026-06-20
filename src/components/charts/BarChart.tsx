import { useMemo } from 'react'
import { useChart } from './useChart'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { THEME } from '../ui/theme'

interface DataPoint {
  period_date: string
  value: number
  cnt?: number
  expected_cnt?: number
}

interface Props {
  data: DataPoint[]
  loading?: boolean
  name_zh?: string
  unit?: string
  height?: number
}

export function BarChart({ data, loading, name_zh, unit, height = 360 }: Props) {
  const { ref } = useChart(
    useMemo(() => {
      if (data.length === 0) return null
      const isIncomplete = data.map((d, i) => d.expected_cnt != null && d.cnt != null && d.cnt < d.expected_cnt && i === data.length - 1)
      const series: any[] = [{
        type: 'bar', name: name_zh,
        data: data.map((d, i) => isIncomplete[i] ? null : d.value),
        itemStyle: { color: THEME.blue, borderRadius: [2, 2, 0, 0] },
        barWidth: '50%',
      }]
      if (isIncomplete.some(Boolean)) {
        series.push({
          type: 'bar', name: `${name_zh} (预测)`,
          data: data.map((d, i) => isIncomplete[i] ? d.value : null),
          itemStyle: { color: 'transparent', borderColor: THEME.blue, borderWidth: 2, borderType: 'dashed', borderRadius: [2, 2, 0, 0] },
          barWidth: '50%', barGap: '-100%', z: 10,
        })
      }

      return {
        tooltip: {
          trigger: 'axis',
          backgroundColor: THEME.bgCard, borderColor: THEME.borderLight, borderWidth: 1,
          textStyle: { color: THEME.textPrimary, fontSize: 12 },
          formatter: (params: any) => {
            const arr = Array.isArray(params) ? params : [params]
            const p = arr.find((p: any) => p.value != null) || arr[0]
            if (!p || p.value == null) return ''
            return `${p.axisValue}<br/><strong style="color:${THEME.blue}">${Number(p.value).toFixed(3)}</strong> ${unit || ''}`
          },
        },
        grid: { left: 60, right: 20, top: 20, bottom: 30 },
        xAxis: { type: 'category', data: data.map(d => d.period_date), axisLabel: { color: THEME.textMuted, fontSize: 11 }, axisLine: { lineStyle: { color: THEME.borderColor } }, splitLine: { show: false } },
        yAxis: { type: 'value', axisLabel: { color: THEME.textMuted, fontSize: 11, formatter: (v: any) => (typeof v === 'number' ? v : parseFloat(v)).toFixed(3) }, splitLine: { lineStyle: { color: THEME.borderColor, type: 'dashed' } } },
        series,
      } as echarts.EChartsOption
    }, [data, name_zh, unit]),
    [data, name_zh, unit],
  )

  if (loading) return <LoadingSkeleton type="chart" height={height} />
  if (data.length === 0) return <div style={{ padding: '40px 0', textAlign: 'center', color: THEME.textMuted, fontSize: '13px' }}>NO DATA</div>

  return (
    <div style={{ width: '100%', background: THEME.bgCard, borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: `${height}px` }} />
    </div>
  )
}

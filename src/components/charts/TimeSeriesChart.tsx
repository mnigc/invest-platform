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
  code?: string
  name_zh?: string
  unit?: string
  height?: number
  showBoomLine?: boolean
}

export function TimeSeriesChart({ data, loading, code, name_zh, unit, height = 360, showBoomLine }: Props) {
  const { ref } = useChart(
    useMemo(() => {
      if (data.length === 0) return null
      const isIncomplete = data.map((d, i) => d.expected_cnt != null && d.cnt != null && d.cnt < d.expected_cnt && i === data.length - 1)
      const series: any[] = []

      if (isIncomplete.some(Boolean)) {
        const lastComplete = isIncomplete.lastIndexOf(false)
        series.push({
          type: 'line', name: name_zh,
          data: data.map((d, i) => i > lastComplete ? null : d.value),
          smooth: true, showSymbol: false,
          lineStyle: { width: 2, color: THEME.cyan },
          areaStyle: { color: THEME.blueArea },
        })
        series.push({
          type: 'line', name: `${name_zh} (预测)`,
          data: data.map((d, i) => i < lastComplete ? null : d.value),
          smooth: true, showSymbol: false,
          lineStyle: { width: 2, type: 'dashed', color: THEME.cyan },
          connectNulls: true,
        })
      } else {
        series.push({
          type: 'line', name: name_zh,
          data: data.map(d => d.value),
          smooth: true, showSymbol: false,
          lineStyle: { width: 2, color: THEME.cyan },
          areaStyle: { color: THEME.blueArea },
        })
      }

      if (showBoomLine && code === 'PMI') {
        series.push({
          type: 'line',
          data: data.map(() => 50),
          lineStyle: { color: '#EF4444', width: 1, type: 'dashed' },
          showSymbol: false, name: '荣枯线',
        })
      }

      return {
        tooltip: {
          trigger: 'axis',
          backgroundColor: THEME.bgCard, borderColor: THEME.borderLight, borderWidth: 1,
          textStyle: { color: THEME.textPrimary, fontSize: 12 },
          formatter: (params: any) => {
            const arr = Array.isArray(params) ? params : [params]
            const p = arr.find((p: any) => p.value != null && (!name_zh || p.seriesName === name_zh)) || arr.find((p: any) => p.value != null)
            if (!p) return ''
            return `${p.axisValue}<br/>${code || ''}: <strong style="color:${THEME.cyan}">${Number(p.value).toFixed(3)}</strong> ${unit || ''}`
          },
        },
        grid: { left: 60, right: 20, top: 20, bottom: 30 },
        xAxis: { type: 'category', data: data.map(d => d.period_date), axisLabel: { color: THEME.textMuted, fontSize: 11 }, axisLine: { lineStyle: { color: THEME.borderColor } }, splitLine: { show: false } },
        yAxis: { type: 'value', axisLabel: { color: THEME.textMuted, fontSize: 11, formatter: (v: any) => (typeof v === 'number' ? v : parseFloat(v)).toFixed(3) }, splitLine: { lineStyle: { color: THEME.borderColor, type: 'dashed' } } },
        series,
      } as echarts.EChartsOption
    }, [data, code, name_zh, unit, showBoomLine]),
    [data, code, name_zh, unit, showBoomLine],
  )

  if (loading) return <LoadingSkeleton type="chart" height={height} />
  if (data.length === 0) return <div style={{ padding: '40px 0', textAlign: 'center', color: THEME.textMuted, fontSize: '13px' }}>NO DATA</div>

  return (
    <div style={{ width: '100%', background: THEME.bgCard, borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: `${height}px` }} />
    </div>
  )
}

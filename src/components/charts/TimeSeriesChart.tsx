import { useEffect, useMemo, useRef } from 'react'
import echarts from '../../lib/echarts'
import type { EChartsOption } from 'echarts'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { useChartTheme } from '../ui/theme'

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
  const chartTheme = useChartTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)

  const option = useMemo<EChartsOption | null>(() => {
    if (!data || data.length === 0) return null
    const isIncomplete = data.map((d, i) => d.expected_cnt != null && d.cnt != null && d.cnt < d.expected_cnt && i === data.length - 1)
    const series: any[] = []

    if (isIncomplete.some(Boolean)) {
      const lastComplete = isIncomplete.lastIndexOf(false)
      series.push({
        type: 'line', name: name_zh,
        data: data.map((d, i) => i > lastComplete ? null : d.value),
        smooth: true, showSymbol: false,
        lineStyle: { width: 2, color: chartTheme.cyan },
        areaStyle: { color: chartTheme.blueArea },
      })
      series.push({
        type: 'line', name: `${name_zh} (预测)`,
        data: data.map((d, i) => i < lastComplete ? null : d.value),
        smooth: true, showSymbol: false,
        lineStyle: { width: 2, type: 'dashed', color: chartTheme.cyan },
        connectNulls: true,
      })
    } else {
      series.push({
        type: 'line', name: name_zh,
        data: data.map(d => d.value),
        smooth: true, showSymbol: false,
        lineStyle: { width: 2, color: chartTheme.cyan },
        areaStyle: { color: chartTheme.blueArea },
      })
    }

    const mainSeries = series[0]
    if (showBoomLine && mainSeries) {
      mainSeries.markLine = {
        symbol: ['none', 'none'], animation: false,
        data: [{ yAxis: 50 }],
        lineStyle: { color: chartTheme.red, width: 1.5, type: 'dashed' },
        label: { show: true, position: 'insideEndTop', formatter: '50 荣枯线', color: chartTheme.red, fontSize: 10, fontWeight: 600 },
      }
    }

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: chartTheme.bgCard, borderColor: chartTheme.borderLight, borderWidth: 1,
        textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
        formatter: (params: any) => {
          const arr = Array.isArray(params) ? params : [params]
          const p = arr.find((p: any) => p.value != null && (!name_zh || p.seriesName === name_zh)) || arr.find((p: any) => p.value != null)
          if (!p) return ''
          return `${p.axisValue}<br/>${code || ''}: <strong style="color:${chartTheme.cyan}">${Number(p.value).toFixed(3)}</strong> ${unit || ''}`
        },
      },
      grid: { left: 60, right: 20, top: 20, bottom: 30 },
      xAxis: { type: 'category', data: data.map(d => d.period_date), axisLabel: { color: chartTheme.textMuted, fontSize: 11 }, axisLine: { lineStyle: { color: chartTheme.borderColor } }, splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, axisLabel: { color: chartTheme.textMuted, fontSize: 11, formatter: (v: any) => (typeof v === 'number' ? v : parseFloat(v)).toFixed(3) }, splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } } },
      series,
    }
  }, [data, code, name_zh, unit, chartTheme, showBoomLine])

  useEffect(() => {
    if (!containerRef.current) return
    if (!chartInstance.current || chartInstance.current.getDom() !== containerRef.current) {
      chartInstance.current?.dispose()
      chartInstance.current = echarts.init(containerRef.current)
    }
    if (option) {
      chartInstance.current.setOption(option, true)
    } else {
      chartInstance.current.clear()
    }
    chartInstance.current.resize()
    const onResize = () => chartInstance.current?.resize()
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(onResize)
    ro.observe(containerRef.current)
    return () => {
      window.removeEventListener('resize', onResize)
      ro.disconnect()
    }
  }, [option, chartTheme])

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose()
      chartInstance.current = null
    }
  }, [])

  if (loading) return <LoadingSkeleton type="chart" height={height} />
  if (data.length === 0) return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>NO DATA</div>

  return (
    <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0', height: `${height}px` }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

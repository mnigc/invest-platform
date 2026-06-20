import { useEffect, useRef, useCallback } from 'react'
import echarts from '../../lib/echarts'
import type { EChartsOption } from 'echarts'

export function useChart(option: EChartsOption | null, deps: any[]) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  const resize = useCallback(() => {
    chartRef.current?.resize()
  }, [])

  useEffect(() => {
    if (!ref.current) return
    if (!chartRef.current) {
      chartRef.current = echarts.init(ref.current)
    }
    if (option) {
      chartRef.current.setOption(option, true)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
    }
  }, deps)

  useEffect(() => {
    return () => {
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  return { ref, resize }
}

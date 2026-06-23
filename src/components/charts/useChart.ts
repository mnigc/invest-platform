import { useEffect, useRef, useCallback } from 'react'
import echarts from '../../lib/echarts'
import type { EChartsOption } from 'echarts'

export function useChart(option: EChartsOption | null, deps: any[]) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  const resize = useCallback(() => {
    chartRef.current?.resize()
  }, [])

  // 初始化图表 + 注册 resize 监听（只在组件挂载/卸载时运行）
  useEffect(() => {
    if (!ref.current) return
    try {
      chartRef.current = echarts.init(ref.current)
      const observer = new ResizeObserver(resize)
      observer.observe(ref.current)
      const onResize = () => chartRef.current?.resize()
      window.addEventListener('resize', onResize)
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', onResize)
        chartRef.current?.dispose()
        chartRef.current = null
      }
    } catch (e) {
      console.warn('[useChart] init failed:', e)
    }
    return undefined
  }, [])

  // 更新图表配置（只在 option 相关 deps 变化时运行）
  useEffect(() => {
    if (chartRef.current && option) {
      try {
        chartRef.current.setOption(option, true)
      } catch (e) {
        console.warn('[useChart] setOption failed:', e)
      }
    }
  }, deps)

  return { ref, resize }
}

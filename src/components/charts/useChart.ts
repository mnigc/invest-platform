import { useCallback, useEffect, useRef } from 'react'
import echarts from '../../lib/echarts'
import type { EChartsOption } from 'echarts'

/**
 * ECharts 生命周期封装。
 *
 * 注意 setOption 的第二个参数：
 * - 原先传 true（notMerge）会整体重建图表，动画被重置、dataZoom 状态丢失，
 *   而调用方每次 render 都新建 option 对象，导致图表在每次渲染时反复全量重建。
 * - 这里改为 replaceMerge: ['series'] —— 保留实例与坐标轴（dataZoom 得以延续），
 *   只替换 series，避免序列数量变化时残留旧序列。
 *
 * 调用方仍需用 useMemo 缓存 option，否则每次渲染都会触发 setOption。
 */
export function useChart(option: EChartsOption | null, deps: unknown[] = []) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  const resize = useCallback(() => {
    chartRef.current?.resize()
  }, [])

  // 初始化 + resize 监听（仅挂载/卸载时运行）
  useEffect(() => {
    if (!ref.current) return
    try {
      chartRef.current = echarts.init(ref.current)
    } catch (e) {
      console.warn('[useChart] init failed:', e)
      return
    }

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
  }, [resize])

  // 更新配置
  useEffect(() => {
    if (!chartRef.current || !option) return
    try {
      chartRef.current.setOption(option, { replaceMerge: ['series'] })
    } catch (e) {
      console.warn('[useChart] setOption failed:', e)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { ref, resize }
}

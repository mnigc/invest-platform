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
 *
 * 初始化时机：延后到容器接近视口时（IntersectionObserver，rootMargin 400px）。
 * 仪表盘同帧 init 3+ 个图表会把主线程卡出长任务（首屏滚动掉帧），
 * 视口外的图表滚到附近再建，首屏工作量大减、滚动全程顺畅。
 */
export function useChart(option: EChartsOption | null, deps: unknown[] = []) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const firstDrawRef = useRef(true)
  const optionRef = useRef<EChartsOption | null>(null)
  const teardownRef = useRef<(() => void) | null>(null)

  const applyOption = useCallback((first: boolean) => {
    const chart = chartRef.current
    const opt = optionRef.current
    if (!chart || !opt) return
    try {
      // 首次 setOption 禁用入场动画：骨架屏换成图表本身就带"又加载了一次"的观感，
      // 再叠加从左到右画线的动画，加载感翻倍。首帧直接呈现完整图表。
      // merge 语义下 animation:false 会保留，后续数据/主题更新也瞬时完成，同属预期。
      chart.setOption(first ? { ...opt, animation: false } : opt, { replaceMerge: ['series'] })
    } catch (e) {
      console.warn('[useChart] setOption failed:', e)
    }
  }, [])

  // 更新配置
  useEffect(() => {
    optionRef.current = option
    if (!chartRef.current || !option) return
    applyOption(firstDrawRef.current)
    firstDrawRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // 初始化（延后到接近视口时）
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let disposed = false

    const boot = () => {
      if (disposed || chartRef.current || !el.isConnected) return
      try {
        chartRef.current = echarts.init(el)
      } catch (e) {
        console.warn('[useChart] init failed:', e)
        return
      }
      const onResize = () => chartRef.current?.resize()
      const ro = new ResizeObserver(onResize)
      ro.observe(el)
      window.addEventListener('resize', onResize)
      teardownRef.current = () => {
        ro.disconnect()
        window.removeEventListener('resize', onResize)
        chartRef.current?.dispose()
        chartRef.current = null
      }
      // 数据可能先于滚动到达：启动时把当前已有的 option 一次性画上
      applyOption(firstDrawRef.current)
      firstDrawRef.current = false
    }

    if (typeof IntersectionObserver === 'undefined') {
      boot()
      return () => {
        disposed = true
        teardownRef.current?.()
        teardownRef.current = null
      }
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          boot()
        }
      },
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => {
      disposed = true
      io.disconnect()
      teardownRef.current?.()
      teardownRef.current = null
    }
  }, [])

  const resize = useCallback(() => {
    chartRef.current?.resize()
  }, [])

  return { ref, resize }
}

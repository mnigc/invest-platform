import type { EChartsOption } from 'echarts'
import { useChart } from './useChart'

interface Props {
  option: EChartsOption | null
  /** 像素高度 */
  height?: number
  className?: string
  /** 用于 useChart 的依赖数组，调用方应传 [option] */
  deps?: unknown[]
}

/**
 * 图表容器。集中处理尺寸与圆角，避免每个仪表盘各写一遍内联样式。
 * 调用方负责用 useMemo 缓存 option。
 */
export function ChartBox({ option, height = 320, className, deps }: Props) {
  const { ref } = useChart(option, deps ?? [option])
  return (
    <div
      ref={ref}
      className={['w-full overflow-hidden', className].filter(Boolean).join(' ')}
      style={{ height: `${height}px` }}
    />
  )
}

/**
 * 响应式高度：移动端矮一些，桌面端正常。
 * 用 CSS 类而非内联 height，让 ResizeObserver 自然跟随。
 */
export function ResponsiveChartBox({
  option,
  className,
  deps,
}: Omit<Props, 'height'>) {
  const { ref } = useChart(option, deps ?? [option])
  return (
    <div
      ref={ref}
      className={[
        'h-[260px] w-full overflow-hidden sm:h-[320px] lg:h-[380px]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  )
}

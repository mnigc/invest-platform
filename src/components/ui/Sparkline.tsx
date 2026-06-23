import { useEffect, useRef } from 'react'
import echarts from '../../lib/echarts'
import { useChartTheme } from './theme'

interface Props {
  data: number[]
  color?: string
  height?: number
  width?: number
}

export function Sparkline({ data, color, height = 40, width }: Props) {
  const chartTheme = useChartTheme()
  const lineColor = color || chartTheme.cyan
  const ref = useRef<HTMLDivElement>(null)
  const containerStyle: React.CSSProperties = { height, width: width || '100%' }

  useEffect(() => {
    if (!ref.current || data.length === 0) return
    const chart = echarts.init(ref.current)
    chart.setOption({
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: { show: false, type: 'category', data },
      yAxis: { show: false },
      series: [{
        type: 'line',
        data,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, color: lineColor },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: chartTheme.cyanDim }, { offset: 1, color: 'transparent' }] } },
      }],
      animation: false,
    })
    const handleResize = () => chart.resize()
    const observer = new ResizeObserver(handleResize)
    observer.observe(ref.current)
    return () => { chart.dispose(); observer.disconnect() }
  }, [data, lineColor, chartTheme])

  if (data.length === 0) return <div style={containerStyle} />

  return <div ref={ref} style={containerStyle} />
}

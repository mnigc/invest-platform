import { useMemo } from 'react'
import { useChart } from './charts/useChart'
import { LoadingSkeleton } from './ui/LoadingSkeleton'
import { useChartTheme } from './ui/theme'

interface CurvePoint {
  contract: string
  month: string
  price: number | null
  change: number | null
}

interface Props {
  curve: CurvePoint[]
  prevCurve?: CurvePoint[]
  commodityName: string
  loading?: boolean
  height?: number
}

export function CommodityCurveChart({ curve, prevCurve, commodityName, loading, height = 360 }: Props) {
  const chartTheme = useChartTheme()
  const CURVE_COLOR = chartTheme.cyan
  const { ref } = useChart(
    useMemo(() => {
      if (curve.length === 0) return null

      const labels = curve.map((_, i) => `M${i + 1}`)
      const prices = curve.map(p => p.price)

      const series: any[] = [{
        type: 'line',
        name: '当前曲线',
        data: prices,
        smooth: true,
        showSymbol: true,
        symbolSize: 6,
        lineStyle: { width: 2.5, color: CURVE_COLOR },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
            { offset: 0, color: chartTheme.cyanDim },
            { offset: 1, color: 'transparent' },
          ]},
        },
      }]

      if (prevCurve && prevCurve.length > 0) {
        const prevPrices = prevCurve.map(p => p.price)
        series.push({
          type: 'line',
          name: '前一交易日',
          data: prevPrices,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 1.5, color: chartTheme.cyanDim, type: 'dashed' as const },
        })
      }

      return {
        tooltip: {
          trigger: 'axis',
          backgroundColor: chartTheme.bgCard,
          borderColor: chartTheme.borderLight,
          borderWidth: 1,
          textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
          formatter: (params: any) => {
            if (!Array.isArray(params)) return ''
            const idx = params[0].dataIndex
            const point = curve[idx]
            if (!point) return ''
            let html = `<div style="font-weight:600;margin-bottom:4px">${commodityName} · M${idx + 1}</div>`
            html += `<div style="color:${chartTheme.textSecondary};font-size:11px">合约: ${point.contract} (${point.month})</div>`
            params.forEach((p: any) => {
              if (p.value == null) return
              html += `<div style="color:${p.color}">${p.marker} ${p.seriesName}: <b>${Number(p.value).toFixed(2)}</b></div>`
            })
            if (point.change != null) {
              const up = point.change >= 0
              const color = up ? chartTheme.green : chartTheme.red
              html += `<div style="color:${color};font-size:11px;margin-top:2px">日变动: ${up ? '+' : ''}${point.change.toFixed(2)}%</div>`
            }
            return html
          },
        },
        legend: {
          data: series.map((s: any) => s.name),
          textStyle: { color: chartTheme.textSecondary, fontSize: 11 },
          top: 0,
        },
        grid: { left: 60, right: 20, top: 40, bottom: 30 },
        xAxis: {
          type: 'category',
          data: labels,
          axisLabel: { color: chartTheme.textMuted, fontSize: 11 },
          axisLine: { lineStyle: { color: chartTheme.borderColor } },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: chartTheme.textMuted, fontSize: 11 },
          splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } },
        },
        series,
      } as any
    }, [curve, prevCurve, commodityName, chartTheme]),
    [curve, prevCurve, commodityName, chartTheme],
  )

  if (loading) return <LoadingSkeleton type="chart" height={height} />
  if (curve.length === 0) return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>暂无数据</div>

  return (
    <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: `${height}px` }} />
    </div>
  )
}

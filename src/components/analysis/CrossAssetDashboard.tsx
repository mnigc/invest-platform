import { useMemo, useState, useEffect } from 'react'
import type { EChartsOption } from 'echarts'
import { ResponsiveChartBox } from '../charts/ChartBox'
import { useChartTheme } from '../ui/theme'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { EmptyState, ErrorState } from '../ui/States'
import { MacroCard } from '../ui/MacroCard'
import { StatTile } from '../ui/StatTile'
import {
  categoryAxis, chartAnimation, chartDataZoom, chartGrid, chartLegend,
  chartTooltip, lineSeries, valueAxis,
} from '../../lib/chartOptions'

interface Data {
  correlationMatrix: { dates: string[]; series: { name: string; data: (number | null)[] }[] }
  correlationHistory: { dates: string[]; series: { name: string; data: (number | null)[] }[] }
  currentCorrelations: { pair: string; correlation: number; status: string }[]
  regimeDetection: { regime: string; regimeDesc: string; confidence: number }
  diversificationScore: number
  signal: { direction: string; strength: string; confidence: number; evidence: string[] }
  updatedAt: string
}

const REGIME_ACCENT: Record<string, 'green' | 'blue' | 'red'> = { normal_correlation: 'green', flight_to_quality: 'blue', contagion: 'red' }
const CORR_COLORS: Record<string, string> = { positive: 'text-down', negative: 'text-up', neutral: 'text-ink-3' }

export default function CrossAssetDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const t = useChartTheme()

  useEffect(() => {
    let alive = true
    fetch('/api/v1/analysis/cross-asset-correlation.json')
      .then(r => r.json())
      .then(j => { if (!alive) return; if (j.success) setData(j.data); else setError(j.error || '加载失败') })
      .catch(e => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  const matrixOption = useMemo<EChartsOption | null>(() => {
    if (!data?.correlationHistory) return null
    const { dates, series } = data.correlationHistory
    const total = dates.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v == null ? '--' : Number(v).toFixed(3)),
      }),
      legend: chartLegend(t, series.map(s => s.name)),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { min: -1, max: 1 }),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: series.map((s, i) =>
        lineSeries(s.name, s.data, t.series[i % t.series.length], {
          lineStyle: { width: 1.2 },
          markLine: i === 0
            ? { silent: true, symbol: ['none', 'none'], animation: false, label: { show: false }, data: [{ yAxis: 0 }], lineStyle: { color: t.border, type: 'dashed', width: 1 } }
            : undefined,
        }),
      ),
    } as EChartsOption
  }, [data, t])

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  return (
    <div className="space-y-4">
      <MacroCard accent={REGIME_ACCENT[data.regimeDetection.regime] || 'none'}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatTile label="分散化评分" value={`${data.diversificationScore}`} className={data.diversificationScore > 60 ? 'text-up' : data.diversificationScore < 40 ? 'text-down' : ''} />
          <StatTile label="当前体制" value={data.regimeDetection.regime} />
          <StatTile label="信号方向" value={data.signal.direction} className={data.signal.direction === 'risk_off' ? 'text-down' : 'text-up'} />
        </div>
        <div className="mt-3 text-xs text-ink-3">{data.regimeDetection.regimeDesc}</div>
      </MacroCard>

      <MacroCard title="滚动相关系数走势（63日）" padding="sm">
        <ResponsiveChartBox option={matrixOption} deps={[matrixOption]} />
      </MacroCard>

      <MacroCard title="相关系数矩阵" padding="sm">
        <div className="space-y-1.5">
          {data.currentCorrelations.map((c, i) => (
            <div key={i} className="flex justify-between items-center py-1.5 border-b border-line last:border-0 text-xs">
              <span className="text-ink-2">{c.pair}</span>
              <span className={`num font-medium ${CORR_COLORS[c.status] || 'text-ink-3'}`}>{c.correlation.toFixed(3)}</span>
            </div>
          ))}
        </div>
      </MacroCard>

      <MacroCard title="分析依据" padding="sm">
        <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-ink-2">
          {data.signal.evidence.map((e, i) => <li key={i}>{e}</li>)}
          {data.signal.evidence.length === 0 && <li className="text-ink-3">暂无显著信号</li>}
        </ul>
      </MacroCard>
    </div>
  )
}

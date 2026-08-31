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
  breakevenHistory: { dates: string[]; series: { name: string; tenor: string; data: (number | null)[] }[] }
  anchorDeviation: { currentDeviation10y: number | null; zScore: number | null; percentile1y: number | null; anchorStatus: string; anchorDesc: string }
  termStructure: { slope5y10y: number | null }
  currentSnapshot: { breakeven5y: number | null; breakeven10y: number | null; realYield5y: number | null; realYield10y: number | null; realYield20y: number | null; fedTargetPct: number }
  signal: { direction: string; strength: string; confidence: number; evidence: string[] }
  updatedAt: string
}

const STATUS_COLORS: Record<string, string> = { anchored: 'text-up', drifting: 'text-warn', deanchored: 'text-down' }
const DIR_COLORS: Record<string, string> = { dovish: 'text-up', hawkish: 'text-down', neutral: 'text-ink-3' }

export default function InflationAnchorDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const t = useChartTheme()

  useEffect(() => {
    let alive = true
    fetch('/api/v1/analysis/inflation-anchor.json')
      .then(r => r.json())
      .then(j => { if (!alive) return; if (j.success) setData(j.data); else setError(j.error || '加载失败') })
      .catch(e => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  const breakevenOption = useMemo<EChartsOption | null>(() => {
    if (!data?.breakevenHistory) return null
    const { dates, series } = data.breakevenHistory
    const total = dates.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => v == null ? '--' : `${Number(v).toFixed(3)}%` }),
      legend: chartLegend(t, series.map(s => s.name)),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { name: '%', nameTextStyle: { color: t.text3, fontSize: 10 } }),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: series.map((s, i) => lineSeries(s.name, s.data, t.series[i], { lineStyle: { width: 1.2 } })),
    } as EChartsOption
  }, [data, t])

  const deviationOption = useMemo<EChartsOption | null>(() => {
    if (!data?.breakevenHistory) return null
    const { dates } = data.breakevenHistory
    const devData = data.breakevenHistory.series.find(s => s.tenor === '10Y')?.data.map(v => v != null ? +(v - 2.0).toFixed(3) : null) ?? []
    const total = dates.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => v == null ? '--' : `${Number(v).toFixed(3)}%` }),
      grid: chartGrid({ top: 14, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: [{
        name: '偏差',
        type: 'bar',
        data: devData.map(v => ({ value: v, itemStyle: { color: v != null && v >= 0 ? t.downSoft : t.upSoft } })),
        markLine: { data: [{ yAxis: 0, lineStyle: { color: t.border, type: 'dashed' } }] },
      }],
    } as EChartsOption
  }, [data, t])

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  const anchorTone = STATUS_COLORS[data.anchorDeviation.anchorStatus] || 'text-ink-3'
  const dirTone = DIR_COLORS[data.signal.direction] || 'text-ink-3'

  return (
    <div className="space-y-4">
      <MacroCard accent={data.anchorDeviation.anchorStatus === 'deanchored' ? 'red' : data.anchorDeviation.anchorStatus === 'drifting' ? 'gold' : 'green'}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatTile label="5Y 盈亏平衡" value={data.currentSnapshot.breakeven5y != null ? `${data.currentSnapshot.breakeven5y.toFixed(2)}%` : '--'} />
          <StatTile label="10Y 盈亏平衡" value={data.currentSnapshot.breakeven10y != null ? `${data.currentSnapshot.breakeven10y.toFixed(2)}%` : '--'} />
          <StatTile label="10Y 偏差" value={data.anchorDeviation.currentDeviation10y != null ? `${data.anchorDeviation.currentDeviation10y.toFixed(2)}%` : '--'} className={anchorTone} />
          <StatTile label="Z-Score" value={data.anchorDeviation.zScore != null ? data.anchorDeviation.zScore.toFixed(2) : '--'} className={Math.abs(data.anchorDeviation.zScore ?? 0) > 1 ? 'text-warn' : ''} />
          <StatTile label="状态" value={data.anchorDeviation.anchorStatus} className={anchorTone} />
        </div>
        <div className="mt-3 flex items-center gap-3 text-xs text-ink-3">
          <span className={`font-semibold ${dirTone}`}>{data.signal.direction.toUpperCase()}</span>
          <span>置信度 {data.signal.confidence}%</span>
          <span>{data.anchorDeviation.anchorDesc}</span>
        </div>
      </MacroCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MacroCard title="盈亏平衡通胀率" padding="sm">
          <ResponsiveChartBox option={breakevenOption} deps={[breakevenOption]} />
        </MacroCard>
        <MacroCard title="10Y 偏离联储2%目标" padding="sm">
          <ResponsiveChartBox option={deviationOption} deps={[deviationOption]} />
        </MacroCard>
      </div>

      <MacroCard title="分析依据" padding="sm">
        <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-ink-2">
          {data.signal.evidence.map((e, i) => <li key={i}>{e}</li>)}
          {data.signal.evidence.length === 0 && <li className="text-ink-3">暂无显著信号</li>}
        </ul>
      </MacroCard>
    </div>
  )
}

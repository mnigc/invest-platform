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
  spreadHistory: { dates: string[]; series: { name: string; data: (number | null)[] }[] }
  combinedStress: { creditStress: number | null; rateStress: number | null; combinedIndex: number | null; status: string; statusDesc: string }
  currentSpread: { bbbSpread: number | null; hyOas: number | null; aaaSpread: number | null; spreadZScore: number | null }
  rateCreditCorr: number | null
  signal: { direction: string; strength: string; confidence: number; evidence: string[] }
  updatedAt: string
}

const STATUS_ACCENT: Record<string, 'green' | 'gold' | 'red'> = { normal: 'green', elevated: 'gold', high_stress: 'red' }
const STATUS_COLORS: Record<string, string> = { normal: 'text-up', elevated: 'text-warn', high_stress: 'text-down' }

export default function CreditStressDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const t = useChartTheme()

  useEffect(() => {
    let alive = true
    fetch('/api/v1/analysis/credit-stress.json')
      .then(r => r.json())
      .then(j => { if (!alive) return; if (j.success) setData(j.data); else setError(j.error || '加载失败') })
      .catch(e => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  const spreadOption = useMemo<EChartsOption | null>(() => {
    if (!data?.spreadHistory) return null
    const { dates, series } = data.spreadHistory
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
      series: series.map((s, i) => lineSeries(s.name, s.data, t.series[i], { lineStyle: { width: 2 } })),
    } as EChartsOption
  }, [data, t])

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  const statusTone = STATUS_COLORS[data.combinedStress.status] || 'text-ink-3'

  return (
    <div className="space-y-4">
      <MacroCard accent={STATUS_ACCENT[data.combinedStress.status] || 'none'}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatTile label="BBB 利差" value={data.currentSpread.bbbSpread != null ? `${data.currentSpread.bbbSpread.toFixed(2)}%` : '--'} />
          <StatTile label="HY OAS" value={data.currentSpread.hyOas != null ? `${data.currentSpread.hyOas.toFixed(2)}%` : '--'} />
          <StatTile label="信用压力" value={data.combinedStress.creditStress != null ? data.combinedStress.creditStress.toFixed(3) : '--'} />
          <StatTile label="利率压力" value={data.combinedStress.rateStress != null ? data.combinedStress.rateStress.toFixed(3) : '--'} />
          <StatTile label="复合指数" value={data.combinedStress.combinedIndex != null ? data.combinedStress.combinedIndex.toFixed(3) : '--'} className={statusTone} />
        </div>
        <div className="mt-3 flex items-center gap-3 text-xs text-ink-3">
          <span className={`font-semibold ${statusTone}`}>{data.combinedStress.status.toUpperCase()}</span>
          <span>{data.combinedStress.statusDesc}</span>
        </div>
      </MacroCard>

      <MacroCard title="信用利差 vs 国债收益率" padding="sm">
        <ResponsiveChartBox option={spreadOption} deps={[spreadOption]} />
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

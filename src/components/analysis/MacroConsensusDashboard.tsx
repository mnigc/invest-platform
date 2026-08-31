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
  signals: { id: string; name: string; category: string; current: number | null; zScore: number | null; direction: string; weight: number }[]
  consensusScore: { overall: number | null; growth: number | null; inflation: number | null; risk: number | null; liquidity: number | null; direction: string; strength: string; confidence: number }
  historicalConsensus: { dates: string[]; overall: (number | null)[]; liquidity: (number | null)[]; inflation: (number | null)[]; risk: (number | null)[] }
  signal: { direction: string; strength: string; confidence: number; evidence: string[] }
  updatedAt: string
}

const DIR_ACCENT: Record<string, 'green' | 'red' | 'none'> = { bullish: 'green', bearish: 'red', neutral: 'none' }
const DIR_COLORS: Record<string, string> = { bullish: 'text-up', bearish: 'text-down', neutral: 'text-ink-3' }
const CAT_COLORS: Record<string, string> = { growth: 'text-info', inflation: 'text-warn', risk: 'text-down', liquidity: 'text-accent' }

export default function MacroConsensusDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const t = useChartTheme()

  useEffect(() => {
    let alive = true
    fetch('/api/v1/analysis/macro-consensus.json')
      .then(r => r.json())
      .then(j => { if (!alive) return; if (j.success) setData(j.data); else setError(j.error || '加载失败') })
      .catch(e => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  const historyOption = useMemo<EChartsOption | null>(() => {
    if (!data?.historicalConsensus) return null
    const { dates, overall, liquidity, inflation, risk } = data.historicalConsensus
    const total = dates.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t),
      legend: chartLegend(t, ['综合', '流动性', '通胀', '风险']),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { name: '得分', nameTextStyle: { color: t.text3, fontSize: 10 } }),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: [
        lineSeries('综合', overall, t.series[2], { lineStyle: { width: 1.4 } }),
        lineSeries('流动性', liquidity, t.series[0], { lineStyle: { width: 1.2 } }),
        lineSeries('通胀', inflation, t.series[1], { lineStyle: { width: 1.2 } }),
        lineSeries('风险', risk, t.series[3] || t.series[0], { lineStyle: { width: 1.2 } }),
      ],
    } as EChartsOption
  }, [data, t])

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  const dirTone = DIR_COLORS[data.signal.direction] || 'text-ink-3'

  return (
    <div className="space-y-4">
      <MacroCard accent={DIR_ACCENT[data.signal.direction] || 'none'}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatTile label="综合评分" value={data.consensusScore.overall != null ? `${data.consensusScore.overall}` : '--'} className={dirTone} />
          <StatTile label="增长" value={data.consensusScore.growth != null ? `${data.consensusScore.growth}` : '--'} className={CAT_COLORS.growth} />
          <StatTile label="通胀" value={data.consensusScore.inflation != null ? `${data.consensusScore.inflation}` : '--'} className={CAT_COLORS.inflation} />
          <StatTile label="风险" value={data.consensusScore.risk != null ? `${data.consensusScore.risk}` : '--'} className={CAT_COLORS.risk} />
          <StatTile label="流动性" value={data.consensusScore.liquidity != null ? `${data.consensusScore.liquidity}` : '--'} className={CAT_COLORS.liquidity} />
        </div>
        <div className="mt-3 flex items-center gap-3 text-xs text-ink-3">
          <span className={`font-semibold ${dirTone}`}>{data.consensusScore.direction.toUpperCase()}</span>
          <span>强度 {data.consensusScore.strength} · 置信度 {data.consensusScore.confidence}%</span>
        </div>
      </MacroCard>

      <MacroCard title="历史综合评分走势" padding="sm">
        <ResponsiveChartBox option={historyOption} deps={[historyOption]} />
      </MacroCard>

      <MacroCard title="信号明细" padding="sm">
        <div className="space-y-1.5">
          {data.signals.map((s, i) => (
            <div key={i} className="flex justify-between items-center py-1.5 border-b border-line last:border-0 text-xs">
              <span className="text-ink-2">{s.name}</span>
              <div className="flex items-center gap-3">
                <span className="num">{s.current != null ? s.current.toFixed(2) : '--'}</span>
                <span className={`num ${(s.zScore ?? 0) > 1 ? 'text-down' : (s.zScore ?? 0) < -1 ? 'text-up' : 'text-ink-3'}`}>
                  Z: {s.zScore != null ? s.zScore.toFixed(2) : '--'}
                </span>
                <span className="text-ink-3">权重 {(s.weight * 100).toFixed(0)}%</span>
              </div>
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

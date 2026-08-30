import { useState, useMemo, useEffect } from 'react'
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
  curveHistory: { dates: string[]; tenors: { name: string; data: (number | null)[] }[] }
  spreadHistory: { date: string; spread10y2y: number | null; shape: string }[]
  regimeTransitions: { fromRegime: string; toRegime: string; date: string; spreadAtTransition: number | null }[]
  forwardReturns: { spreadRange: string; avgReturn1m: number; avgReturn3m: number; avgReturn6m: number; avgReturn12m: number; winRate1m: number; winRate3m: number; winRate6m: number; winRate12m: number; sampleSize: number }[]
  currentSpread: { spread10y2y: number | null; percentile1y: number | null; percentile5y: number | null; zScore: number | null; inversionMonths: number; signal: string; signalDesc: string }
  updatedAt: string
}

const SIGNAL_ACCENT: Record<string, 'green' | 'red' | 'gold' | 'none'> = { strong_buy: 'green', buy: 'green', neutral: 'none', warning: 'gold', strong_warning: 'red' }
const SIGNAL_COLORS: Record<string, string> = { strong_buy: 'text-up', buy: 'text-up', neutral: 'text-ink-3', warning: 'text-warn', strong_warning: 'text-down' }

export default function YieldCurveRegimeDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const t = useChartTheme()

  useEffect(() => {
    let alive = true
    fetch('/api/v1/analysis/yield-curve-regime.json')
      .then(r => r.json())
      .then(j => { if (!alive) return; if (j.success) setData(j.data); else setError(j.error || '加载失败') })
      .catch(e => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  const spreadOption = useMemo<EChartsOption | null>(() => {
    if (!data?.spreadHistory) return null
    const dates = data.spreadHistory.map(p => p.date)
    const spreadData = data.spreadHistory.map(p => p.spread10y2y)
    const total = dates.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => v == null ? '--' : `${Number(v).toFixed(3)}%` }),
      grid: chartGrid({ top: 14, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { name: '%', nameTextStyle: { color: t.text3, fontSize: 10 } }),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: [{
        name: '10Y-2Y',
        type: 'line',
        data: spreadData,
        smooth: true,
        lineStyle: { width: 2, color: t.series[2] },
        markLine: { data: [{ yAxis: 0, lineStyle: { color: t.border, type: 'dashed' }, label: { show: false } }] },
      }],
    } as EChartsOption
  }, [data, t])

  const curveOption = useMemo<EChartsOption | null>(() => {
    if (!data?.curveHistory) return null
    const { dates, tenors } = data.curveHistory
    const total = dates.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => v == null ? '--' : `${Number(v).toFixed(3)}%` }),
      legend: chartLegend(t, tenors.map(tn => tn.name)),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { name: '%', nameTextStyle: { color: t.text3, fontSize: 10 } }),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: tenors.map((tn, i) => lineSeries(tn.name, tn.data, t.series[i % t.series.length], { lineStyle: { width: i === 0 ? 1 : 2 } })),
    } as EChartsOption
  }, [data, t])

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  const sigTone = SIGNAL_COLORS[data.currentSpread.signal] || 'text-ink-3'

  return (
    <div className="space-y-4">
      <MacroCard accent={SIGNAL_ACCENT[data.currentSpread.signal] || 'none'}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatTile label="10Y-2Y 利差" value={data.currentSpread.spread10y2y != null ? `${data.currentSpread.spread10y2y.toFixed(2)}%` : '--'} className={data.currentSpread.spread10y2y != null && data.currentSpread.spread10y2y < 0 ? 'text-down' : ''} />
          <StatTile label="1Y 百分位" value={data.currentSpread.percentile1y != null ? `${data.currentSpread.percentile1y.toFixed(0)}%` : '--'} />
          <StatTile label="5Y 百分位" value={data.currentSpread.percentile5y != null ? `${data.currentSpread.percentile5y.toFixed(0)}%` : '--'} />
          <StatTile label="Z-Score" value={data.currentSpread.zScore != null ? data.currentSpread.zScore.toFixed(2) : '--'} className={Math.abs(data.currentSpread.zScore ?? 0) > 1 ? 'text-warn' : ''} />
          <StatTile label="倒挂月数" value={`${data.currentSpread.inversionMonths}`} className={data.currentSpread.inversionMonths > 0 ? 'text-down' : ''} />
        </div>
        <div className="mt-3 flex items-center gap-3 text-xs text-ink-3">
          <span className={`font-semibold ${sigTone}`}>{data.currentSpread.signal.toUpperCase()}</span>
          <span>{data.currentSpread.signalDesc}</span>
        </div>
      </MacroCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MacroCard title="10Y-2Y 利差走势" padding="sm">
          <ResponsiveChartBox option={spreadOption} deps={[spreadOption]} />
        </MacroCard>
        <MacroCard title="收益率曲线" padding="sm">
          <ResponsiveChartBox option={curveOption} deps={[curveOption]} />
        </MacroCard>
      </div>

      {data.regimeTransitions.length > 0 && (
        <MacroCard title="近期体制转换" padding="sm">
          <div className="space-y-1.5">
            {data.regimeTransitions.slice(0, 5).map((r, i) => (
              <div key={i} className="flex justify-between items-center py-1.5 border-b border-line last:border-0 text-xs">
                <span className="text-ink-2">{r.date}</span>
                <span className="text-ink-3">{r.fromRegime} → {r.toRegime}</span>
                {r.spreadAtTransition != null && <span className="num">{r.spreadAtTransition.toFixed(2)}%</span>}
              </div>
            ))}
          </div>
        </MacroCard>
      )}

      <MacroCard title="利差区间前瞻收益" padding="sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-ink-3">
                <th className="py-1.5 text-left font-medium">区间</th>
                <th className="py-1.5 text-right font-medium">1M 均值</th>
                <th className="py-1.5 text-right font-medium">3M 均值</th>
                <th className="py-1.5 text-right font-medium">6M 均值</th>
                <th className="py-1.5 text-right font-medium">胜率</th>
                <th className="py-1.5 text-right font-medium">样本</th>
              </tr>
            </thead>
            <tbody>
              {data.forwardReturns.map((r, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="py-1.5 text-ink-2">{r.spreadRange}</td>
                  <td className="py-1.5 text-right num">{(r.avgReturn1m * 100).toFixed(2)}%</td>
                  <td className="py-1.5 text-right num">{(r.avgReturn3m * 100).toFixed(2)}%</td>
                  <td className="py-1.5 text-right num">{(r.avgReturn6m * 100).toFixed(2)}%</td>
                  <td className="py-1.5 text-right num">{(r.winRate12m * 100).toFixed(0)}%</td>
                  <td className="py-1.5 text-right num text-ink-3">{r.sampleSize}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </MacroCard>
    </div>
  )
}

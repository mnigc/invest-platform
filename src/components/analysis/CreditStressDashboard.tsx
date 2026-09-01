import { useMemo, useState, useEffect } from 'react'
import type { EChartsOption } from 'echarts'
import { ResponsiveChartBox } from '../charts/ChartBox'
import { useChartTheme } from '../ui/theme'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { EmptyState, ErrorState } from '../ui/States'
import { MacroCard } from '../ui/MacroCard'
import { StatTile } from '../ui/StatTile'
import { DataTable } from '../ui/DataTable'
import {
  categoryAxis, chartAnimation, chartDataZoom, chartGrid, chartLegend,
  chartTooltip, lineSeries, valueAxis,
} from '../../lib/chartOptions'

interface Data {
  spreadHistory: { dates: string[]; series: { name: string; data: (number | null)[] }[] }
  corrHistory: { dates: string[]; series: { name: string; data: (number | null)[] }[] }
  combinedStress: { creditStress: number | null; rateStress: number | null; combinedIndex: number | null; status: string; statusDesc: string }
  currentSpread: { bbbSpread: number | null; hyOas: number | null; aaaSpread: number | null; wedge: number | null; spreadZScore: number | null; percentile5y: number | null }
  forwardReturns: { spreadRange: string; avgReturn1m: number; avgReturn3m: number; avgReturn6m: number; avgReturn12m: number; winRate1m: number; winRate3m: number; winRate6m: number; winRate12m: number; sampleSize: number }[]
  stressEvents: { date: string; peakSpread: number; ret3m: number | null; ret6m: number | null; ret12m: number | null }[]
  thresholds: { median: number | null; p90: number | null }
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
    const thLine = (v: number | null, color: string, label?: string): any =>
      v == null ? null : { yAxis: v, lineStyle: { color, type: 'dashed', width: 1 }, symbol: ['none', 'none'], animation: false, label: { show: !!label, formatter: label, position: 'insideEndTop', fontSize: 9, color } }
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => v == null ? '--' : `${Number(v).toFixed(3)}%` }),
      legend: chartLegend(t, series.map(s => s.name)),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { name: '%', nameTextStyle: { color: t.text3, fontSize: 10 } }),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: series.map((s, i) =>
        lineSeries(s.name, s.data, t.series[i], {
          lineStyle: { width: i === 0 ? 1.3 : 1.2 },
          markLine: i === 0
            ? {
                silent: true,
                symbol: ['none', 'none'],
                animation: false,
                data: [
                  thLine(data.thresholds?.median, t.borderSoft, '10年中位'),
                  thLine(data.thresholds?.p90, t.warn, '90%分位'),
                  ...data.stressEvents.slice(-12).map((e) => ({
                    xAxis: e.date,
                    lineStyle: { color: t.down, type: 'solid', width: 1, opacity: 0.9 },
                    label: {
                      show: true,
                      formatter: e.date,
                      position: 'insideEndTop',
                      rotate: 90,
                      fontSize: 8,
                      color: t.down,
                      distance: 2,
                    },
                  })),
                ].filter(Boolean),
              }
            : undefined,
        }),
      ),
    } as EChartsOption
  }, [data, t])

  const wedgeOption = useMemo<EChartsOption | null>(() => {
    if (!data?.spreadHistory) return null
    const { dates, series } = data.spreadHistory
    const wedge = series.find(s => s.name === 'BBB-HY溢价')
    if (!wedge) return null
    const total = dates.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => v == null ? '--' : `${Number(v).toFixed(3)}%` }),
      grid: chartGrid({ top: 14, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { name: '%', nameTextStyle: { color: t.text3, fontSize: 10 } }),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: [
        lineSeries(wedge.name, wedge.data, t.series[2], {
          lineStyle: { width: 1.2 },
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            animation: false,
            data: [{
              yAxis: 0,
              lineStyle: { color: t.border, type: 'dashed' },
              label: { show: false },
            }],
          },
        }),
      ],
    } as EChartsOption
  }, [data, t])

  const corrOption = useMemo<EChartsOption | null>(() => {
    if (!data?.corrHistory) return null
    const { dates, series } = data.corrHistory
    const total = dates.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => v == null ? '--' : Number(v).toFixed(3) }),
      legend: chartLegend(t, series.map(s => s.name)),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { min: -1, max: 1 }),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: series.map((s, i) =>
        lineSeries(s.name, s.data, t.series[i], {
          lineStyle: { width: 1.2 },
          markLine: i === 0
            ? {
                silent: true,
                symbol: ['none', 'none'],
                animation: false,
                label: { show: false },
                data: [
                  { yAxis: 0, lineStyle: { color: t.border, type: 'dashed', width: 1 } },
                  { yAxis: 0.3, lineStyle: { color: t.borderSoft, type: 'dashed', width: 1 } },
                  { yAxis: -0.3, lineStyle: { color: t.borderSoft, type: 'dashed', width: 1 } },
                ],
              }
            : undefined,
        }),
      ),
    } as EChartsOption
  }, [data, t])

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  const statusTone = STATUS_COLORS[data.combinedStress.status] || 'text-ink-3'
  // 量纲不同：percentile5y 是 0-100 分位值（与其余分析模块一致），
  // winRate 是 0-1 比率。此前共用同一个 pct() 导致分位显示成 5000%。
  const pctRank = (v: number) => v.toFixed(0)
  const pctRate = (v: number) => (v * 100).toFixed(0)

  return (
    <div className="space-y-4">
      <MacroCard accent={STATUS_ACCENT[data.combinedStress.status] || 'none'}>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatTile label="BBB 利差" value={data.currentSpread.bbbSpread != null ? `${data.currentSpread.bbbSpread.toFixed(2)}%` : '--'} />
          <StatTile label="HY OAS" value={data.currentSpread.hyOas != null ? `${data.currentSpread.hyOas.toFixed(2)}%` : '--'} />
          <StatTile label="BBB-HY 溢价" value={data.currentSpread.wedge != null ? `${data.currentSpread.wedge.toFixed(2)}%` : '--'} sub="HV - BBB" />
          <StatTile label="历史分位" value={data.currentSpread.percentile5y != null ? `${pctRank(data.currentSpread.percentile5y)}%` : '--'} sub={data.currentSpread.spreadZScore != null ? `Z: ${data.currentSpread.spreadZScore.toFixed(2)}` : undefined} />
          <StatTile label="复合指数" value={data.combinedStress.combinedIndex != null ? data.combinedStress.combinedIndex.toFixed(3) : '--'} className={statusTone} />
          <StatTile label="状态" value={data.combinedStress.status.toUpperCase()} sub={data.updatedAt} />
        </div>
        <div className="mt-3 flex items-center gap-3 text-xs text-ink-3">
          <span className={`font-semibold ${statusTone}`}>{data.combinedStress.status.toUpperCase()}</span>
          <span>{data.combinedStress.statusDesc}</span>
        </div>
      </MacroCard>

      <MacroCard title="信用利差与高收益债利差走势" padding="sm">
        <ResponsiveChartBox option={spreadOption} deps={[spreadOption]} />
        <p className="mt-2 text-2xs leading-relaxed text-ink-3">
          <span className="text-warn">90% 分位虚线</span> = 历史高压力线；<span className="text-down">红竖线</span> = BBB 利差突破该线进入高压区间时的尖峰日期（见下方"历史信用压力事件"）。
        </p>
      </MacroCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MacroCard title="BBB-HY 溢价（信用溢价）" padding="sm">
          <ResponsiveChartBox option={wedgeOption} deps={[wedgeOption]} />
        </MacroCard>
        <MacroCard title="利差-利率滚动相关（日变动）" padding="sm">
          <ResponsiveChartBox option={corrOption} deps={[corrOption]} />
        </MacroCard>
      </div>

      <MacroCard title="BBB 利差分档下 S&P500 前瞻表现">
        {data.forwardReturns.length > 0 ? (
          <>
            <p className="mb-3 text-2xs leading-relaxed text-ink-3">
              近 10 年 BBB 信用利差处于不同区间时，S&P500 未来 1/3/6/12 个月的平均收益率与胜率。
            </p>
            <DataTable
              columns={[
                { key: 'spreadRange', header: '利差档位', render: (r) => r.spreadRange },
                { key: 'sampleSize', header: '样本数', numeric: true, render: (r) => `${r.sampleSize} 日` },
                {
                  key: 'avgReturn1m', header: '1M 均值', numeric: true,
                  render: (r) => (
                    <span className={r.avgReturn1m >= 0 ? 'text-up' : 'text-down'}>
                      {r.avgReturn1m.toFixed(2)}%
                    </span>
                  ),
                },
                {
                  key: 'avgReturn3m', header: '3M 均值', numeric: true,
                  render: (r) => (
                    <span className={r.avgReturn3m >= 0 ? 'text-up' : 'text-down'}>
                      {r.avgReturn3m.toFixed(2)}%
                    </span>
                  ),
                },
                {
                  key: 'avgReturn6m', header: '6M 均值', numeric: true,
                  render: (r) => (
                    <span className={r.avgReturn6m >= 0 ? 'text-up' : 'text-down'}>
                      {r.avgReturn6m.toFixed(2)}%
                    </span>
                  ),
                },
                {
                  key: 'avgReturn12m', header: '12M 均值', numeric: true,
                  render: (r) => (
                    <span className={r.avgReturn12m >= 0 ? 'text-up' : 'text-down'}>
                      {r.avgReturn12m.toFixed(2)}%
                    </span>
                  ),
                },
                {
                  key: 'winRate3m', header: '3M 胜率', numeric: true,
                  render: (r) => (
                    <span className={r.winRate3m >= 0.5 ? 'text-up' : 'text-down'}>
                      {pctRate(r.winRate3m)}%
                    </span>
                  ),
                },
              ]}
              rows={data.forwardReturns.filter(r => r.sampleSize > 0)}
              rowKey={(r) => r.spreadRange}
            />
          </>
        ) : (
          <p className="py-3 text-xs text-ink-3">数据同步后将自动生成前瞻统计。</p>
        )}
      </MacroCard>

      <MacroCard title="历史信用压力事件" padding="sm">
        {data.stressEvents.length > 0 ? (
          <>
            <p className="mb-2 text-2xs leading-relaxed text-ink-3">
              近 10 年中 BBB 利差突破 90% 分位的尖峰事件及 S&P500 随后表现。
            </p>
            <ul className="space-y-1.5">
              {[...data.stressEvents].reverse().map((e, i) => (
                <li key={i} className="flex justify-between items-center rounded-md border border-line bg-surface-2 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <span className="text-ink-2">{e.date}</span>
                    <span className="ml-2 text-ink-3">峰值 <span className="num">{e.peakSpread.toFixed(2)}%</span></span>
                  </div>
                  <div className="flex items-center gap-3 num shrink-0">
                    {[
                      ['3M', e.ret3m],
                      ['6M', e.ret6m],
                      ['12M', e.ret12m],
                    ].map(([label, v]) => (
                      <span key={label as string} className={(v as number) != null && (v as number) >= 0 ? 'text-up' : 'text-down'}>
                        {label} {(v as number | null) != null ? `${(v as number).toFixed(1)}%` : '--'}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="py-3 text-xs text-ink-3">近 10 年尚未出现高压力事件，或数据同步中。</p>
        )}
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

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
  chartTooltip, lineSeries, valueAxis, markLine, thresholdLine,
} from '../../lib/chartOptions'

interface Data {
  breakevenHistory: { dates: string[]; series: { name: string; tenor: string; data: (number | null)[] }[] }
  anchorDeviation: { currentDeviation10y: number | null; zScore: number | null; percentile1y: number | null; percentile5y: number | null; anchorStatus: string; anchorDesc: string }
  termStructure: { slope5y10y: number | null; fwd5y5y: number | null }
  termHistory: { dates: string[]; series: { name: string; data: (number | null)[] }[] }
  realYieldCurve: { tenors: string[]; values: (number | null)[] }
  realYieldHistory: { dates: string[]; series: { name: string; data: (number | null)[] }[] }
  zScoreHistory: { dates: string[]; data: (number | null)[] }
  inflationGap: { dates: string[]; breakeven10y: (number | null)[]; cpiYoy: (number | null)[]; gap: (number | null)[]; currentGap: number | null }
  momentum: { chg1m: number | null; chg3m: number | null; chg1y: number | null }
  forwardReturns: { devRange: string; avgReturn1m: number; avgReturn3m: number; avgReturn6m: number; avgReturn12m: number; winRate1m: number; winRate3m: number; winRate6m: number; winRate12m: number; sampleSize: number }[]
  deAnchoringEvents: { date: string; peakDeviation: number; z: number | null; ret3m: number | null; ret6m: number | null; ret12m: number | null; goldRet3m: number | null; goldRet6m: number | null; goldRet12m: number | null }[]
  currentSnapshot: { breakeven5y: number | null; breakeven10y: number | null; realYield5y: number | null; realYield10y: number | null; realYield20y: number | null; realYield30y: number | null; fedTargetPct: number }
  signal: { direction: string; strength: string; confidence: number; evidence: string[] }
  updatedAt: string
}

const STATUS_TONE: Record<string, 'neutral' | 'up' | 'warn' | 'down'> = { anchored: 'up', drifting: 'warn', deanchored: 'down' }
const STATUS_ACCENT: Record<string, 'green' | 'gold' | 'red'> = { anchored: 'green', drifting: 'gold', deanchored: 'red' }
const DIR_TONE: Record<string, 'up' | 'down' | 'neutral'> = { dovish: 'up', hawkish: 'down', neutral: 'neutral' }

const pp = (v: number | null) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}` : '--'
const pct3 = (v: any) => v == null ? '--' : `${Number(v).toFixed(3)}%`

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

  const zoom = (total: number) => Math.max(0, Math.floor((total - 1300) / Math.max(1, total) * 100))

  const beOption = useMemo<EChartsOption | null>(() => {
    if (!data?.breakevenHistory) return null
    const { dates, series } = data.breakevenHistory
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: pct3 }),
      legend: chartLegend(t, series.map(s => s.name)),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { name: '%', nameTextStyle: { color: t.text3, fontSize: 10 } }),
      dataZoom: [chartDataZoom(t, { start: zoom(dates.length), end: 100 })],
      series: series.map((s, i) =>
        lineSeries(s.name, s.data, t.series[i], {
          lineStyle: { width: 1.2 },
          markLine: i === 0 ? markLine([
            thresholdLine(data.currentSnapshot.fedTargetPct, t.accent, '联储目标 2%'),
          ]) : undefined,
        }),
      ),
    } as EChartsOption
  }, [data, t])

  const devOption = useMemo<EChartsOption | null>(() => {
    if (!data?.breakevenHistory) return null
    const { dates } = data.breakevenHistory
    const devData = data.breakevenHistory.series.find(s => s.tenor === '10Y')?.data.map(v => v != null ? +(v - 2.0).toFixed(3) : null) ?? []
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => v == null ? '--' : `${Number(v).toFixed(3)}%` }),
      grid: chartGrid({ top: 14, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t),
      dataZoom: [chartDataZoom(t, { start: zoom(dates.length), end: 100 })],
      series: [{
        name: '偏差',
        type: 'bar',
        data: devData.map(v => ({ value: v, itemStyle: { color: v != null && v >= 0 ? t.downSoft : t.upSoft } })),
        markLine: markLine([
          thresholdLine(0, t.border),
          thresholdLine(0.5, t.warn, '±0.5%'),
          thresholdLine(-0.5, t.warn),
          thresholdLine(0.8, t.down, '±0.8%'),
          thresholdLine(-0.8, t.down),
        ]),
      }],
    } as EChartsOption
  }, [data, t])

  const termOption = useMemo<EChartsOption | null>(() => {
    if (!data?.termHistory) return null
    const { dates, series } = data.termHistory
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: pct3 }),
      legend: chartLegend(t, series.map(s => s.name)),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { name: '%', nameTextStyle: { color: t.text3, fontSize: 10 } }),
      dataZoom: [chartDataZoom(t, { start: zoom(dates.length), end: 100 })],
      series: series.map((s, i) => lineSeries(s.name, s.data, t.series[i], {
        lineStyle: { width: 1.2 },
      })),
    } as EChartsOption
  }, [data, t])

  const ryOption = useMemo<EChartsOption | null>(() => {
    if (!data?.realYieldHistory) return null
    const { dates, series } = data.realYieldHistory
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: pct3 }),
      legend: chartLegend(t, series.map(s => s.name)),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { name: '%', nameTextStyle: { color: t.text3, fontSize: 10 } }),
      dataZoom: [chartDataZoom(t, { start: zoom(dates.length), end: 100 })],
      series: series.map((s, i) => lineSeries(s.name, s.data, t.series[i], {
        lineStyle: { width: 1.2 },
      })),
    } as EChartsOption
  }, [data, t])

  const gapOption = useMemo<EChartsOption | null>(() => {
    if (!data?.inflationGap) return null
    const { dates, breakeven10y, cpiYoy, gap } = data.inflationGap
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => v == null ? '--' : `${Number(v).toFixed(2)}%` }),
      legend: chartLegend(t, ['10Y 盈亏平衡', 'CPI YoY', '预期-实际缺口']),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { name: '%', nameTextStyle: { color: t.text3, fontSize: 10 } }),
      dataZoom: [chartDataZoom(t, { start: zoom(dates.length), end: 100 })],
      series: [
        lineSeries('10Y 盈亏平衡', breakeven10y, t.series[0], { lineStyle: { width: 1.3 } }),
        lineSeries('CPI YoY', cpiYoy, t.series[1], { lineStyle: { width: 1.2 } }),
        {
          name: '预期-实际缺口',
          type: 'bar',
          data: gap.map(v => ({ value: v, itemStyle: { color: v != null && v >= 0 ? t.downSoft : t.upSoft } })),
        },
      ],
    } as EChartsOption
  }, [data, t])

  const zOption = useMemo<EChartsOption | null>(() => {
    if (!data?.zScoreHistory) return null
    const { dates, data: arr } = data.zScoreHistory
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => v == null ? '--' : Number(v).toFixed(2) }),
      grid: chartGrid({ top: 14, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t),
      dataZoom: [chartDataZoom(t, { start: zoom(dates.length), end: 100 })],
      series: [lineSeries('滚动 Z-Score', arr, t.accent, {
        lineStyle: { width: 1.3 },
        markLine: markLine([
          thresholdLine(0, t.border),
          thresholdLine(1, t.warn, '+1σ'),
          thresholdLine(-1, t.warn, '±1σ'),
          thresholdLine(2, t.down, '+2σ'),
          thresholdLine(-2, t.down, '±2σ'),
        ]),
      })],
    } as EChartsOption
  }, [data, t])

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  const a = data.anchorDeviation
  const statusTone = STATUS_TONE[a.anchorStatus] || 'neutral'
  const dirTone = DIR_TONE[data.signal.direction] || 'neutral'
  const zTone: 'neutral' | 'warn' | 'down' = Math.abs(a.zScore ?? 0) >= 2 ? 'down' : Math.abs(a.zScore ?? 0) >= 1 ? 'warn' : 'neutral'
  const pct = (v: number | null) => v != null ? `${v.toFixed(0)}%` : '--'
  const rY = data.realYieldCurve.values.map(v => v != null ? `${v.toFixed(2)}%` : '--').join(' / ')
  const cur = data.currentSnapshot

  return (
    <div className="space-y-4">
      <MacroCard accent={STATUS_ACCENT[a.anchorStatus] || 'none'}>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4">
          <StatTile label="5Y 盈亏平衡" value={cur.breakeven5y != null ? `${cur.breakeven5y.toFixed(2)}%` : '--'} sub={cur.realYield5y != null ? `实际利率 ${cur.realYield5y.toFixed(2)}%` : undefined} />
          <StatTile label="10Y 盈亏平衡" value={cur.breakeven10y != null ? `${cur.breakeven10y.toFixed(2)}%` : '--'} sub={cur.realYield10y != null ? `实际利率 ${cur.realYield10y.toFixed(2)}%` : undefined} />
          <StatTile label="10Y 偏差" value={a.currentDeviation10y != null ? `${pp(a.currentDeviation10y)}%` : '--'} sub="偏离联储 2% 目标" tone={statusTone} />
          <StatTile label="Z-Score" value={a.zScore != null ? a.zScore.toFixed(2) : '--'} sub="252 日滚动" tone={zTone} />
          <StatTile label="1Y 分位" value={pct(a.percentile1y)} sub={a.percentile5y != null ? `5Y 分位 ${a.percentile5y.toFixed(0)}%` : undefined} />
          <StatTile label="5Y5Y 远期" value={data.termStructure.fwd5y5y != null ? `${data.termStructure.fwd5y5y.toFixed(2)}%` : '--'} sub="2×10Y − 5Y 换算" />
          <StatTile label="5Y-10Y 斜率" value={pp(data.termStructure.slope5y10y)} sub={`近1M ${pp(data.momentum.chg1m)}pp`} tone={data.termStructure.slope5y10y != null && data.termStructure.slope5y10y >= 0 ? 'warn' : 'info'} />
          <StatTile label="状态" value={a.anchorStatus.toUpperCase()} sub={data.updatedAt} tone={statusTone} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-3">
          <span className={`font-semibold uppercase ${dirTone === 'up' ? 'text-up' : dirTone === 'down' ? 'text-down' : ''}`}>{data.signal.direction}</span>
          <span>置信度 {data.signal.confidence}%</span>
          <span>{a.anchorDesc}</span>
          {data.inflationGap.currentGap != null && (
            <span>预期溢价 <span className="num">{data.inflationGap.currentGap.toFixed(2)}%</span></span>
          )}
          <span>实际利率曲线 {rY}</span>
        </div>
      </MacroCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MacroCard title="盈亏平衡通胀率" padding="sm">
          <ResponsiveChartBox option={beOption} deps={[beOption]} />
        </MacroCard>
        <MacroCard title="10Y 偏离联储2%目标" padding="sm">
          <ResponsiveChartBox option={devOption} deps={[devOption]} />
          <p className="mt-2 text-2xs leading-relaxed text-ink-3">
            <span className="text-warn">±0.5%</span> = 政策响应阈值；<span className="text-down">±0.8%</span> = 脱锚边界（对应状态机 anchored / drifting / deanchored）。
          </p>
        </MacroCard>
        <MacroCard title="期限结构：5Y5Y 远期 vs 5Y-10Y 斜率" padding="sm">
          <ResponsiveChartBox option={termOption} deps={[termOption]} />
          <p className="mt-2 text-2xs leading-relaxed text-ink-3">
            5Y5Y 远期（2×10Y−5Y）衡量 5 年后 5 年期的隐含通胀预期；斜率为正（10Y&gt;5Y）表示市场认为长端通胀更高，反之短期压力更大。
          </p>
        </MacroCard>
        <MacroCard title="实际利率期限结构（TIPS Real Yield）" padding="sm">
          <ResponsiveChartBox option={ryOption} deps={[ryOption]} />
        </MacroCard>
        <MacroCard title="预期 vs 已实现：10Y 盈亏平衡 vs CPI YoY" padding="sm">
          <ResponsiveChartBox option={gapOption} deps={[gapOption]} />
          <p className="mt-2 text-2xs leading-relaxed text-ink-3">
            虚线为 CPI 同比（月频填充）。柱状为"预期−实际"缺口：正值=市场预期高于现实（通胀预期溢价），负值=预期低于现实。
          </p>
        </MacroCard>
        <MacroCard title="10Y 偏差 252 日滚动 Z-Score" padding="sm">
          <ResponsiveChartBox option={zOption} deps={[zOption]} />
          <p className="mt-2 text-2xs leading-relaxed text-ink-3">
            <span className="text-warn">±1σ</span> 常态化区间边缘，<span className="text-down">±2σ</span> 视为偏差脱轨信号。
          </p>
        </MacroCard>
      </div>

      <MacroCard title="偏差分档下 S&P500 前瞻表现">
        {data.forwardReturns.length > 0 ? (
          <>
            <p className="mb-3 text-2xs leading-relaxed text-ink-3">
              近 10 年 10Y 通胀预期偏差处于不同区间时，S&P500 未来 1/3/6/12 个月的平均收益率与胜率。
            </p>
            <DataTable
              columns={[
                { key: 'devRange', header: '偏差档位', render: (r) => r.devRange },
                { key: 'sampleSize', header: '样本数', numeric: true, render: (r) => `${r.sampleSize} 日` },
                { key: 'avgReturn1m', header: '1M 均值', numeric: true, render: (r) => <span className={r.avgReturn1m >= 0 ? 'text-up' : 'text-down'}>{r.avgReturn1m.toFixed(2)}%</span> },
                { key: 'avgReturn3m', header: '3M 均值', numeric: true, render: (r) => <span className={r.avgReturn3m >= 0 ? 'text-up' : 'text-down'}>{r.avgReturn3m.toFixed(2)}%</span> },
                { key: 'avgReturn6m', header: '6M 均值', numeric: true, render: (r) => <span className={r.avgReturn6m >= 0 ? 'text-up' : 'text-down'}>{r.avgReturn6m.toFixed(2)}%</span> },
                { key: 'avgReturn12m', header: '12M 均值', numeric: true, render: (r) => <span className={r.avgReturn12m >= 0 ? 'text-up' : 'text-down'}>{r.avgReturn12m.toFixed(2)}%</span> },
                { key: 'winRate3m', header: '3M 胜率', numeric: true, render: (r) => <span className={r.winRate3m >= 0.5 ? 'text-up' : 'text-down'}>{(r.winRate3m * 100).toFixed(0)}%</span> },
              ]}
              rows={data.forwardReturns.filter(r => r.sampleSize > 0)}
              rowKey={(r) => r.devRange}
            />
          </>
        ) : (
          <p className="py-3 text-xs text-ink-3">数据同步后将自动生成前瞻统计。</p>
        )}
      </MacroCard>

      <MacroCard title="历史脱锚事件（|偏差| ≥ 0.8%）" padding="sm">
        {data.deAnchoringEvents.length > 0 ? (
          <>
            <p className="mb-2 text-2xs leading-relaxed text-ink-3">
              近 10 年中通胀预期偏离 2% 目标 ±0.8% 的尖峰事件，及随后股票 / 黄金表现（%）。
            </p>
            <ul className="space-y-1.5">
              {[...data.deAnchoringEvents].reverse().map((e, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-line bg-surface-2 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <span className="text-ink-2">{e.date}</span>
                    <span className={`ml-2 font-semibold num ${e.peakDeviation >= 0 ? 'text-down' : 'text-up'}`}>{e.peakDeviation >= 0 ? '+' : ''}{e.peakDeviation.toFixed(2)}%</span>
                    {e.z != null && <span className="ml-2 text-ink-3">Z {e.z.toFixed(2)}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 num">
                    <span className="text-ink-3">股票</span>
                    {[['3M', e.ret3m], ['6M', e.ret6m], ['12M', e.ret12m]].map(([label, v]) => (
                      <span key={label as string} className={(v as number) != null && (v as number) >= 0 ? 'text-up' : 'text-down'}>
                        {label} {(v as number | null) != null ? `${(v as number).toFixed(1)}%` : '--'}
                      </span>
                    ))}
                    <span className="text-ink-3">黄金</span>
                    {[['3M', e.goldRet3m], ['6M', e.goldRet6m], ['12M', e.goldRet12m]].map(([label, v]) => (
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
          <p className="py-3 text-xs text-ink-3">近 10 年尚未出现 |偏差|≥0.8% 的脱锚事件，或数据同步中。</p>
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

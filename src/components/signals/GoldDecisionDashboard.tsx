import { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { ResponsiveChartBox } from '../charts/ChartBox'
import { useChartTheme } from '../ui/theme'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { ErrorState } from '../ui/States'
import { MacroCard } from '../ui/MacroCard'
import { StatTile } from '../ui/StatTile'
import { DataTable, type Column } from '../ui/DataTable'
import {
  categoryAxis,
  chartAnimation,
  chartDataZoom,
  chartLegend,
  chartTooltip,
  chartGrid,
  lineSeries,
  markLine,
  rightValueAxis,
  thresholdLine,
  valueAxis,
} from '../../lib/chartOptions'

type Direction = 'bullish' | 'bearish' | 'neutral'
type Strength = 'strong' | 'moderate' | 'weak'

interface HorizonStat {
  n: number
  mean: number
  median: number
  winRate: number
  p25: number
  p75: number
  best: number
  worst: number
}

interface Study {
  nEvents: number
  horizons: Record<string, HorizonStat>
}

interface Data {
  latest: {
    gold: number | null
    dxy: number | null
    corr20: number
    corr60: number
    corr120: number
    band: string
    bandLabel: string
    bandDesc: string
    dfii10: number | null
    t10yie: number | null
    residZ: number | null
    residPercentile: number
    momentum20: number
    momentum60: number
  }
  priceChart: { date: string; gold: number; dxy: number | null }[]
  corrChart: {
    s20: { date: string; value: number }[]
    s60: { date: string; value: number }[]
    s120: { date: string; value: number }[]
  }
  bandSwitches: { date: string; from: string; to: string }[]
  residSeries: { date: string; z: number | null }[]
  momentumChart: {
    m20: { date: string; value: number }[]
    m60: { date: string; value: number }[]
  }
  extremes: { date: string; dir: string }[]
  eventStudies: {
    broken: Study
    overvalued: Study
    undervalued: Study
  }
  signal: {
    title: string
    direction: Direction
    strength: Strength
    confidence: number
    evidence: string[]
    counterEvidence: string[]
    historical: { label: string; n: number; median: number; winRate: number }[]
    updatedAt: string
  }
  updatedAt: string
}

const DIR_LABEL: Record<Direction, string> = {
  bullish: '看多',
  bearish: '看空',
  neutral: '中性',
}
const STRENGTH_LABEL: Record<Strength, string> = {
  strong: '强',
  moderate: '中',
  weak: '弱',
}

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`
const signed = (v: number | null, digits = 2) =>
  v == null ? '--' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`

/* --------------------------------------------------------------------------- */

function SignalPanel({ signal }: { signal: Data['signal'] }) {
  const tone =
    signal.direction === 'bullish'
      ? 'text-up'
      : signal.direction === 'bearish'
        ? 'text-down'
        : 'text-ink-3'
  const accent =
    signal.direction === 'bullish'
      ? 'green'
      : signal.direction === 'bearish'
        ? 'red'
        : ('none' as const)

  return (
    <MacroCard accent={accent} padding="lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">{signal.title}</h2>
          <p className="mt-0.5 text-2xs text-ink-3">
            更新 {signal.updatedAt} · 研究参考，非投资建议
          </p>
        </div>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className={`num text-2xl font-bold ${tone}`}>
            {DIR_LABEL[signal.direction]}
          </span>
          <span className="text-xs text-ink-3">
            信号强度 {STRENGTH_LABEL[signal.strength]} · 置信度{' '}
            <span className="num">{signal.confidence}%</span>
          </span>
        </div>
      </div>

      <div className="mt-4">
        <div>
          <h3 className="mb-1 text-xs font-semibold text-ink-3">证据链</h3>
          <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-ink-2">
            {signal.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
        {signal.counterEvidence.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1 text-xs font-semibold text-ink-3">反向证据</h3>
            <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-down">
              {signal.counterEvidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {signal.historical.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {signal.historical.map((h, i) => (
            <div
              key={i}
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs"
            >
              <span className="text-ink-3">{h.label}：</span>
              <strong
                className={`num ${
                  h.median >= 0 ? 'text-up' : 'text-down'
                }`}
              >
                {fmtPct(h.median)}
              </strong>
              <span className="text-ink-3">
                {' '}
                · 胜率 <span className="num">{fmtPct(h.winRate)}</span> ·{' '}
                <span className="num">{h.n}</span> 次
              </span>
            </div>
          ))}
        </div>
      )}
    </MacroCard>
  )
}

function StudyTable({ title, study }: { title: string; study: Study }) {
  const rows = useMemo(() => Object.entries(study?.horizons ?? {}), [study])
  if (!study || study.nEvents === 0 || rows.length === 0) return null

  const columns: Column<[string, HorizonStat]>[] = [
    { key: 'h', header: '窗口', render: ([h]) => `${h} 日` },
    { key: 'n', header: '样本', numeric: true, render: ([, s]) => s.n },
    {
      key: 'win',
      header: '胜率',
      numeric: true,
      render: ([, s]) => (
        <span className={s.winRate >= 0.5 ? 'text-up' : 'text-down'}>
          {fmtPct(s.winRate)}
        </span>
      ),
    },
    {
      key: 'median',
      header: '中位数',
      numeric: true,
      render: ([, s]) => (
        <span className={s.median >= 0 ? 'text-up' : 'text-down'}>
          {fmtPct(s.median)}
        </span>
      ),
    },
    { key: 'mean', header: '均值', numeric: true, render: ([, s]) => fmtPct(s.mean) },
    { key: 'p25', header: 'P25', numeric: true, render: ([, s]) => fmtPct(s.p25) },
    { key: 'p75', header: 'P75', numeric: true, render: ([, s]) => fmtPct(s.p75) },
  ]

  return (
    <div className="mt-4 first:mt-0">
      <h3 className="mb-1.5 text-xs font-semibold text-ink-2">
        {title}
        <span className="num ml-1 text-ink-3">（{study.nEvents} 次事件）</span>
      </h3>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={([h]) => h}
        stickyFirst
      />
    </div>
  )
}

/* --------------------------------------------------------------------------- */

export function GoldDecisionDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const t = useChartTheme()

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetch('/api/v1/gold/correlation.json')
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return
        if (j.success) setData(j.data)
        else setError(j.error || '加载失败')
      })
      .catch((e: any) => alive && setError(e.message || '加载失败'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [reloadKey])

  const priceOption = useMemo<EChartsOption | null>(() => {
    if (!data?.priceChart?.length) return null
    const total = data.priceChart.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t),
      legend: chartLegend(t, ['金价 (USD/oz)', 'DXY']),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, data.priceChart.map((p) => p.date)),
      yAxis: [
        valueAxis(t, {
          name: 'Gold',
          nameTextStyle: { color: t.text3, fontSize: 10, align: 'left' },
        }),
        rightValueAxis(t, {
          name: 'DXY',
          nameTextStyle: { color: t.text3, fontSize: 10, align: 'right' },
        }),
      ],
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: [
        lineSeries(
          '金价 (USD/oz)',
          data.priceChart.map((p) => p.gold),
          t.series[2],
          { lineStyle: { width: 2, color: t.series[2] } },
        ),
        lineSeries(
          'DXY',
          data.priceChart.map((p) => p.dxy),
          t.series[1],
          { yAxisIndex: 1, lineStyle: { width: 1.5, color: t.series[1] } },
        ),
      ],
    } as EChartsOption
  }, [data, t])

  const corrOption = useMemo<EChartsOption | null>(() => {
    if (!data?.corrChart?.s60?.length) return null
    const total = data.corrChart.s60.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v == null ? '--' : Number(v).toFixed(3)),
      }),
      legend: chartLegend(t, ['20 日', '60 日', '120 日']),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, data.corrChart.s60.map((p) => p.date)),
      yAxis: valueAxis(t, { min: -1, max: 1, scale: false }),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: [
        lineSeries(
          '20 日',
          data.corrChart.s20.map((p) => p.value),
          t.series[2],
          { lineStyle: { width: 1.4, color: t.series[2] } },
        ),
        lineSeries(
          '60 日',
          data.corrChart.s60.map((p) => p.value),
          t.series[1],
          { lineStyle: { width: 2, color: t.series[1] } },
        ),
        lineSeries(
          '120 日',
          data.corrChart.s120.map((p) => p.value),
          t.series[0],
          { lineStyle: { width: 1.4, color: t.series[0] } },
        ),
      ],
    } as EChartsOption
  }, [data, t])

  const residOption = useMemo<EChartsOption | null>(() => {
    if (!data?.residSeries?.length) return null
    const total = data.residSeries.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v == null ? '--' : Number(v).toFixed(2)),
      }),
      grid: chartGrid({ top: 14, bottom: 32 }),
      xAxis: categoryAxis(t, data.residSeries.map((p) => p.date)),
      yAxis: valueAxis(t),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: [
        {
          name: '残差 z',
          type: 'bar',
          data: data.residSeries.map((p) => {
            const v = p.z
            if (v == null) return null
            // 高估（z≥2）看空 → 跌色；低估（z≤-2）看多 → 涨色
            const color =
              v >= 2 ? t.down : v <= -2 ? t.up : v >= 0 ? t.downSoft : t.upSoft
            return { value: v, itemStyle: { color } }
          }),
          markLine: markLine([
            thresholdLine(2, t.down, '+2σ'),
            thresholdLine(-2, t.up, '-2σ'),
          ]),
        },
      ],
    } as EChartsOption
  }, [data, t])

  const momentumOption = useMemo<EChartsOption | null>(() => {
    if (!data?.momentumChart?.m20?.length) return null
    const total = data.momentumChart.m20.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v == null ? '--' : `${(v * 100).toFixed(2)}%`),
      }),
      legend: chartLegend(t, ['20D 动量', '60D 动量']),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, data.momentumChart.m20.map((p) => p.date)),
      yAxis: valueAxis(t),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: [
        lineSeries(
          '20D 动量',
          data.momentumChart.m20.map((p) => p.value),
          t.series[2],
          { lineStyle: { width: 1.5, color: t.series[2] } },
        ),
        lineSeries(
          '60D 动量',
          data.momentumChart.m60.map((p) => p.value),
          t.series[1],
          { lineStyle: { width: 2, color: t.series[1] } },
        ),
      ],
    } as EChartsOption
  }, [data, t])

  if (loading) return <LoadingSkeleton type="card" rows={4} height={300} />
  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  if (!data) return <ErrorState message="暂无数据" />

  const latest = data.latest
  const residTone =
    latest.residZ == null ? 'neutral' : latest.residZ >= 0 ? ('down' as const) : ('up' as const)

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      {/* 关键指标 — 顶部全宽 */}
      <div className="lg:col-span-2">
        <MacroCard padding="sm">
          <div className="stagger grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-9">
            <StatTile
              label="金价"
              value={latest.gold != null ? latest.gold.toFixed(2) : '--'}
              sub="USD / oz"
              tone="warn"
            />
            <StatTile
              label="美元指数 DXY"
              value={latest.dxy != null ? latest.dxy.toFixed(2) : '--'}
              tone="info"
            />
            <StatTile
              label="相关 20/60/120"
              value={`${latest.corr20.toFixed(2)} / ${latest.corr60.toFixed(2)} / ${latest.corr120.toFixed(2)}`}
              sub="收益率口径"
            />
            <StatTile
              label="关联状态"
              value={latest.bandLabel}
              sub={latest.bandDesc}
              tone="info"
            />
            <StatTile
              label="实际利率 DFII10"
              value={latest.dfii10 != null ? `${latest.dfii10.toFixed(2)}%` : '--'}
              sub="10Y TIPS"
              tone="warn"
            />
            <StatTile
              label="盈亏平衡 T10YIE"
              value={latest.t10yie != null ? `${latest.t10yie.toFixed(2)}%` : '--'}
              sub="10Y Breakeven"
              tone="warn"
            />
            <StatTile
              label="定价残差 z"
              value={signed(latest.residZ)}
              sub={`5Y 分位 ${latest.residPercentile.toFixed(0)}`}
              tone={residTone}
            />
            <StatTile
              label="金价动量 20D"
              value={`${(latest.momentum20 * 100).toFixed(2)}%`}
              sub="近20日对数收益"
              tone={latest.momentum20 >= 0 ? 'up' : 'down'}
            />
            <StatTile
              label="金价动量 60D"
              value={`${(latest.momentum60 * 100).toFixed(2)}%`}
              sub="近60日对数收益"
              tone={latest.momentum60 >= 0 ? 'up' : 'down'}
            />
          </div>
        </MacroCard>
      </div>

      {/* 主列：图表与事件研究 */}
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-1 lg:row-start-2">
        <MacroCard title="金价 vs 美元指数">
          <ResponsiveChartBox option={priceOption} deps={[priceOption]} />
        </MacroCard>

        <MacroCard title="金价动量（20D / 60D 对数收益率累加）">
          <ResponsiveChartBox option={momentumOption} deps={[momentumOption]} />
          <p className="mt-2 text-2xs leading-relaxed text-ink-3">
            说明：正值表示上涨趋势，负值表示下跌趋势。20D 反映短期，60D 反映中期动量。
          </p>
        </MacroCard>

        <MacroCard title="黄金-美元收益率滚动相关（20 / 60 / 120 日）">
          <ResponsiveChartBox option={corrOption} deps={[corrOption]} />
          <p className="mt-2 text-2xs leading-relaxed text-ink-3">
            说明：越向下越负相关（经典范式）；高于 -0.15 即「失效区间」。
          </p>
        </MacroCard>

        <MacroCard title="定价残差 z（双因子模型：实际利率 DFII10 + DXY 20 日动量）">
          <ResponsiveChartBox option={residOption} deps={[residOption]} />
          {data.extremes.length > 0 && (
            <p className="mt-2 text-2xs leading-relaxed text-ink-3">
              历史极端点（<span className="num">{data.extremes.length}</span>）：
              {data.extremes
                .slice(-8)
                .map((e) => `${e.date}(${e.dir === 'overvalued' ? '高估' : '低估'})`)
                .join(' · ')}
            </p>
          )}
        </MacroCard>

        <MacroCard title="事件研究：信号出现后的黄金后市收益">
          <StudyTable title="① 相关性失效/正相关切换后" study={data.eventStudies.broken} />
          <StudyTable title="② 残差高估（z ≥ 2）后" study={data.eventStudies.overvalued} />
          <StudyTable title="③ 残差低估（z ≤ -2）后" study={data.eventStudies.undervalued} />
          {data.eventStudies.broken.nEvents === 0 &&
            data.eventStudies.overvalued.nEvents === 0 &&
            data.eventStudies.undervalued.nEvents === 0 && (
              <p className="py-3 text-xs text-ink-3">
                历史事件不足，样本积累后自动生成验证统计。
              </p>
            )}
        </MacroCard>
      </div>

      {/* 右栏：信号 · 数据来源 */}
      <aside className="flex flex-col gap-3 lg:col-span-1 lg:col-start-2 lg:row-start-2 lg:sticky lg:top-[calc(var(--topbar-height)+16px)]">
        <SignalPanel signal={data.signal} />

        <MacroCard title="数据来源" padding="sm">
          <p className="text-2xs leading-relaxed text-ink-3">
            Yahoo Finance（金价 GC=F、美元指数 DXY）、FRED（DFII10、T10YIE）。
          </p>
          <p className="num mt-1.5 text-2xs text-ink-3">更新 {data.updatedAt}</p>
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
            所有信号为统计研究结果，不构成投资建议。
          </p>
        </MacroCard>
      </aside>
    </div>
  )
}

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
  markArea,
  markLine,
  rightValueAxis,
  thresholdLine,
  valueAxis,
  eventLine,
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
    historical: {
      label: string
      expected?: 'bullish' | 'bearish' | 'neutral'
      n: number
      median: number
      winRate: number
    }[]
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

const BAND_LABEL_ZH: Record<string, string> = {
  inverse: '正常负相关',
  weakening: '相关性弱化',
  broken: '相关性失效',
  positive: '正相关区间',
}

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`
const signed = (v: number | null, digits = 2) =>
  v == null ? '--' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`

/** 从残差序列中切出"持续高估 / 持续低估"区间。
 *  - 高估：z 跨过 2 进入，离开条件是回落至 < 2
 *  - 低估：z 跨过 -2 进入，离开条件是回升至 > -2
 *  - 持续 < minDays 个交易日的尖峰会被剔除（避免擦边噪声被画成区段）
 *  - start/end 都取该日对应的类目轴日期字符串（ECharts markArea 用 xAxis 类别定位） */
function buildResidSpans(
  series: { date: string; z: number | null }[],
  minDays: number,
): { start: string; end: string; dir: 'overvalued' | 'undervalued' }[] {
  const spans: { start: string; end: string; dir: 'overvalued' | 'undervalued' }[] = []
  let cur: { start: string; end: string; dir: 'overvalued' | 'undervalued' } | null = null
  for (const p of series) {
    const v = p.z
    if (v == null) continue
    const isOver = v >= 2
    const isUnder = v <= -2
    if (cur) {
      if ((cur.dir === 'overvalued' && isOver) || (cur.dir === 'undervalued' && isUnder)) {
        cur.end = p.date
        continue
      }
      // 离开区间：先结算再判断是否进入新区间
      spans.push(cur)
      cur = null
    }
    if (isOver) cur = { start: p.date, end: p.date, dir: 'overvalued' }
    else if (isUnder) cur = { start: p.date, end: p.date, dir: 'undervalued' }
  }
  if (cur) spans.push(cur)
  return spans.filter((s) => {
    const startIdx = series.findIndex((p) => p.date === s.start)
    const endIdx = series.findIndex((p) => p.date === s.end)
    return endIdx - startIdx + 1 >= minDays
  })
}

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
        <div className="mt-4">
          <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-3">
            历史回测（信号出现后 60 日）
          </h3>
          <div className="flex flex-col gap-1.5">
            {signal.historical.map((h, i) => {
              const expected = h.expected ?? 'neutral'
              const actual =
                h.median > 0.001
                  ? 'bullish'
                  : h.median < -0.001
                    ? 'bearish'
                    : 'neutral'
              const aligned =
                expected === 'neutral' || expected === actual
              const lowSample = h.n < 5
              const expLabel =
                expected === 'bullish'
                  ? '预期看多'
                  : expected === 'bearish'
                    ? '预期看空'
                    : '方向中性'
              const expColor =
                expected === 'bullish'
                  ? 'text-up'
                  : expected === 'bearish'
                    ? 'text-down'
                    : 'text-ink-3'
              return (
                <div
                  key={i}
                  className={[
                    'flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border bg-surface-2 px-2.5 py-1.5 text-xs transition-opacity',
                    aligned
                      ? 'border-line'
                      : 'border-warn/60 bg-warn/5',
                    lowSample ? 'opacity-70' : '',
                  ].join(' ')}
                >
                  <span className="font-medium text-ink-2">{h.label}</span>
                  <span className={`text-2xs ${expColor}`}>
                    {expLabel}
                  </span>
                  {!aligned && (
                    <span className="rounded-sm border border-warn/60 px-1 text-2xs text-warn">
                      ⚠ 实际方向与预期相反
                    </span>
                  )}
                  {lowSample && (
                    <span className="rounded-sm border border-line px-1 text-2xs text-ink-3">
                      样本少
                    </span>
                  )}
                  <span className="ml-auto flex items-baseline gap-1.5">
                    <strong
                      className={`num ${
                        h.median >= 0 ? 'text-up' : 'text-down'
                      }`}
                    >
                      {fmtPct(h.median)}
                    </strong>
                    <span className="text-2xs text-ink-3">
                      胜率 <span className="num">{fmtPct(h.winRate)}</span>
                    </span>
                    <span className="text-2xs text-ink-3">
                      · <span className="num">{h.n}</span> 次
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </MacroCard>
  )
}

function StudyTable({
  title,
  study,
  expected,
  triggerHint,
}: {
  title: string
  study: Study
  expected: 'bullish' | 'bearish' | 'neutral'
  triggerHint: string
}) {
  const rows = useMemo(() => Object.entries(study?.horizons ?? {}), [study])
  if (!study || study.nEvents === 0 || rows.length === 0) return null

  const sampleMaturity =
    study.nEvents >= 12
      ? { label: '成熟', tone: 'text-up border-up/40 bg-up/5' }
      : study.nEvents >= 5
        ? { label: '积累中', tone: 'text-warn border-warn/40 bg-warn/5' }
        : { label: '观察期', tone: 'text-ink-3 border-line bg-surface-2' }

  const expLabel =
    expected === 'bullish'
      ? '预期看多（回归向上）'
      : expected === 'bearish'
        ? '预期看空（回归向下）'
        : '方向中性（相关性失效，无方向含义）'

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
    {
      key: 'mean',
      header: '均值',
      numeric: true,
      render: ([, s]) => (
        <span className={s.mean >= 0 ? 'text-up' : 'text-down'}>
          {fmtPct(s.mean)}
        </span>
      ),
    },
    {
      key: 'consistency',
      header: '方向',
      numeric: true,
      render: ([, s]) => {
        const actual =
          s.median > 0.001 ? 'bullish' : s.median < -0.001 ? 'bearish' : 'neutral'
        const aligned =
          expected === 'neutral' ||
          actual === 'neutral' ||
          expected === actual
        return (
          <span
            className={
              aligned
                ? s.n < 5
                  ? 'text-ink-3'
                  : expected === 'neutral'
                    ? 'text-ink-3'
                    : 'text-up'
                : 'text-warn'
            }
            title={
              aligned
                ? '实际方向与模型预期一致'
                : '实际方向与模型预期相反（窗口内中位数）'
            }
          >
            {aligned
              ? expected === 'neutral'
                ? '—'
                : s.n < 5
                  ? '~'
                  : '✓'
              : '⚠'}
          </span>
        )
      },
    },
    {
      key: 'p25',
      header: 'P25',
      numeric: true,
      render: ([, s]) => fmtPct(s.p25),
    },
    {
      key: 'p75',
      header: 'P75',
      numeric: true,
      render: ([, s]) => fmtPct(s.p75),
    },
  ]

  return (
    <div className="mt-4 first:mt-0">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="text-xs font-semibold text-ink-2">
          {title}
          <span className="num ml-1 text-ink-3">
            （{study.nEvents} 次事件）
          </span>
        </h3>
        <span
          className={`rounded-sm border px-1.5 text-2xs ${sampleMaturity.tone}`}
        >
          {sampleMaturity.label}
        </span>
        <span className="text-2xs text-ink-3">· {expLabel}</span>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={([h]) => h}
        stickyFirst
        caption={
          study.nEvents < 5
            ? '样本量低于 5，结果仅供观察，可能由离群单事件主导，置信度有限。'
            : study.nEvents < 12
              ? '样本量 5-12，方向性提示可参考，建议继续积累。'
              : undefined
        }
      />
      <p className="mt-1 text-2xs leading-relaxed text-ink-3">
        触发规则：{triggerHint}
      </p>
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
    const dates = data.priceChart.map((p) => p.date)

    // 从残差序列中切出"持续高估 / 持续低估"区间，避免依赖 data.extremes 离散点
    // 过滤掉持续 < 3 个交易日的过窄尖峰
    const residSpans = buildResidSpans(data.residSeries ?? [], 3)
    const residAreas: unknown[][] = []
    for (const s of residSpans) {
      const color = s.dir === 'overvalued' ? t.downBg : t.upBg
      residAreas.push([
        { xAxis: s.start, itemStyle: { color } },
        { xAxis: s.end },
      ])
    }

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t),
      legend: chartLegend(t, ['金价 (USD/oz)', 'DXY', '高估区间', '低估区间']),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
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
          {
            lineStyle: { width: 1.3, color: t.series[2] },
            markArea: markArea(residAreas),
          },
        ),
        lineSeries(
          'DXY',
          data.priceChart.map((p) => p.dxy),
          t.series[1],
          { yAxisIndex: 1, lineStyle: { width: 1.2, color: t.series[1] } },
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
          { lineStyle: { width: 1.2, color: t.series[2] } },
        ),
        lineSeries(
          '60 日',
          data.corrChart.s60.map((p) => p.value),
          t.series[1],
          {
            lineStyle: { width: 1.3, color: t.series[1] },
            markLine: {
              silent: true,
              symbol: ['none', 'none'],
              animation: false,
              data: (data.bandSwitches ?? [])
                .filter((s) => s.to === 'broken' || s.to === 'positive')
                .slice(-10)
                .map((s) => eventLine(s.date, t.warn, BAND_LABEL_ZH[s.to] ?? s.to)),
            },
          },
        ),
        lineSeries(
          '120 日',
          data.corrChart.s120.map((p) => p.value),
          t.series[0],
          { lineStyle: { width: 1.2, color: t.series[0] } },
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
          { lineStyle: { width: 1.2, color: t.series[2] } },
        ),
        lineSeries(
          '60D 动量',
          data.momentumChart.m60.map((p) => p.value),
          t.series[1],
          { lineStyle: { width: 1.3, color: t.series[1] } },
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
              tooltip={latest.bandDesc}
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
          <p className="mt-2 text-2xs leading-relaxed text-ink-3">
            背景色块：定价残差 z 持续偏离区间（<span className="text-down">浅红 = 高估 z≥2</span> /
            <span className="text-up">浅绿 = 低估 z≤-2</span>，持续≥3 个交易日），可观察金价在极端估值期的后续走势。
          </p>
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
            <span className="text-warn">黄色竖线</span>：相关性失效/正相关切换事件。
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
          <StudyTable
            title="① 相关性失效/正相关切换后"
            study={data.eventStudies.broken}
            expected="neutral"
            triggerHint="滚动 60 日黄金-美元收益率相关从负转非负（相关系数 ≥ -0.15）"
          />
          <StudyTable
            title="② 残差高估（z ≥ 2）后"
            study={data.eventStudies.overvalued}
            expected="bearish"
            triggerHint="双因子定价残差 z 首次向上突破 +2σ"
          />
          <StudyTable
            title="③ 残差低估（z ≤ -2）后"
            study={data.eventStudies.undervalued}
            expected="bullish"
            triggerHint="双因子定价残差 z 首次向下突破 -2σ"
          />
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

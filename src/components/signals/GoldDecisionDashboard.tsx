import { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { ResponsiveChartBox } from '../charts/ChartBox'
import { useChartTheme, type ChartTheme } from '../ui/theme'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { ErrorState } from '../ui/States'
import { MacroCard } from '../ui/MacroCard'
import { StatTile } from '../ui/StatTile'
import { DataTable, type Column } from '../ui/DataTable'
import { WinRateMeter } from '../ui/WinRateMeter'
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
  eventLine, defaultZoomStart,
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

interface ScatterData {
  bins: { xMid: number; xMin: number; xMax: number; median: number; q25: number; q75: number; count: number }[]
  points: { date: string; x: number; y: number }[]
  latest: { date: string; x: number; y: number } | null
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
    momentum20: number | null
    momentum60: number | null
  }
  priceChart: { date: string; gold: number; dxy: number | null; dfii10: number | null }[]
  corrChart: {
    s20: { date: string; value: number }[]
    s60: { date: string; value: number }[]
    s120: { date: string; value: number }[]
  }
  corrIrrChart: {
    s20: { date: string; value: number }[]
    s60: { date: string; value: number }[]
    s120: { date: string; value: number }[]
  }
  scatterData: ScatterData
  // 美元指数版散点（DXY 水平分桶 vs 金价 60D 收益）。
  // 字段可选：旧 payload（sync 尚未重跑）没有该字段，前端需容忍缺失。
  scatterDxy?: ScatterData
  bandSwitches: { date: string; from: string; to: string }[]
  residSeries: { date: string; z: number | null; contribDfii: number | null; contribDxy: number | null }[]
  momentumChart: {
    m20: { date: string; value: number }[]
    m60: { date: string; value: number }[]
  }
  // 可选字段：旧 payload（sync 尚未重跑）没有这些字段，前端需容忍缺失而非整块白屏。
  extremes?: { date: string; dir: string }[]
  eventStudies?: {
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
  const idxOf = new Map(series.map((p, i) => [p.date, i]))
  return spans.filter((s) => (idxOf.get(s.end) ?? 0) - (idxOf.get(s.start) ?? 0) + 1 >= minDays)
}

/** 残差 z 贡献分解图的单因子版本（DFII10 / DXY 各一张）。
 * 两个因子的贡献量级相差约两个数量级（DFII10 |z| 峰值 ≈ 10，DXY ≈ 0.05），
 * 同一张图共用 y 轴时 DXY 柱子高度不足 1px、肉眼等同空图；
 * 因此贡献柱走独立的右轴自动定标，残差 z 线留在左轴，
 * ±2σ 阈值线与持续偏离背景区段仍挂在 z 线上。 */
function buildResidFactorOption(
  t: ChartTheme,
  resid: { series: Data['residSeries']; areas: unknown[][]; start: number },
  contribKey: 'contribDfii' | 'contribDxy',
  barLabel: string,
  posColor: string,
  negColor: string,
): EChartsOption {
  const { series, areas, start } = resid
  return {
    ...chartAnimation,
    tooltip: chartTooltip(t, {
      valueFormatter: (v: any) => (v == null ? '--' : Number(v).toFixed(2)),
    }),
    legend: chartLegend(t, ['残差 z（总）', barLabel]),
    grid: chartGrid({ top: 32, bottom: 32 }),
    xAxis: categoryAxis(t, series.map((p) => p.date)),
    yAxis: [
      valueAxis(t, {
        name: 'z',
        nameTextStyle: { color: t.text3, fontSize: 10, align: 'left' },
      }),
      rightValueAxis(t, {
        name: '贡献',
        nameTextStyle: { color: t.text3, fontSize: 10, align: 'right' },
      }),
    ],
    dataZoom: [chartDataZoom(t, { start, end: 100 })],
    series: [
      lineSeries('残差 z（总）', series.map((p) => p.z), t.warn, {
        lineStyle: { width: 1.5, color: t.warn },
        itemStyle: { color: t.warn },
        z: 5,
        markLine: markLine([
          thresholdLine(2, t.down, '+2σ'),
          thresholdLine(-2, t.up, '-2σ'),
        ]),
        markArea: markArea(areas),
      }),
      {
        name: barLabel,
        type: 'bar',
        yAxisIndex: 1,
        data: series.map((p) => {
          const v = p[contribKey]
          if (v == null) return null
          return { value: v, itemStyle: { color: v >= 0 ? posColor : negColor } }
        }),
        barWidth: '40%',
      },
    ],
  } as EChartsOption
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
                  <span className="flex items-baseline gap-1.5">
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
    {
      key: 'n',
      header: '样本',
      numeric: true,
      render: ([, s]) =>
        s.n < 5 ? (
          <span
            className="inline-flex rounded-sm border border-warn/40 bg-warn/5 px-1 text-2xs text-warn"
            title="样本量低，置信度有限"
          >
            {s.n}
          </span>
        ) : (
          s.n
        ),
    },
    {
      key: 'win',
      header: '胜率',
      numeric: true,
      render: ([, s]) => (
        <span className="inline-flex w-20 flex-col items-stretch gap-1">
          <span className={`num ${s.winRate >= 0.5 ? 'text-up' : 'text-down'}`}>
            {fmtPct(s.winRate)}
          </span>
          <WinRateMeter value={s.winRate} />
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
        const base =
          'inline-flex items-center whitespace-nowrap rounded-sm border px-1 text-2xs'
        if (!aligned)
          return (
            <span
              className={`${base} border-warn/50 bg-warn/5 text-warn`}
              title="实际方向与模型预期相反（窗口内中位数）"
            >
              ⚠ 相反
            </span>
          )
        if (expected === 'neutral')
          return (
            <span className={`${base} border-line text-ink-3`} title="相关性失效，无方向含义">
              —
            </span>
          )
        if (s.n < 5)
          return (
            <span className={`${base} border-line text-ink-3`} title="样本不足，方向仅供参考">
              ~ 观察
            </span>
          )
        return (
          <span className={`${base} border-up/40 bg-up/5 text-up`} title="实际方向与模型预期一致">
            ✓ 一致
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

/** 三个分析视图：综合定价是两因子的合成结论（默认视图），
 *  美元 / 利率两个单因子视图结构平行、消费场景互斥，用 tab 切换。 */
type TabKey = 'both' | 'usd' | 'rate'

const TABS: { key: TabKey; label: string; desc: string }[] = [
  {
    key: 'both',
    label: '综合定价',
    desc: '把美元与实际利率两个因子合成为一个「金价公允度」度量：残差 z 偏高 = 金价相对两因子基准偏高。本视图回答「当前价格偏离由哪个因子解释、两条关系是否共振指向极端状态」，并以金价动量作为趋势背景。',
  },
  {
    key: 'usd',
    label: '美元因子',
    desc: '美元是黄金的计价货币，也是替代储备资产：美元走强通常压制金价。本视图单独评估这条关系的有效性（相关性区间）与当前美元环境的历史含义。',
  },
  {
    key: 'rate',
    label: '利率因子',
    desc: '实际利率是持有黄金的机会成本：利率上行抬升持金成本、通常压制金价。本视图单独评估利率-黄金范式是否稳固，以及当前利率环境下的历史表现。',
  },
]

export function GoldDecisionDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [tab, setTab] = useState<TabKey>('both')
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

  // ── ① 黄金 × 美元指数：双轴价格对比（不做多因子叠加，保持这条关系独立可读）──
  const priceDxyOption = useMemo<EChartsOption | null>(() => {
    if (!data?.priceChart?.length) return null
    const total = data.priceChart.length
    const defaultStart = defaultZoomStart(total)
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
          { lineStyle: { width: 1.3, color: t.series[2] } },
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

  // ── ② 黄金 × 实际利率：双轴价格对比 ──
  const priceDfiiOption = useMemo<EChartsOption | null>(() => {
    if (!data?.priceChart?.length) return null
    const total = data.priceChart.length
    const defaultStart = defaultZoomStart(total)
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t),
      legend: chartLegend(t, ['金价 (USD/oz)', '实际利率 DFII10 %']),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, data.priceChart.map((p) => p.date)),
      yAxis: [
        valueAxis(t, {
          name: 'Gold',
          nameTextStyle: { color: t.text3, fontSize: 10, align: 'left' },
        }),
        rightValueAxis(t, {
          name: 'DFII10 %',
          nameTextStyle: { color: t.text3, fontSize: 10, align: 'right' },
          axisLabel: {
            color: t.text3,
            fontSize: 10,
            fontFamily: t.fontMono,
            formatter: (v: number) => `${v.toFixed(1)}%`,
          },
        }),
      ],
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: [
        lineSeries(
          '金价 (USD/oz)',
          data.priceChart.map((p) => p.gold),
          t.series[2],
          { lineStyle: { width: 1.3, color: t.series[2] } },
        ),
        lineSeries(
          '实际利率 DFII10 %',
          data.priceChart.map((p) => p.dfii10),
          t.series[0],
          {
            yAxisIndex: 1,
            lineStyle: { width: 1.2, color: t.series[0], type: 'dashed' },
            markLine: markLine([
              { yAxis: 0, lineStyle: { color: t.up, type: 'dashed', width: 1 }, symbol: ['none', 'none'], label: { show: true, position: 'insideEndTop', formatter: '0%', color: t.up, fontSize: 9, fontFamily: 'monospace' } },
              { yAxis: 1, lineStyle: { color: t.down, type: 'dashed', width: 1 }, symbol: ['none', 'none'], label: { show: true, position: 'insideEndTop', formatter: '1%', color: t.down, fontSize: 9, fontFamily: 'monospace' } },
            ]),
          },
        ),
      ],
    } as EChartsOption
  }, [data, t])

  const corrOption = useMemo<EChartsOption | null>(() => {
    if (!data?.corrChart?.s60?.length) return null
    const total = data.corrChart.s60.length
    const defaultStart = defaultZoomStart(total)
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

  const corrIrrOption = useMemo<EChartsOption | null>(() => {
    if (!data?.corrIrrChart?.s60?.length) return null
    const total = data.corrIrrChart.s60.length
    const defaultStart = defaultZoomStart(total)
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v == null ? '--' : Number(v).toFixed(3)),
      }),
      legend: chartLegend(t, ['20 日', '60 日', '120 日']),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, data.corrIrrChart.s60.map((p) => p.date)),
      yAxis: valueAxis(t, { min: -1, max: 1, scale: false }),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: [
        lineSeries(
          '20 日',
          data.corrIrrChart.s20.map((p) => p.value),
          t.series[2],
          { lineStyle: { width: 1.2, color: t.series[2] } },
        ),
        lineSeries(
          '60 日',
          data.corrIrrChart.s60.map((p) => p.value),
          t.series[0],
          {
            lineStyle: { width: 1.4, color: t.series[0] },
            markLine: markLine([
              thresholdLine(-0.7, t.text3, '−0.7 长期均值'),
              thresholdLine(-0.4, t.warn, '−0.4 失锚警戒'),
              thresholdLine(0, t.up, '0'),
            ]),
          },
        ),
        lineSeries(
          '120 日',
          data.corrIrrChart.s120.map((p) => p.value),
          t.series[1],
          { lineStyle: { width: 1.2, color: t.series[1] } },
        ),
      ],
    } as EChartsOption
  }, [data, t])

  // 散点图工厂：X 分桶分位带 + 中位线 + 历史散点 + 当前位置。
  // 两个因子小节共用同一结构，只有 X 含义与配色不同。
  const buildScatterOption = (
    sd: ScatterData,
    xName: string,
    accentColor: string,
  ): EChartsOption | null => {
    if (!sd?.bins?.length) return null
    const bins = sd.bins

    // 分位带用 custom 矩形直接画 [q25, q75]：stacked bar 从 0 起堆，
    // 桶值为负时方向和起点全错，区间绘制只有 custom 是干净的。
    const xLabels = bins.map((b) => b.xMid.toFixed(2))
    const medianLine = bins.map((b) => +b.median.toFixed(4))

    // 历史散点必须归入所属分桶（xMin ≤ x < xMax），category 轴下
    // 拿原始 x 值当类目名会因匹配不上而被 ECharts 整批丢弃。
    const binIndexOf = (x: number): number | null => {
      for (let i = 0; i < bins.length; i++) {
        const b = bins[i]
        if (x >= b.xMin && (x < b.xMax || i === bins.length - 1)) return i
      }
      if (x < bins[0].xMin) return 0
      return bins.length - 1
    }
    const pts = (sd.points ?? []).flatMap((p) => {
      const bi = binIndexOf(p.x)
      return bi == null ? [] : [[xLabels[bi], p.y] as [string, number]]
    })
    const latestBin = sd.latest ? binIndexOf(sd.latest.x) : null

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        trigger: 'axis',
        // 单桶可能叠几百个历史点，tooltip 内容全高可达数千 px。
        // 不挂 body（全局 appendToBody 对超大 contentSize 定位会漂移），
        // 用原生 confine 夹在图表区内 + 高度封顶内部滚动，图表区本身不会被卡片裁剪
        appendToBody: false,
        confine: true,
        enterable: true,
        extraCssText:
          'box-shadow: 0 8px 24px rgba(0,0,0,0.35); border-radius: 5px; max-height: 300px; overflow-y: auto;',
        valueFormatter: (v: any) => (v == null ? '--' : `${(Number(v) * 100).toFixed(2)}%`),
      }),
      legend: chartLegend(t, ['50% 分位带 (Q25–Q75)', '中位收益', '历史点 (60D 收益)']),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, xLabels, {
        name: xName,
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: { color: t.text3, fontSize: 10 },
      }),
      yAxis: valueAxis(t, {
        name: '金价 60D 收益',
        nameTextStyle: { color: t.text3, fontSize: 10 },
        axisLabel: {
          color: t.text3,
          fontSize: 10,
          fontFamily: t.fontMono,
          formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
        },
      }),
      series: [
        {
          name: '50% 分位带 (Q25–Q75)',
          type: 'custom',
          zIndex: 1,
          tooltip: { show: false },
          renderItem: (_: any, api: any) => {
            const low = api.coord([api.value(0), api.value(1)])
            const high = api.coord([api.value(0), api.value(2)])
            const bandWidth = Math.max(api.size([1, 0])[0] * 0.45, 3)
            return {
              type: 'rect',
              shape: {
                x: low[0] - bandWidth / 2,
                y: Math.min(low[1], high[1]),
                width: bandWidth,
                height: Math.abs(low[1] - high[1]),
              },
              style: { fill: accentColor, opacity: 0.18 },
            }
          },
          encode: { x: 0, y: [1, 2] },
          data: bins.map((b, i) => [i, b.q25, b.q75]),
        },
        {
          name: '中位收益',
          type: 'line',
          data: medianLine,
          smooth: 0.3,
          showSymbol: false,
          connectNulls: true,
          lineStyle: { width: 1.6, color: accentColor },
          itemStyle: { color: accentColor },
          z: 3,
        },
        {
          name: '历史点 (60D 收益)',
          type: 'scatter',
          data: pts,
          symbolSize: 4,
          itemStyle: { color: t.text3, opacity: 0.5 },
          z: 2,
        },
        ...(sd.latest && latestBin != null
          ? [
              {
                name: '当前',
                type: 'scatter',
                data: [[xLabels[latestBin], sd.latest.y]],
                symbolSize: 16,
                itemStyle: { color: t.warn, borderColor: t.text, borderWidth: 1.5, shadowBlur: 8, shadowColor: t.warn },
                z: 5,
                label: {
                  show: true,
                  position: 'top' as const,
                  formatter: () => `${sd.latest!.date}\n${(sd.latest!.y * 100).toFixed(2)}%`,
                  color: t.warn,
                  fontSize: 10,
                  fontFamily: t.fontMono,
                },
              },
            ]
          : []),
      ],
    } as EChartsOption
  }

  const scatterDfiiOption = useMemo<EChartsOption | null>(
    () => (data ? buildScatterOption(data.scatterData, '实际利率 DFII10 %', t.series[0]) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, t],
  )

  const scatterDxyOption = useMemo<EChartsOption | null>(
    () => (data?.scatterDxy ? buildScatterOption(data.scatterDxy, '美元指数 DXY', t.series[1]) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, t],
  )

  // 残差 z 贡献分解：按因子拆成 DFII10 / DXY 两张图。
  // 背景区段、dataZoom 起始窗口等共享计算只做一次，两张图复用。
  const residBase = useMemo(() => {
    const series = data?.residSeries ?? []
    if (!series.length) return null
    // 从残差序列中切出"持续高估 / 持续低估"区间（z 跨 ±2 进入、回落离场，
    // 过滤持续 < 3 个交易日的尖峰），作为背景色块叠在图上
    const areas: unknown[][] = []
    for (const s of buildResidSpans(series, 3)) {
      areas.push([
        { xAxis: s.start, itemStyle: { color: s.dir === 'overvalued' ? t.downBg : t.upBg } },
        { xAxis: s.end },
      ])
    }
    const total = series.length
    return {
      series,
      areas,
      start: defaultZoomStart(total),
    }
  }, [data, t])

  const residDfiiOption = useMemo<EChartsOption | null>(
    () =>
      residBase
        ? buildResidFactorOption(
            t,
            residBase,
            'contribDfii',
            'DFII10 贡献',
            t.downSoft,
            t.upSoft,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [residBase, t],
  )

  const residDxyOption = useMemo<EChartsOption | null>(
    () =>
      residBase
        ? buildResidFactorOption(
            t,
            residBase,
            'contribDxy',
            'DXY 动量贡献',
            t.down,
            t.up,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [residBase, t],
  )

  const momentumOption = useMemo<EChartsOption | null>(() => {
    if (!data?.momentumChart?.m20?.length) return null
    const total = data.momentumChart.m20.length
    const defaultStart = defaultZoomStart(total)
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

  if (loading) return <LoadingSkeleton type="chart" />
  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  if (!data) return <ErrorState message="暂无数据" />

  const latest = data.latest
  const residTone =
    latest.residZ == null ? 'neutral' : latest.residZ >= 0 ? ('down' as const) : ('up' as const)
  // 实际利率对黄金的"友好度"：<0 看多友好，>1 看空，0~1 中性
  const dfiiTone: 'up' | 'warn' | 'down' =
    latest.dfii10 == null
      ? 'warn'
      : latest.dfii10 < 0
        ? 'up'
        : latest.dfii10 > 1
          ? 'down'
          : 'warn'

  // tab 标签上的状态速览：不切 tab 也能扫完三个因子的当前状态
  const tabBadges: Record<TabKey, { text: string; cls: string }> = {
    both: {
      text: `z ${signed(latest.residZ)} · P${latest.residPercentile.toFixed(0)}`,
      cls:
        latest.residZ == null
          ? 'text-ink-3'
          : latest.residZ >= 0
            ? 'text-down'
            : 'text-up',
    },
    usd: { text: latest.bandLabel, cls: 'text-info' },
    rate: {
      text: latest.dfii10 != null ? `${latest.dfii10.toFixed(2)}%` : '--',
      cls: dfiiTone === 'up' ? 'text-up' : dfiiTone === 'down' ? 'text-down' : 'text-warn',
    },
  }
  const activeTab = TABS.find((tb) => tb.key === tab) ?? TABS[0]

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      {/* 结论层常驻 — 只留「黄金自身 + 综合结论」，因子专属指标移入各自 tab */}
      <div className="lg:col-span-2">
        <MacroCard padding="sm" title="当前状态">
          <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <StatTile
              label="金价"
              value={latest.gold != null ? latest.gold.toFixed(2) : '--'}
              sub="USD / oz"
              tone="warn"
            />
            <StatTile
              label="金价动量 20D"
              value={latest.momentum20 != null ? `${(latest.momentum20 * 100).toFixed(2)}%` : '--'}
              sub="近20日对数收益"
              tone={latest.momentum20 == null ? 'neutral' : latest.momentum20 >= 0 ? 'up' : 'down'}
            />
            <StatTile
              label="金价动量 60D"
              value={latest.momentum60 != null ? `${(latest.momentum60 * 100).toFixed(2)}%` : '--'}
              sub="近60日对数收益"
              tone={latest.momentum60 == null ? 'neutral' : latest.momentum60 >= 0 ? 'up' : 'down'}
            />
            <StatTile
              label="定价残差 z"
              value={signed(latest.residZ)}
              sub={`5Y 分位 ${latest.residPercentile.toFixed(0)}`}
              tone={residTone}
            />
            <StatTile
              label="综合信号"
              value={DIR_LABEL[data.signal.direction]}
              sub={`置信度 ${data.signal.confidence}% · ${STRENGTH_LABEL[data.signal.strength]}`}
              tone={
                data.signal.direction === 'bullish'
                  ? 'up'
                  : data.signal.direction === 'bearish'
                    ? 'down'
                    : 'neutral'
              }
            />
          </div>
        </MacroCard>
      </div>

      {/* 主列：tab 切换综合定价 / 美元因子 / 利率因子 */}
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-1 lg:row-start-2">
        <div className="flex flex-col gap-2">
          <div
            role="tablist"
            aria-label="黄金分析视图"
            className="flex flex-wrap gap-2"
          >
            {TABS.map((tb) => {
              const active = tab === tb.key
              const badge = tabBadges[tb.key]
              return (
                <button
                  key={tb.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(tb.key)}
                  className={`flex items-baseline gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
                    active
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-surface-2 text-ink-2 hover:border-line-strong hover:text-ink'
                  }`}
                >
                  <span>{tb.label}</span>
                  <span className={`num text-2xs font-normal ${badge.cls}`}>
                    {badge.text}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="border-l-2 border-line-strong pl-3 text-2xs leading-relaxed text-ink-3">
            {activeTab.desc}
          </p>
        </div>

        {/* ── 综合定价（默认）：残差分解 → 残差事件研究 → 动量背景 ── */}
        {tab === 'both' && (
          <div role="tabpanel" className="flex flex-col gap-4">
            <MacroCard title="定价残差 z 贡献分解 · DFII10（实际利率）">
              <ResponsiveChartBox option={residDfiiOption} deps={[residDfiiOption]} />
              <p className="mt-2 text-2xs leading-relaxed text-ink-3">
                双因子模型：DFII10 + DXY 动量。
                <span className="text-warn">橙色线</span>（左轴）= 残差 z 总值（±2σ 阈值）。
                柱状（右轴）= DFII10 对残差的贡献：<span className="text-down">红色</span> = 正向贡献（推高 z）/ <span className="text-up">绿色</span> = 负向贡献。
                背景色块：残差持续偏离区间（<span className="text-down">浅红=高估 z≥2</span> / <span className="text-up">浅绿=低估 z≤-2</span>，持续≥3 个交易日）。
                贡献与 z 分别按各自量级定标（DFII10 是主导因子），可识别当前偏离主要由哪个因子解释。
              </p>
              {(data.extremes?.length ?? 0) > 0 && (
                <p className="mt-1 text-2xs leading-relaxed text-ink-3">
                  历史极端点（<span className="num">{data.extremes!.length}</span>）：
                  {data.extremes!
                    .slice(-8)
                    .map((e) => `${e.date}(${e.dir === 'overvalued' ? '高估' : '低估'})`)
                    .join(' · ')}
                </p>
              )}
            </MacroCard>

            <MacroCard title="定价残差 z 贡献分解 · DXY（美元动量）">
              <ResponsiveChartBox option={residDxyOption} deps={[residDxyOption]} />
              <p className="mt-2 text-2xs leading-relaxed text-ink-3">
                DXY 贡献单独成图并独立定标：其对残差的贡献量级约为 DFII10 的
                <span className="num">1/200</span>，与 z 共用同一 y 轴时柱子高度不足 1px、肉眼等同空图。
                <span className="text-warn">橙色线</span>（左轴）= 残差 z 总值（±2σ 阈值）。
                柱状（右轴）= DXY 动量对残差的贡献：<span className="text-down">红色</span> = 正向贡献 / <span className="text-up">绿色</span> = 负向贡献。
                贡献项为「系数 × 因子偏离均值」，二者之和并不等于 z（残差窗口与因子均值窗口口径不同），
                仅用于比较两个因子谁更值得注意。
              </p>
            </MacroCard>

            <MacroCard title="事件研究：定价残差极值后的黄金后市收益">
              {data.eventStudies && (
                <>
              <StudyTable
                title="残差高估（z ≥ 2）后"
                study={data.eventStudies.overvalued}
                expected="bearish"
                triggerHint="双因子定价残差 z 首次向上突破 +2σ"
              />
              <StudyTable
                title="残差低估（z ≤ -2）后"
                study={data.eventStudies.undervalued}
                expected="bullish"
                triggerHint="双因子定价残差 z 首次向下突破 -2σ"
              />
              {data.eventStudies.overvalued.nEvents === 0 &&
                data.eventStudies.undervalued.nEvents === 0 && (
                  <p className="py-3 text-xs text-ink-3">
                    历史事件不足，样本积累后自动生成验证统计。
                  </p>
                )}
                </>
              )}
            </MacroCard>

            <MacroCard title="金价动量（20D / 60D 对数收益率累加）">
              <ResponsiveChartBox option={momentumOption} deps={[momentumOption]} />
              <p className="mt-2 text-2xs leading-relaxed text-ink-3">
                说明：正值表示上涨趋势，负值表示下跌趋势。20D 反映短期，60D 反映中期动量。
              </p>
            </MacroCard>
          </div>
        )}

        {/* ── 美元因子 ── */}
        {tab === 'usd' && (
          <div role="tabpanel" className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <StatTile
                label="美元指数 DXY"
                value={latest.dxy != null ? latest.dxy.toFixed(2) : '--'}
                tone="info"
              />
              <StatTile
                label="相关 20/60/120"
                value={`${latest.corr20.toFixed(2)} / ${latest.corr60.toFixed(2)} / ${latest.corr120.toFixed(2)}`}
                sub="vs DXY · 收益率口径"
              />
              <StatTile
                label="关联状态"
                value={latest.bandLabel}
                sub={`60日相关 ${latest.corr60.toFixed(2)}`}
                tone="info"
                tooltip={latest.bandDesc}
              />
            </div>

            <MacroCard title="金价 vs 美元指数">
              <ResponsiveChartBox option={priceDxyOption} deps={[priceDxyOption]} />
              <p className="mt-2 text-2xs leading-relaxed text-ink-3">
                双轴：左=金价、右=DXY。观察两条线的反向镜像关系——美元走强阶段金价是否承压，
                以及近年的背离（央行购金等结构性买盘会削弱该关系）。
              </p>
            </MacroCard>

            <MacroCard title="黄金-美元收益率滚动相关（20 / 60 / 120 日）">
              <ResponsiveChartBox option={corrOption} deps={[corrOption]} />
              <p className="mt-2 text-2xs leading-relaxed text-ink-3">
                说明：越向下越负相关（经典范式）；高于 -0.15 即「失效区间」。
                <span className="text-warn">黄色竖线</span>：相关性失效/正相关切换事件。
              </p>
            </MacroCard>

            {scatterDxyOption && (
              <MacroCard title="美元指数 vs 金价 60D 收益（散点 + 分位带）">
                <ResponsiveChartBox option={scatterDxyOption} deps={[scatterDxyOption]} />
                <p className="mt-2 text-2xs leading-relaxed text-ink-3">
                  X=当日美元指数，Y=当日金价相对 60 日前的对数收益。
                  分位带=同一美元水平桶内金价 60D 收益的 25–75 分位，
                  <span className="text-warn">橙色大点</span>=当前所在位置。
                  可直观判断「当前美元环境下，黄金历史表现是好是差」。
                </p>
              </MacroCard>
            )}

            <MacroCard title="事件研究：美元关系失效后的黄金后市收益">
              {data.eventStudies && (
                <StudyTable
                  title="相关性失效/正相关切换后"
                  study={data.eventStudies.broken}
                  expected="neutral"
                  triggerHint="滚动 60 日黄金-美元收益率相关从负转非负（相关系数 ≥ -0.15）"
                />
              )}
            </MacroCard>
          </div>
        )}

        {/* ── 利率因子 ── */}
        {tab === 'rate' && (
          <div role="tabpanel" className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <StatTile
                label="实际利率 DFII10"
                value={latest.dfii10 != null ? `${latest.dfii10.toFixed(2)}%` : '--'}
                sub="10Y TIPS · <0 黄金友好 / >1 承压"
                tone={dfiiTone}
              />
              <StatTile
                label="盈亏平衡 T10YIE"
                value={latest.t10yie != null ? `${latest.t10yie.toFixed(2)}%` : '--'}
                sub="10Y Breakeven"
                tone="warn"
              />
            </div>

            <MacroCard title="金价 vs 10Y 实际利率">
              <ResponsiveChartBox option={priceDfiiOption} deps={[priceDfiiOption]} />
              <p className="mt-2 text-2xs leading-relaxed text-ink-3">
                双轴：左=金价、右=DFII10%（虚线）。
                实际利率参考线：<span className="text-up">0% 绿色</span>=零利率分水岭 / <span className="text-down">1% 红色</span>=紧缩警戒。
              </p>
            </MacroCard>

            <MacroCard title="黄金-实际利率收益率滚动相关（20 / 60 / 120 日）">
              <ResponsiveChartBox option={corrIrrOption} deps={[corrIrrOption]} />
              <p className="mt-2 text-2xs leading-relaxed text-ink-3">
                实际利率与金价收益率的滚动相关。长期均值约 -0.7~-0.85，越深负值范式越稳固。
                上穿 <span className="text-warn">-0.4</span> 视为「实际利率失锚」预警，
                上穿 0 视为范式反转。
              </p>
            </MacroCard>

            <MacroCard title="实际利率 vs 金价 60D 收益（散点 + 分位带）">
              <ResponsiveChartBox option={scatterDfiiOption} deps={[scatterDfiiOption]} />
              <p className="mt-2 text-2xs leading-relaxed text-ink-3">
                X=当日实际利率，Y=当日金价相对 60 日前的对数收益。
                <span className="text-info">蓝色带</span>=同一利率桶内金价 60D 收益的 25–75 分位，
                <span className="text-info">蓝色线</span>=中位收益。
                <span className="text-warn">橙色大点</span>=当前所在位置。
                可直观判断「当前利率环境下，黄金历史表现是好是差」。
              </p>
            </MacroCard>
          </div>
        )}
      </div>

      {/* 右栏：信号（结论常驻，不随 tab 切换） */}
      <aside className="flex flex-col gap-3 lg:col-span-1 lg:col-start-2 lg:row-start-2 lg:sticky lg:top-[calc(var(--topbar-height)+16px)]">
        <SignalPanel signal={data.signal} />
      </aside>
    </div>
  )
}

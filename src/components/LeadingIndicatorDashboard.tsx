import { useEffect, useMemo, useState } from 'react'
import { MacroCard } from './ui/MacroCard'
import { StatTile } from './ui/StatTile'
import { useChartTheme } from './ui/theme'
import { LoadingSkeleton } from './ui/LoadingSkeleton'
import { ErrorState, EmptyState } from './ui/States'
import { ResponsiveChartBox } from './charts/ChartBox'
import {
  barSeries,
  categoryAxis,
  chartAnimation,
  chartDataZoom,
  chartGrid,
  chartLegend,
  chartTooltip,
  lineSeries,
  markLine,
  rightValueAxis,
  thresholdLine,
  valueAxis,
} from '../lib/chartOptions'
// 从 seriesMath 导入纯函数，避免把 lib/db（数据库驱动）打进浏览器包
import { lastValue, yoySeries, type Point } from '../lib/seriesMath'
import type { LeadingCode, LeadingResponse, LeadingSeries, SahmSignal } from '../lib/core'

function toPoints(series?: LeadingSeries): Point[] {
  return (series?.data ?? [])
    .filter((p): p is { date: string; value: number } => p.value != null)
    .map((p) => ({ date: p.date, value: p.value }))
}

function axisNameStyle(color: string) {
  return { color, fontSize: 10, align: 'left' as const }
}

/** 简单移动平均，窗口不足返回 null */
function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null
    // 先用类型谓词过滤掉 null，再判断是否凑满窗口 —— 顺带让 reduce 的累加器是 number
    const win = values
      .slice(i - window + 1, i + 1)
      .filter((v): v is number => v != null)
    if (win.length < window) return null
    return +(win.reduce((s, v) => s + v, 0) / window).toFixed(1)
  })
}

/* --------------------------------------------------------------------------- */

/**
 * Sahm Rule 走势：失业率 3 月均线相对过去 12 个月低点的抬升幅度。
 * 画 0.5 阈值线，触线区间是历史上衰退已开始的时点。
 */
function SahmChart({ sahm, threshold }: { sahm: { date: string; value: number | null }[]; threshold: number }) {
  const t = useChartTheme()

  const option = useMemo(() => {
    if (!sahm.length) return null
    const dates = sahm.map((p) => p.date)
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v != null ? Number(v).toFixed(3) : '--'),
      }),
      grid: chartGrid({ top: 14, bottom: 30 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, {
        name: 'pp',
        nameTextStyle: axisNameStyle(t.text3),
      }),
      dataZoom: [chartDataZoom(t, { start: 0, end: 100 })],
      series: [
        lineSeries(
          'Sahm Rule',
          sahm.map((p) => p.value),
          t.down,
          {
            lineStyle: { width: 1.3, color: t.down },
            areaStyle: { color: t.down, opacity: 0.08 },
            markLine: markLine([thresholdLine(threshold, t.warn, `阈值 ${threshold}`)]),
          },
        ),
      ],
    }
  }, [sahm, threshold, t])

  if (!option) return <EmptyState title="Sahm Rule 数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/**
 * NFCI 金融状况指数。零轴上下是分水岭：
 * 大于 0 = 金融环境比平均更紧，历史上衰退前几乎都会转正。
 */
function NfciChart({ series }: { series: LeadingSeries[] }) {
  const t = useChartTheme()

  const option = useMemo(() => {
    const nfci = series.find((s) => s.code === 'NFCI')
    if (!nfci?.data.length) return null
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v != null ? Number(v).toFixed(3) : '--'),
      }),
      grid: chartGrid({ top: 14, bottom: 30 }),
      xAxis: categoryAxis(t, nfci.data.map((p) => p.date)),
      yAxis: valueAxis(t, { name: '指数', nameTextStyle: axisNameStyle(t.text3) }),
      dataZoom: [chartDataZoom(t, { start: 50, end: 100 })],
      series: [
        lineSeries(
          'NFCI',
          nfci.data.map((p) => p.value),
          t.series[1],
          {
            lineStyle: { width: 1.3, color: t.series[1] },
            areaStyle: { color: t.series[1], opacity: 0.08 },
            markLine: markLine([thresholdLine(0, t.border, '零轴')]),
          },
        ),
      ],
    }
  }, [series, t])

  if (!option) return <EmptyState title="NFCI 数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/**
 * 初请失业金：周频，是就业市场最高频的温度计。
 * 单周数据噪音大，叠加 4 周移动均线看趋势。
 */
function ClaimsChart({ series }: { series: LeadingSeries[] }) {
  const t = useChartTheme()

  const option = useMemo(() => {
    const icsa = series.find((s) => s.code === 'ICSA')
    if (!icsa?.data.length) return null
    const dates = icsa.data.map((p) => p.date)
    const vals = icsa.data.map((p) => p.value)
    const ma4 = movingAverage(vals, 4)

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {}),
      legend: chartLegend(t, ['初请失业金', '4 周均线']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, {
        name: '万人',
        nameTextStyle: axisNameStyle(t.text3),
        axisLabel: {
          color: t.text3,
          fontSize: 10,
          fontFamily: t.fontMono,
          formatter: (v: number) => `${(v / 10000).toFixed(0)}`,
        },
      }),
      dataZoom: [chartDataZoom(t, { start: 50, end: 100 })],
      series: [
        barSeries('初请失业金', vals, t.series[2], {
          barMaxWidth: 2,
          itemStyle: { color: t.series[2], borderRadius: 1, opacity: 0.4 },
        }),
        lineSeries('4 周均线', ma4, t.series[0], {
          lineStyle: { width: 1.4, color: t.series[0] },
        }),
      ],
    }
  }, [series, t])

  if (!option) return <EmptyState title="初请失业金数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/**
 * 生产与需求：工业产出与核心资本品订单，都转成同比后同轴比较。
 * 原始量纲（指数 vs 百万美元）无法直接同图，同比化是唯一可比口径。
 */
function ProductionChart({ series }: { series: LeadingSeries[] }) {
  const t = useChartTheme()

  const option = useMemo(() => {
    const indpro = series.find((s) => s.code === 'INDPRO')
    const capex = series.find((s) => s.code === 'CORE_CAPEX_ORDERS')
    if (!indpro?.data.length && !capex?.data.length) return null

    const indproPts = toPoints(indpro)
    const capexPts = toPoints(capex)
    const axis = Array.from(
      new Set([...indproPts.map((p) => p.date), ...capexPts.map((p) => p.date)]),
    ).sort()

    const indproYoy = new Map(yoySeries(indproPts).map((p) => [p.date, p.value]))
    const capexYoy = new Map(yoySeries(capexPts).map((p) => [p.date, p.value]))

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v != null ? `${Number(v).toFixed(2)}%` : '--'),
      }),
      legend: chartLegend(t, ['工业产出 同比', '核心资本品订单 同比']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, axis),
      yAxis: valueAxis(t, {
        name: '同比 %',
        nameTextStyle: axisNameStyle(t.text3),
        axisLabel: {
          color: t.text3,
          fontSize: 10,
          fontFamily: t.fontMono,
          formatter: '{value}%',
        },
      }),
      dataZoom: [chartDataZoom(t, { start: 50, end: 100 })],
      series: [
        lineSeries(
          '工业产出 同比',
          axis.map((d) => indproYoy.get(d) ?? null),
          t.series[3],
          { lineStyle: { width: 1.3, color: t.series[3] } },
        ),
        lineSeries(
          '核心资本品订单 同比',
          axis.map((d) => capexYoy.get(d) ?? null),
          t.series[4],
          { lineStyle: { width: 1.2, color: t.series[4] } },
        ),
      ],
    }
  }, [series, t])

  if (!option) return <EmptyState title="生产与需求数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/** 地产与信心：营建许可（千套）+ 密歇根消费者信心（指数），双轴 */
function PropertyChart({ series }: { series: LeadingSeries[] }) {
  const t = useChartTheme()

  const option = useMemo(() => {
    const permit = series.find((s) => s.code === 'PERMIT')
    const sent = series.find((s) => s.code === 'CONSUMER_SENT')
    if (!permit?.data.length && !sent?.data.length) return null

    const axis = Array.from(
      new Set([
        ...(permit?.data ?? []).map((p) => p.date),
        ...(sent?.data ?? []).map((p) => p.date),
      ]),
    ).sort()

    const permitMap = new Map((permit?.data ?? []).map((p) => [p.date, p.value]))
    const sentMap = new Map((sent?.data ?? []).map((p) => [p.date, p.value]))

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {}),
      legend: chartLegend(t, ['营建许可', '密歇根消费者信心 (右轴)']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, axis),
      yAxis: [
        valueAxis(t, { name: '千套', nameTextStyle: axisNameStyle(t.text3) }),
        rightValueAxis(t, { name: '指数', nameTextStyle: axisNameStyle(t.text3) }),
      ],
      dataZoom: [chartDataZoom(t, { start: 50, end: 100 })],
      series: [
        lineSeries(
          '营建许可',
          axis.map((d) => permitMap.get(d) ?? null),
          t.series[5],
          {
            lineStyle: { width: 1.3, color: t.series[5] },
            areaStyle: { color: t.series[5], opacity: 0.06 },
          },
        ),
        lineSeries(
          '密歇根消费者信心 (右轴)',
          axis.map((d) => sentMap.get(d) ?? null),
          t.series[0],
          { yAxisIndex: 1, lineStyle: { width: 1.2, color: t.series[0] } },
        ),
      ],
    }
  }, [series, t])

  if (!option) return <EmptyState title="地产与信心数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/* --------------------------------------------------------------------------- */

function SahmAlertCard({ signal, sahm }: { signal: SahmSignal; sahm: { date: string; value: number | null }[] }) {
  const accent = signal.triggered ? 'red' : (signal.value ?? 0) >= 0.3 ? 'gold' : 'green'
  const tone = signal.triggered ? 'text-down' : (signal.value ?? 0) >= 0.3 ? 'text-warn' : 'text-up'

  return (
    <MacroCard
      title="Sahm Rule 衰退信号"
      variant="elevated"
      accent={accent}
      badge={
        <span className={`rounded-sm border px-1.5 py-px text-2xs font-semibold ${tone} ${
          signal.triggered ? 'border-down/40' : (signal.value ?? 0) >= 0.3 ? 'border-warn/40' : 'border-up/40'
        }`}>
          {signal.triggered ? '已触发' : (signal.value ?? 0) >= 0.3 ? '警戒' : '安全'}
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <span className="text-2xs uppercase tracking-wider text-ink-3">当前值</span>
          <div className={`num text-3xl font-bold leading-none ${tone}`}>
            {signal.value == null ? '--' : signal.value.toFixed(3)}
          </div>
        </div>
        <div>
          <span className="text-2xs uppercase tracking-wider text-ink-3">触发阈值</span>
          <div className="num text-xl font-semibold leading-none text-ink-2">
            {signal.threshold.toFixed(2)}
          </div>
        </div>
      </div>
      <SahmChart sahm={sahm} threshold={signal.threshold} />
      <p className="mt-2 text-2xs leading-relaxed text-ink-3">
        Sahm Rule = 失业率 3 个月移动平均 − 过去 12 个月该均线的最低值。
        突破 0.5 时，历史上经济几乎都已在衰退中（NBER 事后确认）。
        {signal.value != null && <> 当前状态：{signal.status}。</>}
      </p>
    </MacroCard>
  )
}

/* --------------------------------------------------------------------------- */

const TILES: { code: LeadingCode; label: string; yoy?: boolean }[] = [
  { code: 'UNRATE', label: '失业率' },
  { code: 'NFCI', label: 'NFCI 金融状况' },
  { code: 'ICSA', label: '初请失业金' },
  { code: 'CAPACITY_UTIL', label: '产能利用率' },
  { code: 'INDPRO', label: '工业产出 同比', yoy: true },
  { code: 'PERMIT', label: '营建许可 同比', yoy: true },
]

export default function LeadingIndicatorDashboard() {
  const [data, setData] = useState<LeadingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/v1/leading.json')
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
        if (!cancelled) setData(json.data as LeadingResponse)
      } catch (e: any) {
        if (!cancelled) setError(e.message || '网络错误')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const stats = useMemo(() => {
    const out = {} as Record<string, { cur: number | null; yoy: number | null; unit: string }>
    for (const s of data?.series ?? []) {
      const pts = toPoints(s)
      out[s.code] = { cur: lastValue(pts), yoy: lastValue(yoySeries(pts)), unit: s.unit }
    }
    return out
  }, [data])

  if (loading) return <LoadingSkeleton type="card" rows={3} height={320} />
  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  if (!data) return <EmptyState title="暂无数据" />

  const hasSeries = data.series.some((s) => s.data.length > 0)
  if (!hasSeries) {
    return (
      <EmptyState
        title="领先指标数据尚未同步"
        description="请先执行 python run_sync.py leading 拉取 FRED 领先指标序列。"
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <SahmAlertCard signal={data.sahmSignal} sahm={data.sahm ?? []} />

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-3">
        {TILES.map(({ code, label, yoy }) => {
          const s = stats[code]
          const shown = yoy ? s?.yoy : s?.cur
          const suffix = yoy ? '%' : s?.unit === '%' ? '%' : ''
          const isPct = yoy || s?.unit === '%'
          return (
            <StatTile
              key={code}
              label={label}
              value={
                shown == null
                  ? '--'
                  : isPct
                    ? `${shown >= 0 ? '+' : ''}${shown.toFixed(2)}${suffix}`
                    : shown.toFixed(1)
              }
              sub={s?.unit ? `单位：${s.unit}` : undefined}
              tone={
                shown == null || isPct
                  ? 'neutral'
                  : code === 'NFCI'
                    ? shown >= 0
                      ? 'down'
                      : 'up'
                    : 'neutral'
              }
            />
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MacroCard title="NFCI — 金融状况指数">
          <NfciChart series={data.series} />
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
            零轴是分水岭：大于 0 表示金融环境比历史平均更紧。
            历史上每次衰退前 NFCI 都会明显转正，是最稳定的系统性压力指标之一。
          </p>
        </MacroCard>

        <MacroCard title="初请失业金 — 就业最高频温度计">
          <ClaimsChart series={data.series} />
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
            周频发布，比非农（月频）快得多，是捕捉就业拐点的第一现场。
            单周噪音大，看 4 周均线的方向更可靠。
          </p>
        </MacroCard>
      </div>

      <MacroCard title="生产与需求 — 同比口径">
        <ProductionChart series={data.series} />
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
          工业产出反映「现在生产了多少」，核心资本品订单（剔除飞机与国防）反映
          「企业准备投多少」—— 后者是 GDP 设备投资分项的前瞻。两者原始量纲不同
          （指数 vs 百万美元），转成同比后才可比。
        </p>
      </MacroCard>

      <MacroCard title="地产与信心 — 利率传导最灵敏的两端">
        <PropertyChart series={data.series} />
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
          地产是利率传导最灵敏的部门，营建许可又是地产里最领先的环节；
          密歇根消费者信心则前瞻居民消费意愿。两者同时走弱，通常意味着需求侧已明显降温。
        </p>
      </MacroCard>
    </div>
  )
}

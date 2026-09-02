import { useEffect, useMemo, useState } from 'react'
import { MacroCard } from './ui/MacroCard'
import { StatTile } from './ui/StatTile'
import { useChartTheme } from './ui/theme'
import { LoadingSkeleton } from './ui/LoadingSkeleton'
import { ErrorState, EmptyState } from './ui/States'
import { ResponsiveChartBox } from './charts/ChartBox'
import {
  categoryAxis,
  chartAnimation,
  chartDataZoom,
  chartGrid,
  chartLegend,
  chartTooltip,
  lineSeries,
  rightValueAxis,
  valueAxis,
} from '../lib/chartOptions'
// 从 seriesMath 导入纯函数，避免把 lib/db（数据库驱动）打进浏览器包
import { asOfLookup, lastValue, yoySeries, type Point } from '../lib/seriesMath'
import type {
  CommodityCode,
  CommodityResponse,
  CommoditySeries,
  CommoditySpreadPoint,
} from '../lib/core'

function LegendNote({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-3">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: i.color }}
            aria-hidden="true"
          />
          {i.label}
        </span>
      ))}
    </div>
  )
}

/** 抽掉 null 后转成 as-of 查找可用的点集 */
function toPoints(series?: CommoditySeries): Point[] {
  return (series?.data ?? [])
    .filter((p): p is { date: string; value: number } => p.value != null)
    .map((p) => ({ date: p.date, value: p.value }))
}

function axisNameStyle(color: string) {
  return { color, fontSize: 10, align: 'left' as const }
}

/* --------------------------------------------------------------------------- */

/**
 * 能源：WTI、布伦特（左轴，美元/桶）+ Henry Hub 天然气（右轴）。
 * 天然气单价只有几美元，若与原油共用一轴会被完全压平，必须双轴。
 */
function EnergyChart({ series }: { series: CommoditySeries[] }) {
  const t = useChartTheme()

  const option = useMemo(() => {
    const wti = series.find((s) => s.code === 'WTI')
    const brent = series.find((s) => s.code === 'BRENT')
    const gas = series.find((s) => s.code === 'NATGAS')

    // 以 WTI 交易日为主轴（原油是日频里流动性最好的品种）
    const axisSource = wti?.data.length ? wti : brent
    if (!axisSource?.data.length) return null
    const axis = axisSource.data.map((p) => p.date)

    const wtiPts = toPoints(wti)
    const brentPts = toPoints(brent)
    const gasPts = toPoints(gas)

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {}),
      legend: chartLegend(t, ['WTI', '布伦特', '天然气 (右轴)']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, axis),
      yAxis: [
        valueAxis(t, { name: '美元/桶', nameTextStyle: axisNameStyle(t.text3) }),
        rightValueAxis(t, { name: '美元/百万英热', nameTextStyle: axisNameStyle(t.text3) }),
      ],
      dataZoom: [chartDataZoom(t, { start: 50, end: 100 })],
      series: [
        lineSeries('WTI', axis.map((d) => asOfLookup(wtiPts, d)), t.series[1], {
          lineStyle: { width: 1.3, color: t.series[1] },
        }),
        lineSeries('布伦特', axis.map((d) => asOfLookup(brentPts, d)), t.series[2], {
          lineStyle: { width: 1.2, color: t.series[2] },
        }),
        ...(gasPts.length
          ? [
              lineSeries(
                '天然气 (右轴)',
                axis.map((d) => asOfLookup(gasPts, d)),
                t.series[5],
                { yAxisIndex: 1, lineStyle: { width: 1.1, color: t.series[5] } },
              ),
            ]
          : []),
      ],
    }
  }, [series, t])

  if (!option) return <EmptyState title="能源价格数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/** 金属：铜与铁矿石，量纲一致（美元/吨），可共用单轴直接比较 */
function MetalsChart({ series }: { series: CommoditySeries[] }) {
  const t = useChartTheme()

  const option = useMemo(() => {
    const copper = series.find((s) => s.code === 'COPPER')
    const iron = series.find((s) => s.code === 'IRON_ORE')
    if (!copper?.data.length && !iron?.data.length) return null

    // 两条都是月频，取并集日期后用 as-of 对齐，避免各自断点导致图形错位
    const axis = Array.from(
      new Set([
        ...(copper?.data ?? []).map((p) => p.date),
        ...(iron?.data ?? []).map((p) => p.date),
      ]),
    ).sort()

    const copperPts = toPoints(copper)
    const ironPts = toPoints(iron)

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {}),
      legend: chartLegend(t, ['铜', '铁矿石']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, axis),
      yAxis: valueAxis(t, { name: '美元/吨', nameTextStyle: axisNameStyle(t.text3) }),
      dataZoom: [chartDataZoom(t, { start: 50, end: 100 })],
      series: [
        lineSeries('铜', axis.map((d) => asOfLookup(copperPts, d)), t.series[3], {
          lineStyle: { width: 1.3, color: t.series[3] },
          areaStyle: { color: t.series[3], opacity: 0.06 },
        }),
        lineSeries('铁矿石', axis.map((d) => asOfLookup(ironPts, d)), t.series[4], {
          lineStyle: { width: 1.2, color: t.series[4] },
        }),
      ],
    }
  }, [series, t])

  if (!option) return <EmptyState title="金属价格数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/** 相对价值：布伦特-WTI 价差 + 金油比 */
function SpreadsChart({ spreads }: { spreads: CommoditySpreadPoint[] }) {
  const t = useChartTheme()

  const option = useMemo(() => {
    if (!spreads.length) return null
    const dates = spreads.map((p) => p.date)

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {}),
      legend: chartLegend(t, ['布伦特-WTI 价差', '金油比 (右轴)']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, dates),
      yAxis: [
        valueAxis(t, { name: '美元/桶', nameTextStyle: axisNameStyle(t.text3) }),
        rightValueAxis(t, { name: '倍', nameTextStyle: axisNameStyle(t.text3) }),
      ],
      dataZoom: [chartDataZoom(t, { start: 50, end: 100 })],
      series: [
        lineSeries(
          '布伦特-WTI 价差',
          spreads.map((p) => p.brentWti),
          t.series[1],
          { lineStyle: { width: 1.2, color: t.series[1] } },
        ),
        lineSeries(
          '金油比 (右轴)',
          spreads.map((p) => p.goldOilRatio),
          t.series[2],
          { yAxisIndex: 1, lineStyle: { width: 1.2, color: t.series[2] } },
        ),
      ],
    }
  }, [spreads, t])

  if (!option) return <EmptyState title="价差数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/* --------------------------------------------------------------------------- */

const TILE_ORDER: { code: CommodityCode; label: string }[] = [
  { code: 'WTI', label: 'WTI 原油' },
  { code: 'BRENT', label: '布伦特原油' },
  { code: 'NATGAS', label: 'Henry Hub 天然气' },
  { code: 'COPPER', label: '铜 (LME)' },
  { code: 'IRON_ORE', label: '铁矿石' },
]

export default function CommodityDashboard() {
  const [data, setData] = useState<CommodityResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const t = useChartTheme()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/v1/commodities.json')
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
        if (!cancelled) setData(json.data as CommodityResponse)
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
    const out = {} as Record<
      string,
      { cur: number | null; yoy: number | null; unit: string }
    >
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
        title="大宗商品数据尚未同步"
        description="请先执行 python run_sync.py commodities 拉取 FRED 商品序列。"
      />
    )
  }

  const spreadLast = data.spreads?.[data.spreads.length - 1] ?? null

  return (
    <div className="flex flex-col gap-4">
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
        {TILE_ORDER.map(({ code, label }) => {
          const s = stats[code]
          const yoy = s?.yoy ?? null
          return (
            <StatTile
              key={code}
              label={label}
              value={s?.cur == null ? '--' : s.cur.toFixed(2)}
              sub={
                yoy == null
                  ? s?.unit || undefined
                  : `同比 ${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%`
              }
              tone={yoy == null ? 'neutral' : yoy >= 0 ? 'up' : 'down'}
            />
          )
        })}
      </div>

      <MacroCard title="能源 — 原油与天然气">
        <EnergyChart series={data.series} />
        <LegendNote
          items={[
            { color: t.series[1], label: 'WTI 原油（美元/桶）' },
            { color: t.series[2], label: '布伦特原油（美元/桶）' },
            { color: t.series[5], label: 'Henry Hub 天然气（右轴，美元/百万英热）' },
          ]}
        />
      </MacroCard>

      <MacroCard title="金属 — 铜与铁矿石">
        <MetalsChart series={data.series} />
        <LegendNote
          items={[
            { color: t.series[3], label: '铜（美元/吨）— 制造业景气' },
            { color: t.series[4], label: '铁矿石（美元/吨）— 基建与地产' },
          ]}
        />
      </MacroCard>

      <MacroCard
        title="相对价值 — 价差与金油比"
        badge={
          spreadLast?.goldOilRatio != null ? (
            <span className="num rounded-sm border border-line px-1.5 py-px text-2xs text-ink-2">
              金油比 {spreadLast.goldOilRatio.toFixed(1)}
            </span>
          ) : undefined
        }
      >
        <SpreadsChart spreads={data.spreads ?? []} />
        <LegendNote
          items={[
            { color: t.series[1], label: '布伦特-WTI 价差（左轴）— 走阔通常反映跨区运输瓶颈或地缘溢价' },
            { color: t.series[2], label: '金油比（右轴）— 走高多为避险情绪升温或需求走弱' },
          ]}
        />
        {spreadLast?.goldOilRatio == null && (
          <p className="mt-1.5 text-2xs text-ink-3">
            金油比需要黄金历史数据（gold_price_history 表），请先执行 run_sync.py gold_decision。
          </p>
        )}
      </MacroCard>
    </div>
  )
}

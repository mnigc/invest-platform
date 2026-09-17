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
  valueAxis,
} from '../lib/chartOptions'
// 从 seriesMath 导入纯函数，避免把 lib/db（数据库驱动）打进浏览器包
import { asOfLookup, lastValue, yoySeries, type Point } from '../lib/seriesMath'
import type { CpiCode, CpiResponse, CpiSeries } from '../lib/core'

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
function toPoints(series?: CpiSeries): Point[] {
  return (series?.data ?? [])
    .filter((p): p is { date: string; value: number } => p.value != null)
    .map((p) => ({ date: p.date, value: p.value }))
}

/** 指数水平 → 同比点集（去掉 12 个月窗口内的 null） */
function yoyPts(series?: CpiSeries): Point[] {
  return yoySeries(toPoints(series)).filter(
    (p): p is Point => p.value != null,
  )
}

function axisNameStyle(color: string) {
  return { color, fontSize: 10, align: 'left' as const }
}

/** 联储 2% 目标参考线（挂在第一条曲线上） */
function targetLine(color: string) {
  return {
    silent: true,
    symbol: ['none', 'none'],
    animation: false,
    data: [
      {
        yAxis: 2,
        lineStyle: { color, type: 'dashed' as const, width: 1 },
        label: {
          formatter: '联储目标 2%',
          color,
          fontSize: 10,
          position: 'insideEndTop' as const,
        },
      },
    ],
  }
}

/* --------------------------------------------------------------------------- */

/** 通胀全景：CPI / 核心 CPI / PCE / 核心 PCE 四条同比曲线 */
function OverviewChart({ series }: { series: CpiSeries[] }) {
  const t = useChartTheme()

  const option = useMemo(() => {
    const cpi = series.find((s) => s.code === 'CPI')
    const coreCpi = series.find((s) => s.code === 'CPILFESL')
    const pce = series.find((s) => s.code === 'PCEPI')
    const corePce = series.find((s) => s.code === 'PCEPILFE')

    // 以历史最长的序列作为月频主轴（CPI 自 1947 年起）
    const axisSource = [cpi, pce, coreCpi, corePce]
      .filter((s): s is CpiSeries => !!s?.data.length)
      .sort((a, b) => b.data.length - a.data.length)[0]
    if (!axisSource) return null
    const axis = axisSource.data.map((p) => p.date)

    const mk = (s?: CpiSeries) => axis.map((d) => asOfLookup(yoyPts(s), d))

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {}),
      legend: chartLegend(t, ['CPI', '核心 CPI', 'PCE', '核心 PCE']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, axis),
      yAxis: valueAxis(t, { name: '同比 %', nameTextStyle: axisNameStyle(t.text3) }),
      dataZoom: [chartDataZoom(t, { start: 85, end: 100 })],
      series: [
        lineSeries('CPI', mk(cpi), t.series[0], {
          lineStyle: { width: 1.4, color: t.series[0] },
          markLine: targetLine(t.text3),
        }),
        lineSeries('核心 CPI', mk(coreCpi), t.series[1], {
          lineStyle: { width: 1.1, color: t.series[1] },
        }),
        lineSeries('PCE', mk(pce), t.series[2], {
          lineStyle: { width: 1.1, color: t.series[2] },
        }),
        lineSeries('核心 PCE', mk(corePce), t.series[5], {
          lineStyle: { width: 1.3, color: t.series[5] },
        }),
      ],
    }
  }, [series, t])

  if (!option) return <EmptyState title="通胀序列数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/** PPI → CPI 传导：生产者出厂价领先居民消费价 1-2 个季度 */
function PpiCpiChart({ series }: { series: CpiSeries[] }) {
  const t = useChartTheme()

  const option = useMemo(() => {
    const cpi = series.find((s) => s.code === 'CPI')
    const ppi = series.find((s) => s.code === 'PPIACO')
    if (!cpi?.data.length && !ppi?.data.length) return null

    const axisSource = [cpi, ppi]
      .filter((s): s is CpiSeries => !!s?.data.length)
      .sort((a, b) => b.data.length - a.data.length)[0]
    const axis = axisSource!.data.map((p) => p.date)

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {}),
      legend: chartLegend(t, ['PPI 同比', 'CPI 同比']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, axis),
      yAxis: valueAxis(t, { name: '同比 %', nameTextStyle: axisNameStyle(t.text3) }),
      dataZoom: [chartDataZoom(t, { start: 85, end: 100 })],
      series: [
        lineSeries('PPI 同比', axis.map((d) => asOfLookup(yoyPts(ppi), d)), t.series[4], {
          lineStyle: { width: 1.2, color: t.series[4] },
        }),
        lineSeries('CPI 同比', axis.map((d) => asOfLookup(yoyPts(cpi), d)), t.series[0], {
          lineStyle: { width: 1.3, color: t.series[0] },
        }),
      ],
    }
  }, [series, t])

  if (!option) return <EmptyState title="PPI 数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/** CPI − 核心 PCE 差值：通常 ≈ +0.3~0.5pct，异常走阔提示结构性变化 */
function GapChart({ series }: { series: CpiSeries[] }) {
  const t = useChartTheme()

  const option = useMemo(() => {
    const cpi = series.find((s) => s.code === 'CPI')
    const corePce = series.find((s) => s.code === 'PCEPILFE')
    if (!cpi?.data.length || !corePce?.data.length) return null

    const axis = cpi.data.map((p) => p.date)
    const cpiYoy = yoyPts(cpi)
    const pceYoy = yoyPts(corePce)
    const gap = axis.map((d) => {
      const a = asOfLookup(cpiYoy, d)
      const b = asOfLookup(pceYoy, d)
      return a == null || b == null ? null : +(a - b).toFixed(2)
    })

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {}),
      legend: chartLegend(t, ['CPI 同比 − 核心 PCE 同比']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, axis),
      yAxis: valueAxis(t, { name: '百分点', nameTextStyle: axisNameStyle(t.text3) }),
      dataZoom: [chartDataZoom(t, { start: 85, end: 100 })],
      series: [
        lineSeries('CPI 同比 − 核心 PCE 同比', gap, t.series[2], {
          lineStyle: { width: 1.2, color: t.series[2] },
          areaStyle: { color: t.series[2], opacity: 0.08 },
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            animation: false,
            data: [
              {
                yAxis: 0,
                lineStyle: { color: t.text3, type: 'dashed' as const, width: 1 },
                label: { formatter: '0', color: t.text3, fontSize: 10 },
              },
            ],
          },
        }),
      ],
    }
  }, [series, t])

  if (!option) return <EmptyState title="差值数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/* --------------------------------------------------------------------------- */

const TILE_ORDER: { code: CpiCode; label: string; hint: string }[] = [
  { code: 'CPI', label: 'CPI 同比', hint: '整体通胀温度计，含食品与能源' },
  { code: 'CPILFESL', label: '核心 CPI 同比', hint: '剔除食品能源，反映内生通胀趋势' },
  { code: 'PCEPI', label: 'PCE 同比', hint: '联储锚定的物价口径，覆盖更全' },
  { code: 'PCEPILFE', label: '核心 PCE 同比', hint: '联储 2% 目标的正式锚' },
  { code: 'PPIACO', label: 'PPI 同比', hint: '生产者出厂价，领先 CPI 1-2 个季度' },
]

/** 通胀语义的磁贴染色：<3 受控(绿)、3-5 偏高(琥珀)、≥5 严重(红) */
function inflationTone(yoy: number | null) {
  if (yoy == null) return 'neutral' as const
  if (yoy >= 5) return 'down' as const
  if (yoy >= 3) return 'warn' as const
  return 'up' as const
}

export default function CpiDashboard() {
  const [data, setData] = useState<CpiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const t = useChartTheme()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/v1/cpi.json')
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
        if (!cancelled) setData(json.data as CpiResponse)
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
    const out = {} as Record<string, { cur: number | null; curDate: string | null; yoy: number | null }>
    for (const s of data?.series ?? []) {
      const pts = toPoints(s)
      const last = pts[pts.length - 1]
      out[s.code] = {
        cur: lastValue(pts),
        curDate: last ? last.date : null,
        yoy: lastValue(yoySeries(pts)),
      }
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
        title="通胀序列数据尚未同步"
        description="请先执行 python run_sync.py cpi 拉取 FRED 通胀序列。"
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
        {TILE_ORDER.map(({ code, label, hint }) => {
          const s = stats[code]
          const yoy = s?.yoy ?? null
          return (
            <StatTile
              key={code}
              label={label}
              value={yoy == null ? '--' : `${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%`}
              sub={
                s?.cur == null
                  ? undefined
                  : `指数 ${s.cur.toFixed(1)} · ${(s.curDate ?? '').slice(0, 7)}`
              }
              tone={inflationTone(yoy)}
              tooltip={hint}
            />
          )
        })}
      </div>

      <MacroCard title="通胀全景 — CPI / 核心 CPI / PCE / 核心 PCE 同比">
        <OverviewChart series={data.series} />
        <LegendNote
          items={[
            { color: t.series[0], label: 'CPI 同比 — 市场最关注的通胀温度计' },
            { color: t.series[1], label: '核心 CPI 同比 — 剔除食品与能源' },
            { color: t.series[2], label: 'PCE 同比 — 联储锚定的口径' },
            { color: t.series[5], label: '核心 PCE 同比 — 联储 2% 目标的正式锚' },
          ]}
        />
      </MacroCard>

      <MacroCard title="生产 → 消费传导 — PPI 领先 CPI">
        <PpiCpiChart series={data.series} />
        <LegendNote
          items={[
            { color: t.series[4], label: 'PPI 同比 — 生产者出厂价，领先 CPI 1-2 个季度' },
            { color: t.series[0], label: 'CPI 同比 — 居民支付价格' },
          ]}
        />
      </MacroCard>

      <MacroCard title="结构缺口 — CPI 同比 − 核心 PCE 同比">
        <GapChart series={data.series} />
        <LegendNote
          items={[
            { color: t.series[2], label: '差值通常 ≈ +0.3~0.5 百分点（权重与覆盖范围差异）— 异常走阔提示结构性变化' },
          ]}
        />
      </MacroCard>
    </div>
  )
}

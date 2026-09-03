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
  markLine,
  rightValueAxis,
  thresholdLine,
  valueAxis,
} from '../lib/chartOptions'
import { lastValue, type Point } from '../lib/seriesMath'
import type { EquityCycleResponse } from '../lib/core'

function axisNameStyle(color: string) {
  return { color, fontSize: 10, align: 'left' as const }
}

/* --------------------------------------------------------------------------- */

/** HY-BBB 利差（左 bp）+ DFII10（右 %）：双轴 */
function SpreadRealRateChart({
  spread,
  realRate,
}: {
  spread: { date: string; value: number | null }[]
  realRate: { date: string; value: number | null }[]
}) {
  const t = useChartTheme()
  const option = useMemo(() => {
    if (!spread.length && !realRate.length) return null
    const dates = Array.from(
      new Set([
        ...spread.map((p) => p.date),
        ...realRate.map((p) => p.date),
      ]),
    ).sort()
    const spreadMap = new Map(spread.map((p) => [p.date, p.value]))
    const realRateMap = new Map(realRate.map((p) => [p.date, p.value]))

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {}),
      legend: chartLegend(t, ['HY-BBB 利差 (左 bp)', 'DFII10 (右 %)']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, dates),
      yAxis: [
        valueAxis(t, { name: 'bp', nameTextStyle: axisNameStyle(t.text3) }),
        rightValueAxis(t, { name: '%', nameTextStyle: axisNameStyle(t.text3) }),
      ],
      dataZoom: [chartDataZoom(t, { start: 50, end: 100 })],
      series: [
        lineSeries(
          'HY-BBB 利差 (左 bp)',
          dates.map((d) => spreadMap.get(d) ?? null),
          t.series[1],
          {
            lineStyle: { width: 1.3, color: t.series[1] },
            areaStyle: { color: t.series[1], opacity: 0.06 },
          },
        ),
        lineSeries(
          'DFII10 (右 %)',
          dates.map((d) => realRateMap.get(d) ?? null),
          t.series[2],
          { yAxisIndex: 1, lineStyle: { width: 1.2, color: t.series[2] } },
        ),
      ],
    }
  }, [spread, realRate, t])

  if (!option) return <EmptyState title="利差/实际利率数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/** 周期/防御相对强弱单线：>1 偏周期，<1 偏防御 */
function CyclicalDefensiveChart({
  points,
}: {
  points: { date: string; value: number | null }[]
}) {
  const t = useChartTheme()
  const option = useMemo(() => {
    if (!points.length) return null
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v != null ? Number(v).toFixed(3) : '--'),
      }),
      legend: chartLegend(t, ['周期/防御 比']),
      grid: chartGrid({ top: 14, bottom: 30 }),
      xAxis: categoryAxis(t, points.map((p) => p.date)),
      yAxis: valueAxis(t, {
        name: '比值',
        nameTextStyle: axisNameStyle(t.text3),
      }),
      dataZoom: [chartDataZoom(t, { start: 50, end: 100 })],
      series: [
        lineSeries(
          '周期/防御 比',
          points.map((p) => p.value),
          t.series[3],
          {
            lineStyle: { width: 1.3, color: t.series[3] },
            areaStyle: { color: t.series[3], opacity: 0.08 },
            markLine: markLine([thresholdLine(1, t.border, '均衡 1.0')]),
          },
        ),
      ],
    }
  }, [points, t])

  if (!option) return <EmptyState title="周期/防御比数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/** 6 个 ETF 月线归一化堆叠（参考用）：把 4 周期 + 2 防御全画在一起 */
function ComponentsChart({
  components,
}: {
  components: EquityCycleResponse['cyclicalComponents']
}) {
  const t = useChartTheme()
  const option = useMemo(() => {
    if (!components.length) return null
    const dates = Array.from(
      new Set(components.flatMap((c) => c.data.map((p) => p.date))),
    ).sort()
    // 周期暖色系 + 实线；防御冷色系 + 虚线，阵营分化一眼可辨
    const palette: Record<'cyclical' | 'defensive', string[]> = {
      cyclical: [t.series[1], t.series[3], t.series[4], t.series[5]],
      defensive: [t.series[2], t.series[0]],
    }
    const bucketCount: Record<string, number> = {}
    const series = components.map((c) => {
      const idx = bucketCount[c.bucket] ?? 0
      bucketCount[c.bucket] = idx + 1
      const pool = palette[c.bucket]
      const color = pool[idx % pool.length]
      const m = new Map(c.data.map((p) => [p.date, p.value]))
      return lineSeries(
        c.code,
        dates.map((d) => m.get(d) ?? null),
        color,
        {
          lineStyle: {
            width: 1.0,
            color,
            type: c.bucket === 'defensive' ? 'dashed' : 'solid',
          },
        },
      )
    })
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v != null ? Number(v).toFixed(1) : '--'),
      }),
      legend: chartLegend(
        t,
        components.map((c) => `${c.code}${c.bucket === 'defensive' ? ' (防)' : ' (周)'}`),
      ),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, {
        name: '归一化(首期=100)',
        nameTextStyle: axisNameStyle(t.text3),
      }),
      dataZoom: [chartDataZoom(t, { start: 50, end: 100 })],
      series,
    }
  }, [components, t])

  if (!option) return <EmptyState title="行业 ETF 数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/* --------------------------------------------------------------------------- */

export default function EquityCycleDashboard() {
  const [data, setData] = useState<EquityCycleResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/v1/equity-cycle.json')
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
        if (!cancelled) setData(json.data as EquityCycleResponse)
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
    if (!data) return null
    const spreadLast = lastValue(data.hyBbbSpread as Point[]) ?? null
    const realRateLast = lastValue(data.realRate as Point[]) ?? null
    const cdLast = lastValue(data.cyclicalDefensiveRatio as Point[]) ?? null
    return { spreadLast, realRateLast, cdLast }
  }, [data])

  if (loading) return <LoadingSkeleton type="card" rows={3} height={320} />
  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  if (!data || !stats) return <EmptyState title="暂无数据" />

  if (!data.hyBbbSpread.length && !data.realRate.length && !data.cyclicalDefensiveRatio.length) {
    return (
      <EmptyState
        title="股票风险溢价与轮动数据尚未同步"
        description="请执行 python run_sync.py macro_analysis 同步 BBB/HY/DFII10；并执行 run_sync.py indices 同步 6 个行业 ETF。"
      />
    )
  }

  const toneSpread =
    stats.spreadLast == null
      ? 'neutral'
      : stats.spreadLast > 500
        ? 'down'
        : stats.spreadLast < 200
          ? 'warn'
          : 'up'
  const toneRate =
    stats.realRateLast == null ? 'neutral' : stats.realRateLast >= 2 ? 'down' : 'up'
  const toneCD = stats.cdLast == null ? 'neutral' : stats.cdLast >= 1.1 ? 'up' : stats.cdLast <= 0.9 ? 'down' : 'neutral'

  return (
    <div className="flex flex-col gap-4">
      <div className="stagger grid grid-cols-1 gap-3 lg:grid-cols-3">
        <StatTile
          label="HY-BBB 信用利差"
          value={stats.spreadLast == null ? '--' : `${stats.spreadLast.toFixed(1)} bp`}
          sub={
            stats.spreadLast != null
              ? stats.spreadLast > 500
                ? '信用压力 — 下沉溢价大幅走阔'
                : stats.spreadLast < 200
                  ? '下沉拥挤 — 溢价压缩，警惕晚期周期'
                  : '稳定 — 溢价处于常态区间'
              : undefined
          }
          tone={toneSpread}
        />
        <StatTile
          label="10Y 实际利率 (DFII10)"
          value={stats.realRateLast == null ? '--' : `${stats.realRateLast.toFixed(2)}%`}
          sub={stats.realRateLast != null ? (stats.realRateLast >= 2 ? '贴现率压顶 — 估值敏感' : '贴现率温和') : undefined}
          tone={toneRate}
        />
        <StatTile
          label="周期/防御 比"
          value={stats.cdLast == null ? '--' : stats.cdLast.toFixed(3)}
          sub={stats.cdLast != null ? (stats.cdLast > 1 ? '>1 偏周期' : '<1 偏防御') : undefined}
          tone={toneCD}
        />
      </div>

      <MacroCard title="风险溢价代理 — 信用利差 + 实际利率">
        <SpreadRealRateChart
          spread={data.hyBbbSpread}
          realRate={data.realRate}
        />
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
          左轴 HY − BBB 利差（bp）反映市场要求的<strong className="text-ink">信用下沉溢价</strong>
          —— 走阔 = 溢价扩大、信用承压；压缩到极低 = 下沉拥挤、晚期周期预警。
          右轴 DFII10 反映<strong className="text-ink">贴现率底</strong>。
          二者同向上行 = 风险溢价被推高、权益估值需要打折；反之估值环境宽松。
        </p>
      </MacroCard>

      <MacroCard title="周期 vs 防御 — 单序列相对强弱">
        <CyclicalDefensiveChart points={data.cyclicalDefensiveRatio} />
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
          XLI / XLY / XLE / XLB（周期）等权 / XLU / XLP（防御）等权，月频归一化（首期=100）。
          <strong className="text-ink">比值 &gt; 1 偏周期</strong>，市场愿为顺周期盈利付钱；
          <strong className="text-ink">&lt; 1 偏防御</strong>，资金更看重现金流稳定性。
          配合上面两个风险溢价信号做仓位切换判断。
        </p>
      </MacroCard>

      <MacroCard title="6 个行业 ETF 月线 — 归一化参考">
        <ComponentsChart components={data.cyclicalComponents} />
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
          全部归一化到首期 = 100。实线为周期（XLI/XLY/XLE/XLB），虚线为防御（XLU/XLP）。
          看相对斜率即可识别「哪个赛道领涨/领跌」，是周期/防御比的拆解图。
        </p>
      </MacroCard>
    </div>
  )
}
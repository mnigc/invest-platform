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
  valueAxis,
} from '../lib/chartOptions'

interface SeriesData {
  code: string
  nameZh: string
  nameEn: string
  unit: string
  frequency: string
  data: { date: string; value: number | null }[]
}

interface Payload {
  series: SeriesData[]
  updatedAt: string
  netLiquidity?: { date: string; value: number }[]
}

const CODE = {
  fed: 'FED_BALANCE_SHEET',
  rrp: 'FED_RRP',
  tga: 'FED_TGA',
  sofr: 'SOFR',
  ecb: 'ECB_BALANCE_SHEET',
  boj: 'BOJ_BALANCE_SHEET',
} as const

function findSeries(data: Payload | null, code: string): SeriesData | undefined {
  return data?.series.find((s) => s.code === code)
}

function fmtTrillion(v: number | null): string {
  if (v == null) return '--'
  if (Math.abs(v) >= 1) return `${v.toFixed(2)} 万亿`
  return `${(v * 10000).toFixed(0)} 亿`
}

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

/* --------------------------------------------------------------------------- */

function FedChart({ series }: { series: SeriesData[] }) {
  const t = useChartTheme()
  const fed = series.find((s) => s.code === CODE.fed)
  const rrp = series.find((s) => s.code === CODE.rrp)
  const tga = series.find((s) => s.code === CODE.tga)

  const option = useMemo(() => {
    if (!fed?.data.length) return null
    const dates = fed.data.map((p) => p.date)
    const fedVals = fed.data.map((p) =>
      p.value != null ? +(p.value / 1e6).toFixed(4) : null,
    )
    const rrpMap = new Map(
      (rrp?.data || []).map((p) => [
        p.date,
        p.value != null ? +(p.value / 1000).toFixed(4) : null,
      ]),
    )
    const tgaMap = new Map(
      (tga?.data || []).map((p) => [
        p.date,
        p.value != null ? +(p.value / 1e6).toFixed(4) : null,
      ]),
    )

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        formatter: (params: any) => {
          if (!Array.isArray(params) || !params.length) return ''
          const head = `<div style="font-size:11px;color:${t.text3};margin-bottom:4px">${params[0].axisValue}</div>`
          const lines = params.map((p: any) => {
            const color = typeof p.color === 'string' ? p.color : t.series[0]
            const val = p.value != null ? fmtTrillion(p.value) : '--'
            return `<div style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${color};flex:none"></span><span style="flex:1">${p.seriesName}</span><span style="margin-left:20px;font-weight:600;color:${color}">${val}</span></div>`
          })
          return head + lines.join('')
        },
      }),
      legend: chartLegend(t, ['美联储总资产', 'RRP 逆回购', 'TGA 账户']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, {
        name: '万亿美元',
        nameTextStyle: { color: t.text3, fontSize: 10, align: 'left' },
      }),
      dataZoom: [chartDataZoom(t, { start: 50, end: 100 })],
      series: [
        lineSeries('美联储总资产', fedVals, t.series[1], {
          lineStyle: { width: 1.4, color: t.series[1] },
          areaStyle: { color: t.series[1], opacity: 0.06 },
        }),
        barSeries('RRP 逆回购', dates.map((d) => rrpMap.get(d) ?? null), t.series[2], {
          barMaxWidth: 3,
        }),
        lineSeries(
          'TGA 账户',
          dates.map((d) => tgaMap.get(d) ?? null),
          t.series[5],
          { lineStyle: { width: 1.1, color: t.series[5], type: 'dashed' } },
        ),
      ],
    }
  }, [series, t])

  if (!option) return <EmptyState title="美联储数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

function NetLiquidityChart({ netLiquidity }: { netLiquidity: { date: string; value: number }[] }) {
  const t = useChartTheme()

  const option = useMemo(() => {
    if (!netLiquidity.length) return null
    const dates = netLiquidity.map((p) => p.date)
    const vals = netLiquidity.map((p) => +(p.value / 1e6).toFixed(4))

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        formatter: (params: any) => {
          if (!params || !params.value) return ''
          return `<div style="font-size:11px;color:${t.text3};margin-bottom:4px">${params.axisValue}</div>
<div style="display:flex;align-items:center;gap:6px">
  <span style="width:8px;height:8px;border-radius:50%;background:${t.series[0]};flex:none"></span>
  <span>净流动性</span>
  <span style="margin-left:20px;font-weight:600;color:${t.series[0]}">${fmtTrillion(params.value * 1e6)}</span>
</div>`
        },
      }),
      grid: chartGrid({ top: 14, bottom: 30 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, {
        name: '万亿美元',
        nameTextStyle: { color: t.text3, fontSize: 10, align: 'left' },
      }),
      dataZoom: [chartDataZoom(t, { start: 50, end: 100 })],
      series: [
        lineSeries('净流动性', vals, t.series[0], {
          lineStyle: { width: 1.3, color: t.series[0] },
          areaStyle: { color: t.series[0], opacity: 0.08 },
        }),
      ],
    }
  }, [netLiquidity, t])

  if (!option) return <EmptyState title="净流动性数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

function CbComparisonChart({ series }: { series: SeriesData[] }) {
  const t = useChartTheme()
  const fed = series.find((s) => s.code === CODE.fed)
  const ecb = series.find((s) => s.code === CODE.ecb)
  const boj = series.find((s) => s.code === CODE.boj)

  const option = useMemo(() => {
    const toMonthly = (data: { date: string; value: number | null }[]) => {
      const map = new Map<string, { date: string; value: number }>()
      for (const p of data) {
        if (p.value == null) continue
        const ym = p.date.slice(0, 7)
        const existing = map.get(ym)
        if (!existing || p.date > existing.date) map.set(ym, { date: ym, value: p.value })
      }
      return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
    }

    const all: { key: string; label: string; monthly: ReturnType<typeof toMonthly> }[] = []
    if (fed?.data.length) all.push({ key: 'fed', label: '美联储', monthly: toMonthly(fed.data) })
    if (ecb?.data.length) all.push({ key: 'ecb', label: '欧央行', monthly: toMonthly(ecb.data) })
    if (boj?.data.length) all.push({ key: 'boj', label: '日央行', monthly: toMonthly(boj.data) })
    if (all.length < 2) return null

    const common = Array.from(
      all
        .map((a) => new Set(a.monthly.map((p) => p.date)))
        .reduce((acc, s) => new Set([...acc].filter((x) => s.has(x)))),
    ).sort()
    if (common.length < 2) return null

    const prepared = all.map((a, idx) => {
      const map = new Map(a.monthly.map((p) => [p.date, p.value]))
      const base = map.get(common[0])
      return {
        label: a.label,
        color: t.series[idx],
        vals:
          base == null
            ? common.map(() => null)
            : common.map((d) => {
                const v = map.get(d)
                return v != null ? +((v / base) * 100).toFixed(2) : null
              }),
      }
    })

    const vals = prepared.flatMap((s) => s.vals.filter((v): v is number => v != null))
    if (!vals.length) return null

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v != null ? Number(v).toFixed(1) : '--'),
      }),
      legend: chartLegend(
        t,
        prepared.map((s) => s.label),
      ),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, common, {
        boundaryGap: false,
        axisLabel: { color: t.text3, fontSize: 10, fontFamily: t.fontMono, rotate: 30 },
      }),
      yAxis: valueAxis(t, {
        name: '基准=100',
        nameTextStyle: { color: t.text3, fontSize: 10, align: 'left' },
        scale: false,
      }),
      dataZoom: [chartDataZoom(t, { start: 0, end: 100 })],
      series: prepared.map((s) =>
        lineSeries(s.label, s.vals, s.color, {
          lineStyle: { width: 1.3, color: s.color },
        }),
      ),
    }
  }, [series, t])

  if (!option) return <EmptyState title="央行对比数据不足" description="至少需要两家央行的共同区间。" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

function SofrChart({ series }: { series: SeriesData[] }) {
  const t = useChartTheme()
  const sofr = series.find((s) => s.code === CODE.sofr)

  const option = useMemo(() => {
    if (!sofr?.data.length) return null
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v != null ? `${Number(v).toFixed(2)}%` : '--'),
      }),
      legend: chartLegend(t, ['SOFR']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, sofr.data.map((p) => p.date)),
      yAxis: valueAxis(t, {
        name: '%',
        nameTextStyle: { color: t.text3, fontSize: 10, align: 'left' },
        axisLabel: {
          color: t.text3,
          fontSize: 10,
          fontFamily: t.fontMono,
          formatter: '{value}%',
        },
      }),
      dataZoom: [chartDataZoom(t, { start: 40, end: 100 })],
      series: [
        lineSeries(
          'SOFR',
          sofr.data.map((p) => p.value),
          t.series[1],
          {
            areaStyle: { color: t.series[1], opacity: 0.08 },
          },
        ),
      ],
    }
  }, [sofr, t])

  if (!option) return <EmptyState title="SOFR 数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/* --------------------------------------------------------------------------- */

export default function GlobalLiquidityDashboard() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const t = useChartTheme()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/v1/global-liquidity.json')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!json.success) throw new Error(json.error || '加载失败')
        if (!cancelled) setData(json.data)
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

  if (loading) return <LoadingSkeleton type="card" rows={3} height={320} />
  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  if (!data) return <EmptyState title="暂无数据" />

  const fedS = findSeries(data, CODE.fed)
  const rrpS = findSeries(data, CODE.rrp)
  const tgaS = findSeries(data, CODE.tga)
  const sofrS = findSeries(data, CODE.sofr)

  const last = (s?: SeriesData) => s?.data?.[s.data.length - 1]?.value ?? null
  const fedLast = last(fedS)
  const fedPrev = fedS?.data?.[fedS.data.length - 2]?.value ?? null
  const fedChange =
    fedLast != null && fedPrev != null
      ? ((fedLast - fedPrev) / fedPrev) * 100
      : null
  const rrpLast = last(rrpS)
  const tgaLast = last(tgaS)
  const sofrLast = last(sofrS)

  const hasChartData = data.series.some((s) => s.data.length > 0)
  const changeTone =
    fedChange == null ? 'neutral' : fedChange >= 0 ? 'up' : ('down' as const)

  return (
    <div className="flex flex-col gap-4">
      {/* 关键指标 */}
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="col-span-2 flex flex-col justify-center gap-1 rounded-md border border-info/35 bg-info/10 p-3.5">
          <div className="text-2xs uppercase tracking-wider text-ink-3">
            美联储总资产
          </div>
          <div className="num text-3xl font-bold leading-none text-info">
            {fedLast == null ? '--' : fmtTrillion(fedLast / 1e6)}
          </div>
          <div className={`num text-xs ${changeTone === 'up' ? 'text-up' : changeTone === 'down' ? 'text-down' : 'text-ink-3'}`}>
            周变化 {fedChange == null ? '--' : `${fedChange >= 0 ? '+' : ''}${fedChange.toFixed(2)}%`}
          </div>
        </div>

        <StatTile
          label="RRP 规模"
          value={rrpLast == null ? '--' : fmtTrillion(rrpLast / 1000)}
          tone="warn"
        />
        <StatTile
          label="TGA 余额"
          value={tgaLast == null ? '--' : fmtTrillion(tgaLast / 1e6)}
          tone="down"
        />
        <StatTile
          label="SOFR"
          value={sofrLast == null ? '--' : `${sofrLast.toFixed(2)}%`}
          tone="info"
        />
      </div>

      {hasChartData ? (
        <>
          <MacroCard title="美联储资产负债表 vs 流动性回收 (RRP + TGA)">
            <FedChart series={data.series} />
            <LegendNote
              items={[
                { color: t.series[1], label: '美联储总资产（万亿美元）' },
                { color: t.series[2], label: 'RRP 逆回购 — 越高说明流动性回收越多' },
                { color: t.series[5], label: 'TGA 账户余额' },
              ]}
            />
          </MacroCard>

          {data.netLiquidity && data.netLiquidity.length > 0 && (
            <MacroCard title="净流动性 (美联储总资产 - RRP - TGA)">
              <NetLiquidityChart netLiquidity={data.netLiquidity} />
              <p className="mt-2 text-2xs leading-relaxed text-ink-3">
                净流动性 = 美联储总资产 - RRP 逆回购 - TGA 账户余额。这是衡量市场真实流动性的更精确指标。
              </p>
            </MacroCard>
          )}

          <MacroCard title="主要央行资产负债表对比 (基准=100)">
            <CbComparisonChart series={data.series} />
            <LegendNote
              items={[
                { color: t.series[0], label: '美联储' },
                { color: t.series[1], label: '欧央行' },
                { color: t.series[2], label: '日央行' },
              ]}
            />
            <p className="mt-1.5 text-2xs text-ink-3">
              以最早共同日期为基准 100，展示相对扩张/收缩幅度
            </p>
          </MacroCard>

          <MacroCard title="SOFR — 美元融资成本">
            <SofrChart series={data.series} />
          </MacroCard>
        </>
      ) : (
        <EmptyState title="暂无图表数据" />
      )}
    </div>
  )
}

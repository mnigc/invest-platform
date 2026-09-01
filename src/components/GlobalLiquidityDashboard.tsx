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

function NetLiquidityChart({
  netLiquidity,
  thresholds,
  events,
}: {
  netLiquidity: { date: string; value: number }[]
  thresholds?: { median?: number | null; p10?: number | null; p90?: number | null } | null
  events?: { date: string; label: string }[] | null
}) {
  const t = useChartTheme()

  const option = useMemo(() => {
    if (!netLiquidity.length) return null
    const dates = netLiquidity.map((p) => p.date)
    const vals = netLiquidity.map((p) => +(p.value / 1e6).toFixed(4))

    const thLine = (v: number | null | undefined, color: string, label: string) =>
      v == null
        ? null
        : {
            yAxis: v,
            lineStyle: { color, type: 'dashed', width: 1 },
            symbol: ['none', 'none'],
            animation: false,
            label: { show: true, formatter: label, position: 'insideEndTop', fontSize: 9, color },
          }

    const eventMarks = (events || [])
      .filter((e) => dates.includes(e.date))
      .map((e) => ({
        xAxis: e.date,
        lineStyle: { color: t.warn, type: 'solid', width: 1, opacity: 0.8 },
        label: {
          show: true,
          formatter: e.label,
          position: 'insideEndTop',
          rotate: 90,
          fontSize: 8,
          color: t.warn,
          distance: 2,
        },
      }))

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params
          if (!p) return ''
          return `<div style="font-size:11px;color:${t.text3};margin-bottom:4px">${p.axisValue}</div>
<div style="display:flex;align-items:center;gap:6px">
  <span style="width:8px;height:8px;border-radius:50%;background:${t.series[0]};flex:none"></span>
  <span>净流动性</span>
  <span style="margin-left:20px;font-weight:600;color:${t.series[0]}">${fmtTrillion(p.value * 1e6)}</span>
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
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            animation: false,
            data: [
              thLine(thresholds?.p10, t.down, '10% 分位'),
              thLine(thresholds?.median, t.borderSoft, '5 年中位'),
              thLine(thresholds?.p90, t.up, '90% 分位'),
              ...eventMarks,
            ].filter(Boolean),
          },
        }),
      ],
    }
  }, [netLiquidity, thresholds, events, t])

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

interface Analysis {
  current: {
    netLiquidityTrn: number | null
    weeklyChangeTrn: number | null
    trendChangeTrn: number | null
    zScore5y: number | null
    percentile5y: number | null
    asOf: string
  }
  thresholds: { median: number | null; p10: number | null; p90: number | null }
  signal: {
    direction: 'expansion' | 'contraction' | 'neutral'
    strength: 'strong' | 'moderate' | 'weak'
    confidence: number
    status: string
    statusDesc: string
    evidence: string[]
  }
  history: { dates: string[]; netLiquidityTrn: number[]; zScore5y: (number | null)[] }
  liquidityEvents: { date: string; label: string; desc: string }[]
  forwardReturns: {
    regime: string
    n: number
    avgReturn1m: number | null
    avgReturn3m: number | null
    avgReturn6m: number | null
    avgReturn12m: number | null
    winRate1m: number | null
    winRate3m: number | null
    winRate6m: number | null
    winRate12m: number | null
  }[]
  updatedAt: string
}

const REGIME_LABEL: Record<string, string> = {
  expansion: '扩张',
  contraction: '收缩',
  neutral: '中性',
}

export default function GlobalLiquidityDashboard() {
  const [data, setData] = useState<Payload | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const t = useChartTheme()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const [raw, ana] = await Promise.all([
          fetch('/api/v1/global-liquidity.json').then(async (r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            return r.json()
          }),
          fetch('/api/v1/analysis/liquidity.json')
            .then((r) => r.json())
            .catch(() => null),
        ])
        if (!raw.success) throw new Error(raw.error || '加载失败')
        if (cancelled) return
        setData(raw.data)
        if (ana && ana.success) setAnalysis(ana.data as Analysis)
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

  const rrpS = findSeries(data, CODE.rrp)
  const tgaS = findSeries(data, CODE.tga)
  const sofrS = findSeries(data, CODE.sofr)

  const last = (s?: SeriesData) => s?.data?.[s.data.length - 1]?.value ?? null
  const rrpLast = last(rrpS)
  const rrpPrev = rrpS?.data?.[rrpS.data.length - 2]?.value ?? null
  const rrpChange = rrpLast != null && rrpPrev != null ? rrpLast - rrpPrev : null
  const tgaLast = last(tgaS)
  const tgaPrev = tgaS?.data?.[tgaS.data.length - 2]?.value ?? null
  const tgaChange = tgaLast != null && tgaPrev != null ? tgaLast - tgaPrev : null
  const sofrLast = last(sofrS)
  const sofrPrev = sofrS?.data?.[sofrS.data.length - 2]?.value ?? null
  const sofrChange = sofrLast != null && sofrPrev != null ? sofrLast - sofrPrev : null

  const netLast = data.netLiquidity?.[data.netLiquidity.length - 1]?.value ?? null
  const netPrev = data.netLiquidity?.[data.netLiquidity.length - 2]?.value ?? null
  const netChange = netLast != null && netPrev != null ? netLast - netPrev : null

  const hasChartData = data.series.some((s) => s.data.length > 0)
  const netChangeTone =
    netChange == null ? 'neutral' : netChange >= 0 ? 'up' : ('down' as const)

  const sig = analysis?.signal
  const cur = analysis?.current

  return (
    <div className="flex flex-col gap-4">
      {/* 关键指标 */}
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="col-span-2 flex flex-col justify-center gap-1 rounded-md border border-accent/40 bg-accent/10 p-3.5">
          <div className="flex items-center gap-2 text-2xs uppercase tracking-wider text-ink-3">
            <span>净流动性</span>
            {sig && (
              <span
                className={`rounded-sm border px-1.5 py-px text-2xs font-semibold uppercase ${
                  sig.direction === 'expansion'
                    ? 'border-up/40 text-up'
                    : sig.direction === 'contraction'
                      ? 'border-down/40 text-down'
                      : 'border-line text-ink-3'
                }`}
              >
                {REGIME_LABEL[sig.direction] || sig.direction}
              </span>
            )}
          </div>
          <div className="num text-3xl font-bold leading-none text-accent">
            {netLast == null ? '--' : fmtTrillion(netLast)}
          </div>
          <div className={`num text-xs ${netChangeTone === 'up' ? 'text-up' : netChangeTone === 'down' ? 'text-down' : 'text-ink-3'}`}>
            周变化{' '}
            {netChange == null
              ? '--'
              : `${netChange >= 0 ? '+' : ''}${(netChange / 1e6).toFixed(3)} 万亿`}
            {cur?.zScore5y != null && (
              <span className="ml-2 text-ink-3">
                · z {cur.zScore5y.toFixed(2)}
              </span>
            )}
            {cur?.percentile5y != null && (
              <span className="ml-2 text-ink-3">
                · 5Y 分位 {cur.percentile5y.toFixed(0)}%
              </span>
            )}
          </div>
        </div>

        <StatTile
          label="RRP 规模"
          value={rrpLast == null ? '--' : fmtTrillion(rrpLast / 1000)}
          sub={rrpChange != null ? `周 ${rrpChange >= 0 ? '+' : ''}${(rrpChange / 1000).toFixed(3)}T` : undefined}
          tone="warn"
        />
        <StatTile
          label="TGA 余额"
          value={tgaLast == null ? '--' : fmtTrillion(tgaLast / 1e6)}
          sub={tgaChange != null ? `周 ${tgaChange >= 0 ? '+' : ''}${(tgaChange / 1e6).toFixed(3)}T` : undefined}
          tone="down"
        />
        <StatTile
          label="SOFR"
          value={sofrLast == null ? '--' : `${sofrLast.toFixed(2)}%`}
          sub={sofrChange != null ? `Δ ${sofrChange >= 0 ? '+' : ''}${sofrChange.toFixed(2)}pp` : undefined}
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
            <MacroCard
              title="净流动性 (美联储总资产 - RRP - TGA)"
              accent={
                sig?.direction === 'expansion'
                  ? 'green'
                  : sig?.direction === 'contraction'
                    ? 'red'
                    : 'none'
              }
            >
              <NetLiquidityChart
                netLiquidity={data.netLiquidity}
                thresholds={analysis?.thresholds}
                events={analysis?.liquidityEvents}
              />
              <p className="mt-2 text-2xs leading-relaxed text-ink-3">
                净流动性 = 美联储总资产 - RRP 逆回购 - TGA 账户余额。
                {sig && (
                  <>
                    {' '}
                    当前体制：
                    <span
                      className={`font-semibold ${
                        sig.direction === 'expansion'
                          ? 'text-up'
                          : sig.direction === 'contraction'
                            ? 'text-down'
                            : 'text-ink-2'
                      }`}
                    >
                      {REGIME_LABEL[sig.direction]}
                    </span>
                    （{sig.strength === 'strong' ? '强' : sig.strength === 'moderate' ? '中' : '弱'} ·
                    置信度 {sig.confidence}%）— {sig.statusDesc}
                  </>
                )}
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
              以最早共同日期为基准 100，展示相对扩张/收缩幅度（各央行本币计价，未做汇率调整）
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

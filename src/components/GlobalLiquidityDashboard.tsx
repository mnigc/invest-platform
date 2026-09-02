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
// 从 seriesMath 而非 series 导入：series 会连带引入 lib/db（数据库驱动），
// 客户端组件引用它会把驱动打进浏览器包
import { asOfLookup } from '../lib/seriesMath'

interface SeriesData {
  code: string
  nameZh: string
  nameEn: string
  unit: string
  frequency: string
  data: { date: string; value: number | null }[]
}

interface MoneySupplyPoint {
  date: string
  m1Yoy: number | null
  m2Yoy: number | null
  scissors: number | null
}

interface Payload {
  series: SeriesData[]
  updatedAt: string
  netLiquidity?: { date: string; value: number }[]
  /** SOFR − IORB，单位基点 */
  sofrIorbSpread?: { date: string; value: number }[]
  moneySupply?: MoneySupplyPoint[]
}

const CODE = {
  fed: 'FED_BALANCE_SHEET',
  rrp: 'FED_RRP',
  tga: 'FED_TGA',
  sofr: 'SOFR',
  ecb: 'ECB_BALANCE_SHEET',
  boj: 'BOJ_BALANCE_SHEET',
  iorb: 'IORB',
  reserves: 'BANK_RESERVES',
  m1: 'M1',
  m2: 'M2',
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

/**
 * SOFR vs IORB —— 回购市场紧张度。
 *
 * IORB 是美联储付给银行准备金的利率，构成货币市场利率的「地板」；SOFR 是市场
 * 实际成交的回购利率。两条线之间的间距即融资紧张度：SOFR 上穿 IORB，意味着
 * 机构宁可付出高于政策底的成本也要借到钱 —— 2019 年回购危机就是这么起头的。
 * 裸看 SOFR 只能看到绝对水平，减去 IORB 才看得出「相对底线是否吃紧」。
 */
function SofrIorbChart({ series }: { series: SeriesData[] }) {
  const t = useChartTheme()
  const sofr = series.find((s) => s.code === CODE.sofr)
  const iorb = series.find((s) => s.code === CODE.iorb)

  const option = useMemo(() => {
    if (!sofr?.data.length) return null
    const dates = sofr.data.map((p) => p.date)

    // IORB 与 SOFR 都是日频，但节假日与发布时点不完全一致，
    // 用 as-of 对齐而不是按日期精确匹配，否则会出现大量假断点。
    const iorbPts = (iorb?.data || [])
      .filter((p): p is { date: string; value: number } => p.value != null)
      .map((p) => ({ date: p.date, value: p.value as number }))

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v != null ? `${Number(v).toFixed(2)}%` : '--'),
      }),
      legend: chartLegend(t, iorbPts.length ? ['SOFR', 'IORB'] : ['SOFR']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, dates),
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
            lineStyle: { width: 1.4, color: t.series[1] },
            areaStyle: { color: t.series[1], opacity: 0.08 },
          },
        ),
        ...(iorbPts.length
          ? [
              lineSeries(
                'IORB',
                dates.map((d) => asOfLookup(iorbPts, d)),
                t.series[5],
                { lineStyle: { width: 1.2, color: t.series[5], type: 'dashed' } },
              ),
            ]
          : []),
      ],
    }
  }, [sofr, iorb, t])

  if (!option) return <EmptyState title="SOFR 数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/**
 * 银行体系准备金水位。
 *
 * 这张图补齐了知识图谱 liquidity.json 里「准备金 → SOFR」那条此前有图无数据的
 * 传导边：准备金是银行放贷与回购的「弹药」，一旦逼近最低充裕水平（LCLoR），
 * 回购市场会突发抽紧，并立刻反映到 SOFR 上。
 */
function ReservesChart({ series }: { series: SeriesData[] }) {
  const t = useChartTheme()
  const reserves = series.find((s) => s.code === CODE.reserves)

  const option = useMemo(() => {
    if (!reserves?.data.length) return null
    const dates = reserves.data.map((p) => p.date)
    const vals = reserves.data.map((p) =>
      p.value != null ? +(p.value / 1e6).toFixed(4) : null,
    )

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params
          if (!p) return ''
          return `<div style="font-size:11px;color:${t.text3};margin-bottom:4px">${p.axisValue}</div>
<div style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${t.series[3]};flex:none"></span><span>银行准备金</span><span style="margin-left:20px;font-weight:600;color:${t.series[3]}">${p.value != null ? fmtTrillion(p.value * 1e6) : '--'}</span></div>`
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
        lineSeries('银行准备金', vals, t.series[3], {
          lineStyle: { width: 1.3, color: t.series[3] },
          areaStyle: { color: t.series[3], opacity: 0.08 },
        }),
      ],
    }
  }, [reserves, t])

  if (!option) return <EmptyState title="银行准备金数据暂无" />
  return <ResponsiveChartBox option={option} deps={[option]} />
}

/**
 * M1 / M2 同比与剪刀差。
 *
 * 剪刀差 = M1同比 − M2同比。M1 是随时可花的活钱，M2 含定期等准储蓄；
 * 剪刀差转负说明资金在「躺平」而非流通，是通缩预警链条的第一环
 * （呼应知识图谱 deflation.json 的预警顺序）。
 */
function MoneySupplyChart({ moneySupply }: { moneySupply: MoneySupplyPoint[] }) {
  const t = useChartTheme()

  const option = useMemo(() => {
    if (!moneySupply.length) return null
    const dates = moneySupply.map((p) => p.date)

    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v != null ? `${Number(v).toFixed(2)}%` : '--'),
      }),
      legend: chartLegend(t, ['M1 同比', 'M2 同比', '剪刀差 (M1−M2)']),
      grid: chartGrid({ top: 32, bottom: 30 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, {
        name: '同比 %',
        nameTextStyle: { color: t.text3, fontSize: 10, align: 'left' },
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
          'M1 同比',
          moneySupply.map((p) => p.m1Yoy),
          t.series[1],
          { lineStyle: { width: 1.3, color: t.series[1] } },
        ),
        lineSeries(
          'M2 同比',
          moneySupply.map((p) => p.m2Yoy),
          t.series[2],
          { lineStyle: { width: 1.2, color: t.series[2] } },
        ),
        barSeries(
          '剪刀差 (M1−M2)',
          moneySupply.map((p) => p.scissors),
          t.series[4],
          {
            barMaxWidth: 3,
            // 剪刀差可正可负，四角都给圆角，避免负柱底部是直角显得突兀
            itemStyle: { color: t.series[4], borderRadius: 2, opacity: 0.45 },
          },
        ),
      ],
    }
  }, [moneySupply, t])

  if (!option) return <EmptyState title="货币供应数据暂无" />
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
  const iorbS = findSeries(data, CODE.iorb)
  const reservesS = findSeries(data, CODE.reserves)

  const last = (s?: SeriesData) => s?.data?.[s.data.length - 1]?.value ?? null
  const delta = (s?: SeriesData) => {
    const a = last(s)
    const b = s?.data?.[s.data.length - 2]?.value ?? null
    return a != null && b != null ? a - b : null
  }

  const rrpLast = last(rrpS)
  const rrpChange = delta(rrpS)
  const tgaLast = last(tgaS)
  const tgaChange = delta(tgaS)
  const sofrLast = last(sofrS)
  const sofrChange = delta(sofrS)
  const iorbLast = last(iorbS)
  const reservesLast = last(reservesS)
  const reservesChange = delta(reservesS)

  const netLast = data.netLiquidity?.[data.netLiquidity.length - 1]?.value ?? null
  const netPrev = data.netLiquidity?.[data.netLiquidity.length - 2]?.value ?? null
  const netChange = netLast != null && netPrev != null ? netLast - netPrev : null

  // 以下派生量由 API 层现算（纯算术派生，不入库，避免与基础序列的同步时序耦合）
  const spreadLast = data.sofrIorbSpread?.[data.sofrIorbSpread.length - 1]?.value ?? null
  const msLast = data.moneySupply?.[data.moneySupply.length - 1] ?? null
  const hasReserves = (reservesS?.data?.length ?? 0) > 0
  const hasMoneySupply = (data.moneySupply?.length ?? 0) > 0

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
        <StatTile
          label="SOFR − IORB"
          value={spreadLast == null ? '--' : `${spreadLast > 0 ? '+' : ''}${spreadLast.toFixed(0)}bp`}
          sub={
            spreadLast == null
              ? undefined
              : spreadLast > 0
                ? '高于政策底 · 融资偏紧'
                : '低于政策底 · 融资宽松'
          }
          tone={spreadLast == null ? 'neutral' : spreadLast > 0 ? 'down' : 'up'}
          accent={spreadLast != null && spreadLast > 0 ? 'red' : 'green'}
        />
        <StatTile
          label="银行准备金"
          value={reservesLast == null ? '--' : fmtTrillion(reservesLast / 1e6)}
          sub={
            reservesChange != null
              ? `周 ${reservesChange >= 0 ? '+' : ''}${(reservesChange / 1e6).toFixed(3)}T`
              : undefined
          }
          tone="neutral"
        />
        <StatTile
          label="M1 同比"
          value={msLast?.m1Yoy == null ? '--' : `${msLast.m1Yoy >= 0 ? '+' : ''}${msLast.m1Yoy.toFixed(2)}%`}
          sub="活钱增速"
          tone="info"
        />
        <StatTile
          label="M2 同比"
          value={msLast?.m2Yoy == null ? '--' : `${msLast.m2Yoy >= 0 ? '+' : ''}${msLast.m2Yoy.toFixed(2)}%`}
          sub="含准储蓄"
          tone="info"
        />
        <StatTile
          label="M1−M2 剪刀差"
          value={
            msLast?.scissors == null
              ? '--'
              : `${msLast.scissors >= 0 ? '+' : ''}${msLast.scissors.toFixed(2)}pp`
          }
          sub={
            msLast?.scissors == null
              ? undefined
              : msLast.scissors >= 0
                ? '资金活化'
                : '资金躺平 · 通缩预警'
          }
          tone={msLast?.scissors == null ? 'neutral' : msLast.scissors >= 0 ? 'up' : 'down'}
          accent={msLast?.scissors != null && msLast.scissors < 0 ? 'gold' : 'none'}
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

          <MacroCard
            title="SOFR vs IORB — 回购市场紧张度"
            badge={
              spreadLast != null ? (
                <span
                  className={`num rounded-sm border px-1.5 py-px text-2xs font-semibold ${
                    spreadLast > 0
                      ? 'border-down/40 text-down'
                      : 'border-up/40 text-up'
                  }`}
                >
                  {spreadLast > 0 ? '+' : ''}
                  {spreadLast.toFixed(0)}bp
                </span>
              ) : undefined
            }
          >
            <SofrIorbChart series={data.series} />
            <LegendNote
              items={[
                { color: t.series[1], label: 'SOFR — 市场实际回购融资成本' },
                { color: t.series[5], label: 'IORB — 政策利率底（虚线）' },
              ]}
            />
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
              两线间距即融资紧张度：IORB 是美联储付给准备金的利率，构成货币市场利率的地板，
              SOFR 是市场实际成交价。
              {iorbLast != null && <>当前 IORB {iorbLast.toFixed(2)}%。</>}
              {' '}SOFR 上穿 IORB（利差转正）说明机构宁可付高于政策底的成本也要借到钱 ——
              2019 年 9 月的回购危机正是这么起头的。
            </p>
          </MacroCard>

          {hasReserves && (
            <MacroCard title="银行体系准备金 (Reserve Balances)">
              <ReservesChart series={data.series} />
              <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
                准备金是银行放贷与回购的「弹药」。这张图补齐了知识图谱里
                「准备金 → SOFR」那条传导链：水位持续下行并逼近最低充裕水平（LCLoR）时，
                回购市场会突发抽紧，并立刻反映到 SOFR 上。
              </p>
            </MacroCard>
          )}

          {hasMoneySupply && (
            <MacroCard title="M1 / M2 同比与剪刀差">
              <MoneySupplyChart moneySupply={data.moneySupply ?? []} />
              <LegendNote
                items={[
                  { color: t.series[1], label: 'M1 同比 — 随时可花的活钱' },
                  { color: t.series[2], label: 'M2 同比 — 含定期等准储蓄' },
                  { color: t.series[4], label: '剪刀差 (M1−M2)，转负即资金躺平' },
                ]}
              />
              <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
                剪刀差 = M1同比 − M2同比。M1 增速快于 M2 说明资金在活化、愿意流通；
                反之则是钱都存成了定期、不进实体 —— 这是通缩预警链条的第一环。
              </p>
            </MacroCard>
          )}
        </>
      ) : (
        <EmptyState title="暂无图表数据" />
      )}
    </div>
  )
}

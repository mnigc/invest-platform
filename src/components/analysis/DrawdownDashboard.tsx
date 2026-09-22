import { useMemo, useState, useEffect } from 'react'
import type { EChartsOption } from 'echarts'
import { ResponsiveChartBox } from '../charts/ChartBox'
import { useChartTheme } from '../ui/theme'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { EmptyState, ErrorState } from '../ui/States'
import { MacroCard } from '../ui/MacroCard'
import { StatTile } from '../ui/StatTile'
import { DataTable } from '../ui/DataTable'
import {
  categoryAxis, chartAnimation, chartDataZoom, chartGrid, chartLegend,
  chartTooltip, lineSeries, valueAxis, defaultZoomStart,
} from '../../lib/chartOptions'

/* ─────────────── payload 类型（与 sync_analysis_drawdown.py 对应） ─────────────── */
interface Episode {
  peakDate: string; troughDate: string; depth: number
  declineDays: number | null; recoveryDate: string | null
  recoveryDays: number | null; underwaterDays: number | null; recovered: boolean
}
interface Bucket {
  label: string; minDepth: number; maxDepth: number | null; count: number
  avgDepth: number; avgRecoveryDays: number | null; medianRecoveryDays: number | null
  maxRecoveryDays: number | null; avgUnderwaterDays: number | null; ongoing: number
}
interface RiskStats {
  cagr: number | null; vol: number | null; sharpe: number | null; sortino: number | null
  calmar: number | null; ulcerIndex: number | null
  bestYear: number | null; worstYear: number | null; positiveYearRate: number | null
  annualReturns: { year: number; ret: number }[]
}
interface Asset {
  symbol: string; nameZh: string; basis: string; basisLabel: string
  dataStart: string; dataEnd: string; nDays: number; years: number
  current: { inDrawdown: boolean; depth: number; peakDate: string; daysUnderwater: number; troughDate: string | null; troughDepth: number | null }
  mdd: { depth: number; peakDate: string; troughDate: string; recoveryDate: string | null; recoveryDays: number | null; underwaterDays: number | null; ongoing: boolean }
  stats: {
    episodeCount: number; drawdownsPerYear: number | null; avgDepth: number; medianDepth: number
    avgRecoveryDays: number | null; medianRecoveryDays: number | null; avgUnderwaterDays: number | null
    longestUnderwaterDays: number | null; underwaterPctDays: number; ongoingCount: number
  }
  buckets: Bucket[]
  episodes: Episode[]
  scatter: { depth: number; recoveryDays: number | null; peakDate: string; troughDate: string; recovered: boolean }[]
  underwater: { dates: string[]; values: number[] }
  risk: RiskStats
}
interface Data {
  assets: Record<string, Asset>
  minEpisodeDepth: number
  notes: string[]
  updatedAt: string
}

const pct = (v: number | null | undefined, digits = 1) =>
  v == null ? '--' : `${(v * 100).toFixed(digits)}%`
const num = (v: number | null | undefined) => (v == null ? '--' : String(v))
const dateShort = (d: string | null | undefined) => (d == null ? '--' : d.slice(0, 7).replace('-', '/'))
const fmtDate = (d: string | null | undefined) => (d == null ? '--' : d)

export default function DrawdownDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [symbol, setSymbol] = useState('')
  const t = useChartTheme()

  useEffect(() => {
    let alive = true
    fetch('/api/v1/analysis/etf-drawdown.json')
      .then(r => r.json())
      .then(j => {
        if (!alive) return
        if (j.success) {
          setData(j.data)
          const syms = Object.keys(j.data.assets)
          // 优先展示 SPY（全收益口径），否则第一个可用标的
          setSymbol(syms.includes('SPY') ? 'SPY' : syms[0])
        } else setError(j.error || '加载失败')
      })
      .catch(e => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  const asset = data?.assets[symbol]

  /* 水下曲线（Underwater Plot）：始终处于 0 轴以下，越深越疼 */
  const underwaterOption = useMemo<EChartsOption | null>(() => {
    if (!asset) return null
    const { dates, values } = asset.underwater
    const total = dates.length
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v == null ? '--' : `${(Number(v) * 100).toFixed(2)}%`),
      }),
      grid: chartGrid({ top: 16, bottom: 36 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, {
        max: 0,
        axisLabel: { color: t.text3, fontSize: 10, fontFamily: t.fontMono, formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
      }),
      dataZoom: [chartDataZoom(t, { start: defaultZoomStart(total), end: 100 })],
      series: [
        lineSeries(symbol, values, t.down, {
          areaStyle: { color: t.downSoft, opacity: 0.55 },
          lineStyle: { width: 1 },
        }),
      ],
    } as EChartsOption
  }, [asset, symbol, t])

  /* 深度 × 修复时长散点：伤口越深、愈合越久（对数轴） */
  const scatterOption = useMemo<EChartsOption | null>(() => {
    if (!asset) return null
    const recovered = asset.scatter
      .filter(s => s.recovered && s.recoveryDays != null)
      .map(s => [+(s.depth * 100).toFixed(1), s.recoveryDays, s.peakDate])
    const ongoing = asset.scatter
      .filter(s => !s.recovered)
      .map(s => [+(s.depth * 100).toFixed(1), s.recoveryDays ?? null, s.peakDate])
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { trigger: 'item' }),
      // bottom 需容纳 x 轴名（containLabel 不含轴名，不足会被裁切）
      grid: chartGrid({ top: 32, bottom: 34 }),
      legend: chartLegend(t, ['已修复', '进行中']),
      xAxis: {
        type: 'value', name: '回撤深度 %', nameLocation: 'middle', nameGap: 24,
        nameTextStyle: { color: t.text3, fontSize: 10 },
        axisLabel: { color: t.text3, fontSize: 10, fontFamily: t.fontMono, formatter: '{value}%' },
        splitLine: { lineStyle: { color: t.borderSoft, type: 'dashed' } },
        max: (v: { max: number }) => Math.ceil(v.max / 10) * 10,
      },
      yAxis: valueAxis(t, {
        type: 'log', name: '修复天数(对数)',
        nameTextStyle: { color: t.text3, fontSize: 10 },
        min: 10,
        axisLabel: { color: t.text3, fontSize: 10, fontFamily: t.fontMono },
      }),
      series: [
        {
          name: '已修复', type: 'scatter', data: recovered,
          symbolSize: 7, itemStyle: { color: t.accent, opacity: 0.65 },
        },
        {
          name: '进行中', type: 'scatter', data: ongoing,
          symbolSize: 10, symbol: 'diamond', itemStyle: { color: t.warn, opacity: 0.9 },
        },
      ],
    } as unknown as EChartsOption
  }, [asset, t])

  /* 年度收益柱状图 */
  const annualOption = useMemo<EChartsOption | null>(() => {
    if (!asset) return null
    const rows = asset.risk.annualReturns
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v == null ? '--' : `${(Number(v) * 100).toFixed(1)}%`),
      }),
      grid: chartGrid({ top: 16, bottom: 36 }),
      xAxis: categoryAxis(t, rows.map(r => String(r.year))),
      yAxis: valueAxis(t, {
        axisLabel: { color: t.text3, fontSize: 10, fontFamily: t.fontMono, formatter: (v: number) => `${v}%` },
      }),
      dataZoom: [chartDataZoom(t, { start: 60, end: 100 })],
      series: [{
        type: 'bar', name: '年度收益',
        data: rows.map(r => ({
          value: +(r.ret * 100).toFixed(2),
          itemStyle: { color: r.ret >= 0 ? t.up : t.down },
        })),
      }],
    } as unknown as EChartsOption
  }, [asset, t])

  if (loading) return <LoadingSkeleton type="chart" />
  if (error) return <ErrorState message={error} />
  if (!data || !asset) return <EmptyState title="暂无数据" />

  const symbols = Object.keys(data.assets)

  return (
    <div className="space-y-4">
      {/* 标的切换 */}
      <div className="flex flex-wrap items-center gap-2">
        {symbols.map(s => (
          <button
            key={s}
            onClick={() => setSymbol(s)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              s === symbol
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-line bg-surface text-ink-2 hover:bg-surface-2'
            }`}
          >
            {s}
            <span className="ml-1.5 text-2xs text-ink-3">{data.assets[s].nameZh}</span>
          </button>
        ))}
        <span className="ml-auto rounded border border-line px-2 py-1 text-2xs text-ink-3">
          {asset.basisLabel} · {asset.dataStart} ~ {asset.dataEnd}
        </span>
      </div>

      {/* 当前状态 + 关键指标 */}
      <MacroCard accent={asset.current.inDrawdown ? 'red' : 'green'}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatTile
            label="当前回撤"
            value={pct(asset.current.depth, 2)}
            sub={asset.current.inDrawdown ? `峰顶 ${dateShort(asset.current.peakDate)} · 已 ${asset.current.daysUnderwater} 天` : '处于历史高位'}
            tone={asset.current.inDrawdown ? 'down' : 'up'}
          />
          <StatTile
            label="最大回撤"
            value={pct(asset.mdd.depth, 1)}
            sub={`${dateShort(asset.mdd.peakDate)} → ${dateShort(asset.mdd.troughDate)}`}
            tone="down"
            tooltip={`修复${asset.mdd.ongoing ? '进行中' : `用时 ${asset.mdd.recoveryDays} 天`}`}
          />
          <StatTile
            label="MDD 修复用时"
            value={asset.mdd.ongoing ? '进行中' : `${num(asset.mdd.recoveryDays)} 天`}
            sub={asset.mdd.ongoing ? '尚未收复前高' : `${fmtDate(asset.mdd.recoveryDate)} 收复`}
            tone={asset.mdd.ongoing ? 'warn' : 'up'}
          />
          <StatTile
            label="平均回撤 / 修复"
            value={`${pct(asset.stats.avgDepth, 1)} / ${num(asset.stats.avgRecoveryDays)}天`}
            sub={`中位修复 ${num(asset.stats.medianRecoveryDays)} 天 · ≥${(data.minEpisodeDepth * 100).toFixed(0)}% 事件`}
          />
          <StatTile
            label="水下时间占比"
            value={pct(asset.stats.underwaterPctDays, 0)}
            sub="处于前高之下的交易日比例"
          />
          <StatTile
            label="CAGR / Calmar"
            value={`${pct(asset.risk.cagr, 1)} / ${num(asset.risk.calmar)}`}
            sub={`波动 ${pct(asset.risk.vol, 1)} · Ulcer ${num(asset.risk.ulcerIndex)}`}
          />
        </div>
      </MacroCard>

      {/* 水下曲线 */}
      <MacroCard title="水下曲线（距前高回撤）" padding="sm">
        <ResponsiveChartBox option={underwaterOption} deps={[underwaterOption]} />
        <p className="px-3 pb-2 text-2xs text-ink-3">
          曲线触及 0% = 创历史新高。深度直观呈现每一次熊市；鼠标悬停可读具体幅度。
        </p>
      </MacroCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 深度 × 修复散点 */}
        <MacroCard title="回撤深度 × 修复时长" padding="sm">
          <ResponsiveChartBox option={scatterOption} deps={[scatterOption]} />
          <p className="px-3 pb-2 text-2xs text-ink-3">
            每个≥5%的回撤事件一个点。深度越大修复越久且高度非线性——5%级回调平均数周自愈，30%+级熊市平均需要数年。
          </p>
        </MacroCard>

        {/* 年度收益 */}
        <MacroCard title="年度收益" padding="sm">
          <ResponsiveChartBox option={annualOption} deps={[annualOption]} />
          <p className="px-3 pb-2 text-2xs text-ink-3">
            正收益年份占比 {pct(asset.risk.positiveYearRate, 0)} · 最好 {pct(asset.risk.bestYear, 1)} · 最差 {pct(asset.risk.worstYear, 1)}
          </p>
        </MacroCard>
      </div>

      {/* 分桶统计 */}
      <MacroCard title="按深度分桶的回撤统计" padding="sm">
        <DataTable
          columns={[
            { key: 'label', header: '深度区间', render: (b: Bucket) => b.label },
            { key: 'count', header: '次数', numeric: true, render: (b: Bucket) => b.count },
            { key: 'freq', header: '年均', numeric: true, render: (b: Bucket) => asset.years > 0 ? (b.count / asset.years).toFixed(2) : '--' },
            { key: 'avg', header: '平均深度', numeric: true, render: (b: Bucket) => pct(b.avgDepth, 1) },
            { key: 'avgRec', header: '平均修复', numeric: true, render: (b: Bucket) => b.avgRecoveryDays != null ? `${b.avgRecoveryDays} 天` : '--' },
            { key: 'medRec', header: '中位修复', numeric: true, render: (b: Bucket) => b.medianRecoveryDays != null ? `${b.medianRecoveryDays} 天` : '--' },
            { key: 'maxRec', header: '最长修复', numeric: true, render: (b: Bucket) => b.maxRecoveryDays != null ? `${b.maxRecoveryDays} 天` : '--' },
            { key: 'ongoing', header: '进行中', numeric: true, render: (b: Bucket) => b.ongoing || '--' },
          ]}
          rows={asset.buckets}
          rowKey={(b: Bucket) => b.label}
        />
      </MacroCard>

      {/* 最大回撤事件 */}
      <MacroCard title="历史最深回撤事件（前 15）" padding="sm">
        <DataTable
          columns={[
            { key: 'rank', header: '#', render: (_: Episode, i: number) => i + 1 },
            { key: 'peak', header: '峰顶', render: (e: Episode) => fmtDate(e.peakDate) },
            { key: 'trough', header: '谷底', render: (e: Episode) => fmtDate(e.troughDate) },
            { key: 'decline', header: '下跌用时', numeric: true, render: (e: Episode) => e.declineDays != null ? `${e.declineDays} 天` : '--' },
            { key: 'depth', header: '深度', numeric: true, render: (e: Episode) => <span className="text-down">{pct(e.depth, 1)}</span> },
            { key: 'recDays', header: '谷底→修复', numeric: true, render: (e: Episode) => e.recoveryDays != null ? `${e.recoveryDays} 天` : '--' },
            { key: 'under', header: '水下总时长', numeric: true, render: (e: Episode) => e.underwaterDays != null ? `${e.underwaterDays} 天` : '--' },
            { key: 'status', header: '状态', render: (e: Episode) => e.recovered ? <span className="text-up">已修复</span> : <span className="text-warn">进行中</span> },
          ]}
          rows={asset.episodes.slice(0, 15)}
          rowKey={(e: Episode) => e.peakDate}
        />
      </MacroCard>

      {/* 口径说明 */}
      <MacroCard title="统计口径" padding="sm">
        <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-ink-2">
          {data.notes.map((n, i) => <li key={i}>{n}</li>)}
          <li>时长均为日历天；修复=收盘价收复前高。</li>
        </ul>
      </MacroCard>
    </div>
  )
}

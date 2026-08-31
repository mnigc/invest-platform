import { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { ErrorState, EmptyState } from '../ui/States'
import { MacroCard } from '../ui/MacroCard'
import { StatTile } from '../ui/StatTile'
import { DataTable } from '../ui/DataTable'
import { Sparkline } from '../ui/Sparkline'
import { ResponsiveChartBox } from '../charts/ChartBox'
import { useChartTheme } from '../ui/theme'
import {
  categoryAxis, chartAnimation, chartDataZoom, chartGrid, chartLegend,
  chartTooltip, lineSeries, markLine, valueAxis,
} from '../../lib/chartOptions'
import type { BacktestSnapshot } from '../../lib/core'

type Dir = -1 | 0 | 1

interface RegimeSignal {
  name: string
  value: number | string
  score: -1 | 0 | 1
  detail?: string
  sparkline?: { date: string; value: number }[]
}

interface RegimeData {
  regime: string
  label: string
  confidence: number
  signals: RegimeSignal[]
  updatedAt: string
}

interface BacktestSummary {
  regime: string
  label: string
  count: number
  avgConfidence: number
  avgReturn1m: number
  avgReturn3m: number
  avgReturn6m: number
  avgReturn12m: number
  winRate1m: number
  winRate3m: number
  winRate6m: number
  winRate12m: number
}

const REGIME_LABELS: Record<string, string> = {
  GOLDILOCKS: '金发女孩',
  RISK_ON: '风险偏好',
  OVERHEAT: '过热',
  STAGFLATION: '滞胀',
  RISK_OFF: '风险规避',
  RECOVERY: '复苏',
  UNKNOWN: '不确定',
}

const REGIME_DIR: Record<string, Dir> = {
  GOLDILOCKS: 1,
  RISK_ON: 1,
  RECOVERY: 1,
  OVERHEAT: 0,
  STAGFLATION: -1,
  RISK_OFF: -1,
  UNKNOWN: 0,
}

const REGIME_DESC: Record<string, string> = {
  GOLDILOCKS: '经济增长稳健、通胀受控、无系统性压力、收益率曲线正常。风险资产（股票/商品）占优，是理想的投资环境。',
  RISK_ON: '经济增长稳健、通胀受控，但存在一定市场压力。风险资产仍可持有，但需关注压力来源。',
  OVERHEAT: '经济增长强劲但通胀偏高，央行可能收紧政策。关注利率敏感板块，适度防御。',
  STAGFLATION: '增长放缓叠加通胀高企，最棘手的宏观组合。现金和实物资产相对占优，股票承压。',
  RISK_OFF: '经济收缩、市场恐慌，典型的避险环境。国债、黄金、现金为王，远离风险资产。',
  RECOVERY: '经济从底部回升，政策仍偏宽松。关注周期股和新兴市场，逐步增加风险敞口。',
  UNKNOWN: '当前信号不够明确，无法判定单一体制。建议保持均衡配置，等待更多数据确认。',
}

const REGIME_BG: Record<string, string> = {
  GOLDILOCKS: 'rgba(34,197,94,0.08)',
  RISK_ON: 'rgba(59,130,246,0.08)',
  OVERHEAT: 'rgba(245,158,11,0.08)',
  STAGFLATION: 'rgba(239,68,68,0.10)',
  RISK_OFF: 'rgba(239,68,68,0.10)',
  RECOVERY: 'rgba(6,182,212,0.08)',
  UNKNOWN: 'rgba(156,163,175,0.05)',
}

function scoreFor(dir: Dir): string {
  if (dir === 1) return '利好'
  if (dir === -1) return '利空'
  return '中性'
}

function toneFor(dir: Dir): string {
  if (dir === 1) return 'text-up'
  if (dir === -1) return 'text-down'
  return 'text-ink-3'
}

function accentFor(dir: Dir): 'green' | 'red' | 'none' {
  if (dir === 1) return 'green'
  if (dir === -1) return 'red'
  return 'none'
}

function severityTone(severity: string): string {
  if (severity === 'critical') return 'text-down font-bold'
  if (severity === 'high') return 'text-down'
  if (severity === 'medium') return 'text-warn'
  return 'text-ink-3'
}

/* --------------------------------------------------------------------------- */

function RegimeOverview({ regime, confidence, label }: { regime: string; confidence: number; label: string }) {
  const dir = REGIME_DIR[regime] ?? 0
  const dirLabel = dir === 1 ? '偏多' : dir === -1 ? '偏空' : '中性'
  const gaugePercent = Math.min(95, Math.max(5, (confidence)))
  const desc = REGIME_DESC[regime] || REGIME_DESC.UNKNOWN

  return (
    <MacroCard accent={accentFor(dir)} padding="lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-2xs uppercase tracking-wider text-ink-3">当前宏观体制</div>
          <h2 className="mt-0.5 text-2xl font-bold text-ink">{label}（{regime}）</h2>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-2">{desc}</p>
        </div>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className={`num text-2xl font-bold ${toneFor(dir)}`}>{dirLabel}</span>
          <span className="text-xs text-ink-3">
            置信度 <span className="num">{confidence}%</span>
          </span>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex justify-between text-2xs uppercase tracking-wider text-ink-3">
          <span>防守</span>
          <span>风险偏好</span>
        </div>
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-gradient-to-r from-down via-ink-3 to-up opacity-60">
          <span className="absolute inset-y-0 left-1/2 w-px bg-bg/70" aria-hidden="true" />
        </div>
        <div className="relative h-3">
          <span
            className="absolute top-0 h-3 w-[3px] -translate-x-1/2 rounded-sm bg-ink transition-[left] duration-3 ease-terminal"
            style={{ left: `${gaugePercent}%` }}
            aria-hidden="true"
          />
        </div>
      </div>
    </MacroCard>
  )
}

function SignalCard({ signal }: { signal: RegimeSignal }) {
  const dir: Dir = signal.score
  const dirLabel = scoreFor(dir)

  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-2xs uppercase tracking-wider text-ink-3">{signal.name}</div>
          <div className={`mt-0.5 num text-lg font-semibold ${toneFor(dir)}`}>{signal.value}</div>
        </div>
        <div className="flex items-center gap-2">
          {signal.sparkline && signal.sparkline.length > 0 && (
            <Sparkline
              data={signal.sparkline}
              width={120}
              height={40}
              color={dir === 1 ? '#22c55e' : dir === -1 ? '#ef4444' : '#9ca3af'}
            />
          )}
          <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-2xs font-medium ${
            dir === 1 ? 'bg-up/10 text-up' : dir === -1 ? 'bg-down/10 text-down' : 'bg-surface-2 text-ink-3'
          }`}>
            {dirLabel}
          </span>
        </div>
      </div>
      {signal.detail && (
        <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{signal.detail}</p>
      )}
    </div>
  )
}

/* --------------------------------------------------------------------------- */

export function RegimeDetailDashboard() {
  const [regime, setRegime] = useState<RegimeData | null>(null)
  const [backtest, setBacktest] = useState<BacktestSummary[] | null>(null)
  const [snapshots, setSnapshots] = useState<BacktestSnapshot[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const t = useChartTheme()

  const load = () => {
    let alive = true
    setLoading(true)
    setError('')

    fetch('/api/v1/regime.json')
      .then(r => r.json())
      .then((regimeResult) => {
        if (!alive) return
        if (regimeResult?.success && regimeResult.data) {
          setRegime(regimeResult.data)
        } else {
          setError(regimeResult?.error || '加载体制数据失败')
        }
      })
      .catch((e: any) => {
        if (!alive) return
        setError(e.message || '加载体制数据失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    fetch('/api/v1/regime/backtest.json')
      .then(r => r.json())
      .then((backtestResult) => {
        if (!alive || !backtestResult?.success || !backtestResult.data) return
        setBacktest(backtestResult.data.summaries)
        setSnapshots(backtestResult.data.snapshots ?? null)
      })
      .catch(() => {
        if (!alive) return
        setSnapshots(null)
      })

    return () => { alive = false }
  }

  useEffect(load, [])

  if (loading) return <LoadingSkeleton type="card" rows={3} height={220} />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!regime) return <EmptyState title="暂无数据" description="宏观体制数据同步后将在此展示。" />

  const signals = regime.signals || []
  const signalsCount = signals.filter((s) => s.score !== 0).length

  const regimeSegments = useMemo(() => {
    if (!snapshots || snapshots.length < 2) return [] as { from: string; to: string; regime: string; label: string }[]
    const segments: { from: string; to: string; regime: string; label: string }[] = []
    let segStart = snapshots[0].date
    let segRegime = snapshots[0].regime
    let segLabel = snapshots[0].label
    for (let i = 1; i < snapshots.length; i++) {
      if (snapshots[i].regime !== segRegime) {
        segments.push({ from: segStart, to: snapshots[i].date, regime: segRegime, label: segLabel })
        segStart = snapshots[i].date
        segRegime = snapshots[i].regime
        segLabel = snapshots[i].label
      }
    }
    const last = snapshots[snapshots.length - 1]
    segments.push({ from: segStart, to: last.date, regime: segRegime, label: segLabel })
    return segments
  }, [snapshots])

  const sp500Option = useMemo<EChartsOption | null>(() => {
    if (!snapshots || snapshots.length < 2) return null
    const valid = snapshots.filter((s) => s.sp500Price > 0)
    if (valid.length < 2) return null
    const dates = valid.map((s) => s.date)
    const prices = valid.map((s) => s.sp500Price)
    const total = dates.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, {
        valueFormatter: (v: any) => (v == null ? '--' : `$${Number(v).toFixed(2)}`),
      }),
      grid: chartGrid({ top: 14, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { name: 'S&P500', nameTextStyle: { color: t.text3, fontSize: 10 } }),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: [
        {
          name: 'S&P500',
          type: 'line',
          data: prices,
          smooth: 0.25,
          lineStyle: { width: 2, color: t.series[2] },
          itemStyle: { color: t.series[2] },
          showSymbol: false,
          emphasis: { focus: 'series', lineStyle: { width: 2.6 } },
          markArea: {
            silent: true,
            data: regimeSegments.map((seg) => ({
              xAxis: seg.from,
              xAxisEnd: seg.to,
              itemStyle: { color: REGIME_BG[seg.regime] || 'transparent' },
              label: { show: false },
            })),
          },
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            animation: false,
            data: regimeSegments.slice(1).map((seg) => ({
              xAxis: seg.from,
              lineStyle: { color: t.border, type: 'dashed', width: 1 },
              label: { show: false },
            })),
          },
        },
      ],
    } as EChartsOption
  }, [snapshots, regimeSegments, t])

  return (
    <div className="flex flex-col gap-4">
      <RegimeOverview
        regime={regime.regime}
        confidence={regime.confidence}
        label={regime.label}
      />

      <div className="flex flex-wrap gap-2">
        <StatTile label="更新日期" value={regime.updatedAt} accent="blue" />
        <StatTile label="信号数" value={`${signalsCount} / ${signals.length}`} accent="cyan" />
        <StatTile label="置信度" value={`${regime.confidence}%`} accent={regime.confidence > 60 ? 'green' : 'gold'} />
      </div>

      {sp500Option && (
        <MacroCard title="S&P500 走势与宏观体制" padding="sm">
          <ResponsiveChartBox option={sp500Option} deps={[sp500Option]} />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-3">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: 'rgba(34,197,94,0.35)' }} /> 金发女孩</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: 'rgba(59,130,246,0.35)' }} /> 风险偏好</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: 'rgba(245,158,11,0.35)' }} /> 过热</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: 'rgba(239,68,68,0.35)' }} /> 滞胀</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: 'rgba(239,68,68,0.35)' }} /> 风险规避</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: 'rgba(6,182,212,0.35)' }} /> 复苏</span>
            <span className="inline-flex items-center gap-1.5 text-ink-3">背景色 = 当时判定宏观体制；虚线 = 体制切换点</span>
          </div>
        </MacroCard>
      )}

      <MacroCard title="各指标信号详解" padding="md">
        <p className="mb-3 text-xs leading-relaxed text-ink-3">
          以下为构成当前宏观体制判定的各经济指标最新状态及评分。
        </p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {signals.map((s, i) => (
            <SignalCard key={i} signal={s} />
          ))}
        </div>
      </MacroCard>

      <MacroCard title="体制判定逻辑" padding="md">
        <p className="mb-3 text-xs leading-relaxed text-ink-3">
          宏观体制通过以下决策树判定：增长（CFNAI）、通胀（CPI）、压力（VIX/BBB）、曲线斜率（10Y-2Y）的组合决定当前所处体制。
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { regime: 'GOLDILOCKS', cond: '增长OK + 无通胀 + 无压力 + 曲线正常' },
            { regime: 'RISK_ON', cond: '增长OK + 无通胀 + 有压力' },
            { regime: 'OVERHEAT', cond: '增长OK + 有通胀 + 无压力' },
            { regime: 'STAGFLATION', cond: '增长OK + 有通胀 + 有压力 或 无增长 + 有通胀 + 有压力' },
            { regime: 'RISK_OFF', cond: '无增长 + 无通胀 + 有压力' },
            { regime: 'RECOVERY', cond: 'CFNAI中性 + 利率正常 + 无压力' },
          ].map((item) => (
            <div
              key={item.regime}
              className={`rounded-md border p-2.5 text-xs ${
                regime.regime === item.regime
                  ? 'border-accent bg-accent/10 text-ink'
                  : 'border-line bg-surface-2 text-ink-2'
              }`}
            >
              <div className="font-semibold">{REGIME_LABELS[item.regime]}</div>
              <div className="mt-0.5 text-2xs text-ink-3">{item.cond}</div>
            </div>
          ))}
        </div>
      </MacroCard>

      <MacroCard title="宏观体制回测：各体制下 S&P500 前瞻表现">
        {backtest && backtest.length > 0 ? (
          <>
            <p className="mb-3 text-2xs leading-relaxed text-ink-3">
              历史上各宏观体制出现后，S&P500 在 1/3/6/12 个月后的平均收益率和胜率。
            </p>
            <DataTable
              columns={[
                { key: 'label', header: '宏观体制', render: (r) => r.label },
                { key: 'count', header: '样本数', numeric: true, render: (r) => `${r.count} 月` },
                {
                  key: 'avgReturn1m', header: '1M 收益', numeric: true,
                  render: (r) => (
                    <span className={r.avgReturn1m >= 0 ? 'text-up' : 'text-down'}>
                      {(r.avgReturn1m * 100).toFixed(2)}%
                    </span>
                  ),
                },
                {
                  key: 'avgReturn3m', header: '3M 收益', numeric: true,
                  render: (r) => (
                    <span className={r.avgReturn3m >= 0 ? 'text-up' : 'text-down'}>
                      {(r.avgReturn3m * 100).toFixed(2)}%
                    </span>
                  ),
                },
                {
                  key: 'avgReturn6m', header: '6M 收益', numeric: true,
                  render: (r) => (
                    <span className={r.avgReturn6m >= 0 ? 'text-up' : 'text-down'}>
                      {(r.avgReturn6m * 100).toFixed(2)}%
                    </span>
                  ),
                },
                {
                  key: 'avgReturn12m', header: '12M 收益', numeric: true,
                  render: (r) => (
                    <span className={r.avgReturn12m >= 0 ? 'text-up' : 'text-down'}>
                      {(r.avgReturn12m * 100).toFixed(2)}%
                    </span>
                  ),
                },
                {
                  key: 'winRate3m', header: '3M 胜率', numeric: true,
                  render: (r) => (
                    <span className={r.winRate3m >= 0.5 ? 'text-up' : 'text-down'}>
                      {(r.winRate3m * 100).toFixed(1)}%
                    </span>
                  ),
                },
              ]}
              rows={backtest}
              rowKey={(r) => r.regime}
            />
          </>
        ) : (
          <p className="py-3 text-xs text-ink-3">
            需要同步 S&P500 数据后自动生成回测统计。回测展示各宏观体制下 S&P500 的 1/3/6/12 个月前瞻收益。
          </p>
        )}
      </MacroCard>

      <p className="text-xs leading-relaxed text-ink-3">
        宏观体制研判基于 FRED 经济数据实时计算，综合增长、通胀、波动率、信用利差、收益率曲线等维度。所有结论仅供研究参考，不构成投资建议。
      </p>
    </div>
  )
}

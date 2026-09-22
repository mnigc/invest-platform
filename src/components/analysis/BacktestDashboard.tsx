import { useMemo, useState, useEffect } from 'react'
import type { EChartsOption } from 'echarts'
import { ResponsiveChartBox } from '../charts/ChartBox'
import { useChartTheme } from '../ui/theme'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { EmptyState, ErrorState } from '../ui/States'
import { MacroCard } from '../ui/MacroCard'
import { StatTile } from '../ui/StatTile'
import { DataTable } from '../ui/DataTable'
import { WinRateMeter } from '../ui/WinRateMeter'
import {
  categoryAxis, chartAnimation, chartDataZoom, chartGrid, chartLegend,
  chartTooltip, lineSeries, valueAxis, defaultZoomStart,
} from '../../lib/chartOptions'

/* ─────────────── payload 类型（与 sync_analysis_backtest.py 对应） ─────────────── */
interface Metrics {
  totalReturn: number | null; cagr: number | null; vol: number | null
  sharpe: number | null; sortino: number | null; maxDD: number; calmar: number | null
  exposure: number; currentPosition: number
  nTrades: number; openTrades: number; winRate: number | null
  avgWin: number | null; avgLoss: number | null; profitFactor: number | null
  expectancy: number | null; avgHoldDays: number | null
  bestTrade: number | null; worstTrade: number | null
}
interface OosSeg { start: string; end: string; cagr: number | null; maxDD: number; winRate: number | null; nTrades: number }
interface Sens { param: number; cagr: number | null; maxDD: number; winRate: number | null; nTrades: number }
interface Strategy {
  key: string; labelZh: string; desc: string
  params: Record<string, number>
  metrics: Metrics
  annual: { year: number; ret: number }[]
  oos: { inSample: OosSeg | null; outSample: OosSeg | null }
  sensitivity?: Sens[]
  equity: { dates: string[]; values: number[] }
}
interface SymbolBlock {
  symbol: string; nameZh: string; basis: string; basisLabel: string
  period: { start: string; end: string; nDays: number }
  costBps: number
  equityDates: string[]
  strategies: Strategy[]
}
interface Data {
  symbols: Record<string, SymbolBlock>
  notes: string[]
  disclaimer: string
  updatedAt: string
}

const pct = (v: number | null | undefined, digits = 1) =>
  v == null ? '--' : `${(v * 100).toFixed(digits)}%`
const num = (v: number | null | undefined) => (v == null ? '--' : String(v))
const toneOf = (v: number | null | undefined) =>
  v == null ? 'neutral' : v > 0 ? 'up' : v < 0 ? 'down' : 'neutral'

export default function BacktestDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [symbol, setSymbol] = useState('')
  const t = useChartTheme()

  useEffect(() => {
    let alive = true
    fetch('/api/v1/analysis/etf-backtest.json')
      .then(r => r.json())
      .then(j => {
        if (!alive) return
        if (j.success) {
          setData(j.data)
          const syms = Object.keys(j.data.symbols)
          setSymbol(syms.includes('SPY') ? 'SPY' : syms[0])
        } else setError(j.error || '加载失败')
      })
      .catch(e => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  const blk = data?.symbols[symbol]

  /* 权益曲线：各策略与买入持有同图（期初=100） */
  const equityOption = useMemo<EChartsOption | null>(() => {
    if (!blk || blk.strategies.length === 0) return null
    const dates = blk.strategies[0].equity.dates
    const total = dates.length
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => (v == null ? '--' : Number(v).toFixed(1)) }),
      legend: chartLegend(t, blk.strategies.map(s => s.labelZh)),
      grid: chartGrid({ top: 32, bottom: 36 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, {
        scale: true,
        axisLabel: { color: t.text3, fontSize: 10, fontFamily: t.fontMono },
      }),
      dataZoom: [chartDataZoom(t, { start: defaultZoomStart(total), end: 100 })],
      series: blk.strategies.map((s, i) =>
        lineSeries(s.labelZh, s.equity.values, t.series[i % t.series.length], {
          lineStyle: { width: s.key === 'buy_hold' ? 1.6 : 1.2 },
        }),
      ),
    } as EChartsOption
  }, [blk, t])

  if (loading) return <LoadingSkeleton type="chart" />
  if (error) return <ErrorState message={error} />
  if (!data || !blk) return <EmptyState title="暂无数据" />

  const symbols = Object.keys(data.symbols)
  const bh = blk.strategies.find(s => s.key === 'buy_hold')
  const active = blk.strategies.filter(s => s.key !== 'buy_hold')

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
            <span className="ml-1.5 text-2xs text-ink-3">{data.symbols[s].nameZh}</span>
          </button>
        ))}
        <span className="ml-auto rounded border border-line px-2 py-1 text-2xs text-ink-3">
          {blk.basisLabel} · {blk.period.start} ~ {blk.period.end} · 成本 {blk.costBps}bp/边
        </span>
      </div>

      {/* 权益曲线 */}
      <MacroCard title="策略资金曲线（期初 = 100，月度）" padding="sm">
        <ResponsiveChartBox option={equityOption} deps={[equityOption]} />
        <p className="px-3 pb-2 text-2xs text-ink-3">
          任何策略的评判基准都是买入持有线：长期跑不赢它（尤其按风险调整后）的策略没有存在价值。
        </p>
      </MacroCard>

      {/* 指标对比总表 */}
      <MacroCard title="核心指标对比" padding="sm">
        <DataTable
          columns={[
            { key: 'name', header: '策略', render: (s: Strategy) => <span title={s.desc}>{s.labelZh}</span> },
            { key: 'cagr', header: 'CAGR', numeric: true, render: (s: Strategy) => pct(s.metrics.cagr) },
            { key: 'maxdd', header: '最大回撤', numeric: true, render: (s: Strategy) => <span className="text-down">{pct(s.metrics.maxDD)}</span> },
            { key: 'sharpe', header: 'Sharpe', numeric: true, render: (s: Strategy) => num(s.metrics.sharpe) },
            { key: 'calmar', header: 'Calmar', numeric: true, render: (s: Strategy) => num(s.metrics.calmar) },
            {
              key: 'win', header: '交易胜率', numeric: true,
              render: (s: Strategy) => (
                <div className="min-w-14">
                  <div className="num">{s.metrics.winRate != null ? pct(s.metrics.winRate, 0) : '--'}</div>
                  {s.metrics.winRate != null && <WinRateMeter value={s.metrics.winRate} />}
                </div>
              ),
            },
            { key: 'pf', header: '盈亏比 PF', numeric: true, render: (s: Strategy) => num(s.metrics.profitFactor) },
            { key: 'exp', header: '单笔期望', numeric: true, render: (s: Strategy) => <span className={s.metrics.expectancy != null && s.metrics.expectancy > 0 ? 'text-up' : 'text-down'}>{pct(s.metrics.expectancy, 2)}</span> },
            { key: 'n', header: '交易数', numeric: true, render: (s: Strategy) => s.metrics.nTrades },
            { key: 'exp2', header: '仓位暴露', numeric: true, render: (s: Strategy) => pct(s.metrics.exposure, 0) },
          ]}
          rows={blk.strategies}
          rowKey={(s: Strategy) => s.key}
        />
        <p className="px-3 pt-2 text-2xs text-ink-3">
          胜率×平均盈利 −（1−胜率）×平均亏损 = 单笔期望。高胜率常伴随低盈亏比（均值回归）、负偏度；趋势过滤相反。
        </p>
      </MacroCard>

      {/* 策略卡片 */}
      {active.map(s => (
        <MacroCard key={s.key} title={`${s.labelZh} · ${s.key}`} accent={s.key === 'rsi2_dip' ? 'blue' : s.key === 'sma200' ? 'green' : 'none'} padding="sm">
          <p className="px-3 pt-1 text-xs leading-relaxed text-ink-2">{s.desc}</p>
          <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-4 lg:grid-cols-6">
            <StatTile label="CAGR" value={pct(s.metrics.cagr)} tone={toneOf(s.metrics.cagr)} sub={bh && s.metrics.cagr != null && bh.metrics.cagr != null ? `vs 基准 ${((s.metrics.cagr - bh.metrics.cagr) * 100).toFixed(1)}pp` : undefined} />
            <StatTile label="最大回撤" value={pct(s.metrics.maxDD)} tone="down" sub={bh ? `vs 基准 ${((s.metrics.maxDD - bh.metrics.maxDD) * 100).toFixed(1)}pp` : undefined} />
            <StatTile label="Sharpe / Sortino" value={`${num(s.metrics.sharpe)} / ${num(s.metrics.sortino)}`} />
            <StatTile label="胜率" value={s.metrics.winRate != null ? pct(s.metrics.winRate, 1) : '--'} tone={s.metrics.winRate != null && s.metrics.winRate >= 0.5 ? 'up' : 'neutral'} sub={`${s.metrics.nTrades} 笔 · 均持 ${num(s.metrics.avgHoldDays)} 天`} />
            <StatTile label="平均盈利 / 亏损" value={`${pct(s.metrics.avgWin, 2)} / ${pct(s.metrics.avgLoss, 2)}`} sub={`最好 ${pct(s.metrics.bestTrade, 1)} · 最差 ${pct(s.metrics.worstTrade, 1)}`} />
            <StatTile label="当前状态" value={s.metrics.currentPosition ? '持仓中' : '空仓'} tone={s.metrics.currentPosition ? 'up' : 'neutral'} sub={`仓位暴露 ${pct(s.metrics.exposure, 0)}`} />
          </div>

          {/* 样本内外分段 */}
          {s.oos.inSample && s.oos.outSample && (
            <div className="px-3 pb-3">
              <div className="mb-1.5 text-2xs uppercase tracking-wider text-ink-3">样本内 / 样本外（70/30）—— 两段差异大即为过拟合警示</div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatTile label="样本内 CAGR" value={pct(s.oos.inSample.cagr)} sub={`${s.oos.inSample.start} ~ ${s.oos.inSample.end}`} />
                <StatTile label="样本内 回撤/胜率" value={`${pct(s.oos.inSample.maxDD)} / ${s.oos.inSample.winRate != null ? pct(s.oos.inSample.winRate, 0) : '--'}`} />
                <StatTile label="样本外 CAGR" value={pct(s.oos.outSample.cagr)} tone={toneOf(s.oos.outSample.cagr)} sub={`${s.oos.outSample.start} ~ ${s.oos.outSample.end}`} />
                <StatTile label="样本外 回撤/胜率" value={`${pct(s.oos.outSample.maxDD)} / ${s.oos.outSample.winRate != null ? pct(s.oos.outSample.winRate, 0) : '--'}`} />
              </div>
            </div>
          )}

          {/* 参数敏感性 */}
          {s.sensitivity && s.sensitivity.length > 0 && (
            <div className="px-3 pb-3">
              <div className="mb-1.5 text-2xs uppercase tracking-wider text-ink-3">参数敏感性 —— 只在单一参数下有效的策略是过拟合</div>
              <DataTable
                columns={[
                  { key: 'p', header: s.key === 'sma200' ? '均线窗口' : 'RSI 进场阈值', numeric: true, render: (r: Sens) => r.param },
                  { key: 'c', header: 'CAGR', numeric: true, render: (r: Sens) => pct(r.cagr) },
                  { key: 'm', header: '最大回撤', numeric: true, render: (r: Sens) => pct(r.maxDD) },
                  { key: 'w', header: '胜率', numeric: true, render: (r: Sens) => r.winRate != null ? pct(r.winRate, 0) : '--' },
                  { key: 'n', header: '交易数', numeric: true, render: (r: Sens) => r.nTrades },
                ]}
                rows={s.sensitivity}
                rowKey={(r: Sens) => String(r.param)}
              />
            </div>
          )}
        </MacroCard>
      ))}

      {/* 口径与免责声明 */}
      <MacroCard title="回测口径与声明" padding="sm">
        <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-ink-2">
          {data.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
        <p className="mt-2 border-t border-line pt-2 text-xs text-warn">{data.disclaimer}</p>
      </MacroCard>
    </div>
  )
}

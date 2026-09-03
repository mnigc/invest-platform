import { useState, useMemo, useEffect } from 'react'
import type { EChartsOption } from 'echarts'
import { ResponsiveChartBox } from '../charts/ChartBox'
import { useChartTheme } from '../ui/theme'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { EmptyState, ErrorState } from '../ui/States'
import { MacroCard } from '../ui/MacroCard'
import { StatTile } from '../ui/StatTile'
import {
  categoryAxis, chartAnimation, chartDataZoom, chartGrid, chartLegend,
  chartTooltip, lineSeries, markLine, valueAxis, eventLine,
} from '../../lib/chartOptions'

interface Data {
  curveHistory: { dates: string[]; tenors: { name: string; data: (number | null)[] }[] }
  spreadHistory: { date: string; spread10y2y: number | null; shape: string }[]
  regimeTransitions: { fromRegime: string; toRegime: string; date: string; spreadAtTransition: number | null }[]
  forwardReturns: ForwardBucket[]
  forwardReturnsByIndex: ForwardByIndex[]
  inversionPeriods: InversionPeriod[]
  currentSpread: { spread10y2y: number | null; percentile1y: number | null; percentile5y: number | null; zScore: number | null; inversionMonths: number; signal: string; signalDesc: string }
  updatedAt: string
}

interface ForwardBucket {
  spreadRange: string
  avgReturn1m: number
  avgReturn3m: number
  avgReturn6m: number
  avgReturn12m: number
  winRate1m: number
  winRate3m: number
  winRate6m: number
  winRate12m: number
  sampleSize: number
}

interface ForwardByIndex {
  symbol: string
  nameZh: string
  buckets: ForwardBucket[]
}

interface InversionPeriod {
  start: string
  end: string
}

const SIGNAL_ACCENT: Record<string, 'green' | 'red' | 'gold' | 'none'> = { strong_buy: 'green', buy: 'green', neutral: 'none', warning: 'gold', strong_warning: 'red' }
const SIGNAL_COLORS: Record<string, string> = { strong_buy: 'text-up', buy: 'text-up', neutral: 'text-ink-3', warning: 'text-warn', strong_warning: 'text-down' }

export default function YieldCurveRegimeDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [summaryIndex, setSummaryIndex] = useState('^GSPC')
  const t = useChartTheme()

  useEffect(() => {
    let alive = true
    fetch('/api/v1/analysis/yield-curve-regime.json')
      .then(r => r.json())
      .then(j => { if (!alive) return; if (j.success) setData(j.data); else setError(j.error || '加载失败') })
      .catch(e => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  const spreadOption = useMemo<EChartsOption | null>(() => {
    if (!data?.spreadHistory) return null
    const dates = data.spreadHistory.map(p => p.date)
    const spreadData = data.spreadHistory.map(p => p.spread10y2y)
    const total = dates.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => v == null ? '--' : `${Number(v).toFixed(3)}%` }),
      grid: chartGrid({ top: 14, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { name: '%', nameTextStyle: { color: t.text3, fontSize: 10 } }),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
        series: [{
          name: '10Y-2Y',
          type: 'line',
          data: spreadData,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 1.2, color: t.series[2] },
        itemStyle: { color: t.series[2] },
        markArea: {
          silent: true,
          data: (data.inversionPeriods ?? []).map((iv) => [
            {
              xAxis: iv.start,
              itemStyle: { color: t.downBg },
              label: { show: false },
            },
            { xAxis: iv.end },
          ]),
        },
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          animation: false,
          data: [
            { yAxis: 0, lineStyle: { color: t.border, type: 'dashed' }, label: { show: false } },
            ...(data.regimeTransitions ?? [])
              .slice(-8)
              .map((r) => {
                const isRiskOff = r.toRegime === 'RISK_OFF' || r.toRegime === 'STAGFLATION'
                return eventLine(r.date, isRiskOff ? t.down : t.up, `${r.fromRegime}→${r.toRegime}`)
              }),
          ],
        },
      }],
    } as EChartsOption
  }, [data, t])

  const curveOption = useMemo<EChartsOption | null>(() => {
    if (!data?.curveHistory) return null
    const { dates, tenors } = data.curveHistory
    const total = dates.length
    const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => v == null ? '--' : `${Number(v).toFixed(3)}%` }),
      legend: chartLegend(t, tenors.map(tn => tn.name)),
      grid: chartGrid({ top: 32, bottom: 32 }),
      xAxis: categoryAxis(t, dates),
      yAxis: valueAxis(t, { name: '%', nameTextStyle: { color: t.text3, fontSize: 10 } }),
      dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
      series: tenors.map((tn, i) => lineSeries(tn.name, tn.data, t.series[i % t.series.length], { lineStyle: { width: i === 0 ? 1 : 1.2 } })),
    } as EChartsOption
  }, [data, t])

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  const sigTone = SIGNAL_COLORS[data.currentSpread.signal] || 'text-ink-3'

  const forwardByIndex = data.forwardReturnsByIndex ?? []
  const currentForward =
    forwardByIndex.find((f) => f.symbol === summaryIndex) ?? forwardByIndex[0] ?? null

  return (
    <div className="space-y-4">
      <MacroCard accent={SIGNAL_ACCENT[data.currentSpread.signal] || 'none'}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatTile label="10Y-2Y 利差" value={data.currentSpread.spread10y2y != null ? `${data.currentSpread.spread10y2y.toFixed(2)}%` : '--'} className={data.currentSpread.spread10y2y != null && data.currentSpread.spread10y2y < 0 ? 'text-down' : ''} />
          <StatTile label="1Y 百分位" value={data.currentSpread.percentile1y != null ? `${data.currentSpread.percentile1y.toFixed(0)}%` : '--'} />
          <StatTile label="5Y 百分位" value={data.currentSpread.percentile5y != null ? `${data.currentSpread.percentile5y.toFixed(0)}%` : '--'} />
          <StatTile label="Z-Score" value={data.currentSpread.zScore != null ? data.currentSpread.zScore.toFixed(2) : '--'} className={Math.abs(data.currentSpread.zScore ?? 0) > 1 ? 'text-warn' : ''} />
          <StatTile label="倒挂月数" value={`${data.currentSpread.inversionMonths}`} className={data.currentSpread.inversionMonths > 0 ? 'text-down' : ''} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className={`rounded-sm border border-line bg-surface-2 px-2 py-0.5 text-2xs font-bold ${sigTone}`}>
            {data.currentSpread.signal.toUpperCase()}
          </span>
          <span className="text-xs leading-relaxed text-ink-2">{data.currentSpread.signalDesc}</span>
        </div>
        <div className="mt-2 grid gap-1 text-2xs leading-relaxed text-ink-3">
          <span>分位：1/5 年 {data.currentSpread.percentile1y != null ? `${data.currentSpread.percentile1y.toFixed(0)}%` : '--'} / {data.currentSpread.percentile5y != null ? `${data.currentSpread.percentile5y.toFixed(0)}%` : '--'}，越接近 100% 越逼近历史极端。</span>
          <span>Z-Score：{data.currentSpread.zScore != null ? data.currentSpread.zScore.toFixed(2) : '--'}，|Z| &gt; 1 视为对中枢显著偏离。</span>
          <span>倒挂月数：{data.currentSpread.inversionMonths} 个月；&gt; 3 个月需警惕衰退，&gt; 6 个月历史上多预示风险。</span>
        </div>
      </MacroCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MacroCard title="10Y-2Y 利差走势" padding="sm">
          <ResponsiveChartBox option={spreadOption} deps={[spreadOption]} />
          {data.regimeTransitions.length > 0 && (
            <p className="mt-2 text-2xs leading-relaxed text-ink-3">
              <span className="text-down">红色背景带</span>：倒挂区间（利差 &lt; 0）；
              <span className="text-up">绿色竖线</span>：转向风险偏好体制；
              <span className="text-down">红色竖线</span>：转向风险规避/滞胀；
              观察信号后利差是否持续倒挂或回升。
            </p>
          )}
        </MacroCard>
        <MacroCard title="收益率曲线" padding="sm">
          <ResponsiveChartBox option={curveOption} deps={[curveOption]} />
        </MacroCard>
      </div>

      {data.regimeTransitions.length > 0 && (
        <MacroCard title="近期体制转换" padding="sm">
          <div className="space-y-1.5">
            {[...data.regimeTransitions].slice(-5).reverse().map((r, i) => (
              <div key={i} className="flex justify-between items-center py-1.5 border-b border-line last:border-0 text-xs">
                <span className="text-ink-2">{r.date}</span>
                <span className="text-ink-3">{r.fromRegime} → {r.toRegime}</span>
                {r.spreadAtTransition != null && <span className="num">{r.spreadAtTransition.toFixed(2)}%</span>}
              </div>
            ))}
          </div>
        </MacroCard>
      )}

      <MacroCard
        title="利差区间前瞻收益"
        padding="sm"
        badge={
          forwardByIndex.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {forwardByIndex.map((idx) => (
                <button
                  key={idx.symbol}
                  type="button"
                  onClick={() => setSummaryIndex(idx.symbol)}
                  className={`rounded-sm border px-2 py-0.5 text-2xs transition-colors duration-1 ease-terminal ${
                    currentForward?.symbol === idx.symbol
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-surface-2 text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {idx.nameZh.replace('指数', '')}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        <p className="mb-3 text-2xs leading-relaxed text-ink-3">
          历史上当 10Y-2Y 利差落在各区间时，
          {(currentForward?.nameZh ?? 'S&P500').replace('指数', '')} 在 1/3/6 个月后的平均收益；
          胜率列为该区间 12 个月后上涨的比例。以下为历史统计、非预测，且不同指数口径有差异。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-ink-3">
                <th className="py-1.5 text-left font-medium">区间</th>
                <th className="py-1.5 text-right font-medium">1M 均值</th>
                <th className="py-1.5 text-right font-medium">3M 均值</th>
                <th className="py-1.5 text-right font-medium">6M 均值</th>
                <th className="py-1.5 text-right font-medium">胜率(12M)</th>
                <th className="py-1.5 text-right font-medium">样本</th>
              </tr>
            </thead>
            <tbody>
              {(currentForward?.buckets ?? []).map((r, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="py-1.5 text-ink-2">{r.spreadRange}</td>
                  <td className="py-1.5 text-right num">{r.avgReturn1m.toFixed(2)}%</td>
                  <td className="py-1.5 text-right num">{r.avgReturn3m.toFixed(2)}%</td>
                  <td className="py-1.5 text-right num">{r.avgReturn6m.toFixed(2)}%</td>
                  <td className="py-1.5 text-right num">{(r.winRate12m * 100).toFixed(0)}%</td>
                  <td className="py-1.5 text-right num text-ink-3">{r.sampleSize}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </MacroCard>
    </div>
  )
}

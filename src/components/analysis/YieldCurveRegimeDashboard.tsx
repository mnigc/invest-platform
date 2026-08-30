import { useState, useMemo, useEffect } from 'react'
import type { EChartsOption } from 'echarts'
import { ChartBox } from '../charts/ChartBox'
import { StatTile } from '../ui/StatTile'
import { DataFreshness } from '../ui/DataFreshness'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { EmptyState, ErrorState } from '../ui/States'
import { PageHeader } from '../ui/PageHeader'

interface YieldCurveRegimeData {
  curveHistory: {
    dates: string[]
    tenors: { name: string; data: (number | null)[] }[]
  }
  spreadHistory: { date: string; spread10y2y: number | null; shape: string }[]
  regimeTransitions: { fromRegime: string; toRegime: string; date: string; spreadAtTransition: number | null }[]
  forwardReturns: { spreadRange: string; avgReturn1m: number; avgReturn3m: number; avgReturn6m: number; avgReturn12m: number; winRate1m: number; winRate3m: number; winRate6m: number; winRate12m: number; sampleSize: number }[]
  currentSpread: {
    spread10y2y: number | null
    percentile1y: number | null
    percentile5y: number | null
    zScore: number | null
    inversionMonths: number
    signal: string
    signalDesc: string
  }
  updatedAt: string
}

const REGIME_LABELS: Record<string, string> = {
  GOLDILOCKS: '金发女孩', RISK_ON: '风险偏好', OVERHEAT: '过热',
  STAGFLATION: '滞胀', RISK_OFF: '风险规避', RECOVERY: '复苏', UNKNOWN: '不确定',
}

const SIGNAL_COLORS: Record<string, string> = {
  strong_buy: 'text-green-400',
  buy: 'text-green-300',
  neutral: 'text-yellow-400',
  warning: 'text-orange-400',
  strong_warning: 'text-red-400',
}

export default function YieldCurveRegimeDashboard() {
  const [data, setData] = useState<YieldCurveRegimeData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/analysis/yield-curve-regime.json')
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        if (json.success) setData(json.data)
        else setError(json.error || '加载失败')
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [])

  const spreadOption = useMemo<EChartsOption | null>(() => {
    if (!data?.spreadHistory) return null
    const dates = data.spreadHistory.map(p => p.date)
    const spreadData = data.spreadHistory.map(p => p.spread10y2y)
    return {
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value', name: '利差 (%)' },
      series: [
        { name: '10Y-2Y 利差', type: 'line', data: spreadData, smooth: true },
        { name: '零线', type: 'line', data: dates.map(() => 0), lineStyle: { type: 'dashed', color: '#666' } },
      ],
      dataZoom: [{ type: 'slider', start: 70, end: 100 }],
    }
  }, [data])

  const curveOption = useMemo<EChartsOption | null>(() => {
    if (!data?.curveHistory) return null
    const { dates, tenors } = data.curveHistory
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: tenors.map(t => t.name) },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value', name: '收益率 (%)' },
      series: tenors.map((t, i) => ({
        name: t.name,
        type: 'line',
        data: t.data,
        smooth: true,
        lineStyle: { width: i === 0 ? 1 : 2 },
      })),
      dataZoom: [{ type: 'slider', start: 70, end: 100 }],
    }
  }, [data])

  if (isLoading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  const signalClass = SIGNAL_COLORS[data.currentSpread.signal] || 'text-yellow-400'

  return (
    <div className="space-y-6">
      <PageHeader
        title="收益率曲线 × 宏观体制联动"
        subtitle="曲线形态与经济周期的交叉分析"
        actions={<DataFreshness />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="10Y-2Y 利差"
          value={data.currentSpread.spread10y2y != null ? `${data.currentSpread.spread10y2y.toFixed(2)}%` : '--'}
          className={data.currentSpread.spread10y2y != null && data.currentSpread.spread10y2y < 0 ? 'text-red-400' : 'text-green-400'}
        />
        <StatTile
          label="1年分位数"
          value={data.currentSpread.percentile1y != null ? `${data.currentSpread.percentile1y.toFixed(0)}%` : '--'}
        />
        <StatTile
          label="5年分位数"
          value={data.currentSpread.percentile5y != null ? `${data.currentSpread.percentile5y.toFixed(0)}%` : '--'}
        />
        <StatTile
          label="倒挂月数"
          value={`${data.currentSpread.inversionMonths}`}
          className={data.currentSpread.inversionMonths > 0 ? 'text-red-400' : ''}
        />
      </div>

      <div className={`p-4 rounded-lg border ${signalClass} bg-opacity-10`} style={{ backgroundColor: 'rgb(var(--c-surface-2))' }}>
        <div className={`font-semibold ${signalClass}`}>{data.currentSpread.signal.replace('_', ' ').toUpperCase()}</div>
        <div className="text-sm mt-1" style={{ color: 'rgb(var(--c-text-2))' }}>{data.currentSpread.signalDesc}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>收益率曲线形态</h3>
          <ChartBox option={curveOption} height={300} />
        </div>
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>10Y-2Y 利差走势</h3>
          <ChartBox option={spreadOption} height={300} />
        </div>
      </div>

      <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>不同利差区间的前瞻收益</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
                <th className="text-left py-2 px-3" style={{ color: 'rgb(var(--c-text-2))' }}>利差区间</th>
                <th className="text-right py-2 px-3" style={{ color: 'rgb(var(--c-text-2))' }}>1月收益</th>
                <th className="text-right py-2 px-3" style={{ color: 'rgb(var(--c-text-2))' }}>3月收益</th>
                <th className="text-right py-2 px-3" style={{ color: 'rgb(var(--c-text-2))' }}>6月收益</th>
                <th className="text-right py-2 px-3" style={{ color: 'rgb(var(--c-text-2))' }}>12月收益</th>
                <th className="text-right py-2 px-3" style={{ color: 'rgb(var(--c-text-2))' }}>样本数</th>
              </tr>
            </thead>
            <tbody>
              {data.forwardReturns.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
                  <td className="py-2 px-3" style={{ color: 'rgb(var(--c-text))' }}>{row.spreadRange}</td>
                  <td className={`text-right py-2 px-3 ${row.avgReturn1m >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {row.avgReturn1m.toFixed(2)}%
                  </td>
                  <td className={`text-right py-2 px-3 ${row.avgReturn3m >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {row.avgReturn3m.toFixed(2)}%
                  </td>
                  <td className={`text-right py-2 px-3 ${row.avgReturn6m >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {row.avgReturn6m.toFixed(2)}%
                  </td>
                  <td className={`text-right py-2 px-3 ${row.avgReturn12m >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {row.avgReturn12m.toFixed(2)}%
                  </td>
                  <td className="text-right py-2 px-3" style={{ color: 'rgb(var(--c-text-2))' }}>{row.sampleSize}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.regimeTransitions.length > 0 && (
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>近期体制转换</h3>
          <div className="space-y-2">
            {data.regimeTransitions.slice(-5).reverse().map((t, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-2" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
                <span style={{ color: 'rgb(var(--c-text-2))' }}>{t.date}</span>
                <span style={{ color: 'rgb(var(--c-text))' }}>
                  {REGIME_LABELS[t.fromRegime] || t.fromRegime} → {REGIME_LABELS[t.toRegime] || t.toRegime}
                </span>
                <span style={{ color: 'rgb(var(--c-text-2))' }}>
                  利差: {t.spreadAtTransition != null ? `${t.spreadAtTransition.toFixed(2)}%` : '--'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

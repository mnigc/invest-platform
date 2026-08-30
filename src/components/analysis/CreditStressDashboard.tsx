import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { ChartBox } from '../charts/ChartBox'
import { StatTile } from '../ui/StatTile'
import { DataFreshness } from '../ui/DataFreshness'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { EmptyState, ErrorState } from '../ui/States'
import { PageHeader } from '../ui/PageHeader'

interface CreditStressData {
  creditSpreadHistory: {
    dates: string[]
    series: { name: string; rating: string; data: (number | null)[] }[]
  }
  creditRateStressIndex: {
    dates: string[]
    stressIndex: (number | null)[]
    creditComponent: (number | null)[]
    rateComponent: (number | null)[]
  }
  creditCyclePhase: {
    currentPhase: string
    phaseLabel: string
    phaseDesc: string
    monthsInPhase: number
  }
  forwardReturns: { stressLevel: string; avgReturn1m: number; avgReturn3m: number; avgReturn6m: number; avgReturn12m: number; winRate1m: number; winRate3m: number; winRate6m: number; winRate12m: number; sampleSize: number }[]
  currentSnapshot: {
    igSpread: number | null
    hySpread: number | null
    aaaSpread: number | null
    cccSpread: number | null
    dgs10: number | null
    dgs2: number | null
    stressIndex: number | null
    stressPercentile1y: number | null
    stressPercentile5y: number | null
    creditCyclePhase: string
    signal: string
    signalDesc: string
  }
  signal: {
    direction: string
    strength: string
    confidence: number
    evidence: string[]
    counterEvidence: string[]
  }
  updatedAt: string
}

const SIGNAL_COLORS: Record<string, string> = {
  low_stress: 'text-green-400',
  moderate_stress: 'text-yellow-400',
  high_stress: 'text-orange-400',
  extreme_stress: 'text-red-400',
}

const DIRECTION_COLORS: Record<string, string> = {
  risk_on: 'text-green-400',
  risk_off: 'text-red-400',
  neutral: 'text-yellow-400',
}

export default function CreditStressDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['creditStress'],
    queryFn: async () => {
      const res = await fetch('/api/v1/analysis/credit-rate-stress.json')
      if (!res.ok) throw new Error('Network error')
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      return json.data as CreditStressData
    },
    refetchInterval: 600000,
    staleTime: 300000,
  })

  const spreadOption = useMemo<EChartsOption | null>(() => {
    if (!data?.creditSpreadHistory) return null
    const { dates, series } = data.creditSpreadHistory
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: series.map(s => s.name) },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value', name: '利差 (%)' },
      series: series.map(s => ({
        name: s.name,
        type: 'line',
        data: s.data,
        smooth: true,
      })),
      dataZoom: [{ type: 'slider', start: 70, end: 100 }],
    }
  }, [data])

  const stressOption = useMemo<EChartsOption | null>(() => {
    if (!data?.creditRateStressIndex) return null
    const { dates, stressIndex, creditComponent, rateComponent } = data.creditRateStressIndex
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['综合压力', '信用压力', '利率压力'] },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value', name: '压力指数 (σ)' },
      series: [
        { name: '综合压力', type: 'line', data: stressIndex, smooth: true, lineStyle: { width: 2 } },
        { name: '信用压力', type: 'line', data: creditComponent, smooth: true },
        { name: '利率压力', type: 'line', data: rateComponent, smooth: true },
      ],
      dataZoom: [{ type: 'slider', start: 70, end: 100 }],
    }
  }, [data])

  if (isLoading) return <LoadingSkeleton />
  if (error) return <ErrorState message="加载失败" />
  if (!data) return <EmptyState title="暂无数据" />

  const signalClass = SIGNAL_COLORS[data.currentSnapshot.signal] || 'text-yellow-400'
  const directionClass = DIRECTION_COLORS[data.signal.direction] || 'text-yellow-400'

  return (
    <div className="space-y-6">
      <PageHeader
        title="信用-利率交叉压力分析"
        subtitle="利差扩张 × 利率下行 = 衰退信号"
        actions={<DataFreshness />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="IG (BBB) 利差"
          value={data.currentSnapshot.igSpread != null ? `${data.currentSnapshot.igSpread.toFixed(2)}%` : '--'}
        />
        <StatTile
          label="HY 利差"
          value={data.currentSnapshot.hySpread != null ? `${data.currentSnapshot.hySpread.toFixed(2)}%` : '--'}
        />
        <StatTile
          label="10Y 收益率"
          value={data.currentSnapshot.dgs10 != null ? `${data.currentSnapshot.dgs10.toFixed(2)}%` : '--'}
        />
        <StatTile
          label="压力指数"
          value={data.currentSnapshot.stressIndex != null ? `${data.currentSnapshot.stressIndex.toFixed(2)}σ` : '--'}
          className={signalClass}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="压力 1年分位"
          value={data.currentSnapshot.stressPercentile1y != null ? `${data.currentSnapshot.stressPercentile1y.toFixed(0)}%` : '--'}
        />
        <StatTile
          label="压力 5年分位"
          value={data.currentSnapshot.stressPercentile5y != null ? `${data.currentSnapshot.stressPercentile5y.toFixed(0)}%` : '--'}
        />
        <StatTile
          label="信用周期"
          value={data.creditCyclePhase.phaseLabel}
        />
        <StatTile
          label="周期月数"
          value={`${data.creditCyclePhase.monthsInPhase}`}
        />
      </div>

      <div className={`p-4 rounded-lg border ${signalClass} bg-opacity-10`} style={{ backgroundColor: 'rgb(var(--c-surface-2))' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className={`font-semibold ${signalClass}`}>{data.currentSnapshot.signal.replace('_', ' ').toUpperCase()}</div>
            <div className="text-sm mt-1" style={{ color: 'rgb(var(--c-text-2))' }}>{data.currentSnapshot.signalDesc}</div>
          </div>
          <div className={`font-semibold ${directionClass}`}>{data.signal.direction.replace('_', ' ').toUpperCase()}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>信用利差走势</h3>
          <ChartBox option={spreadOption} height={300} />
        </div>
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>信用-利率压力指数</h3>
          <ChartBox option={stressOption} height={300} />
        </div>
      </div>

      <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>不同压力水平的前瞻收益</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
                <th className="text-left py-2 px-3" style={{ color: 'rgb(var(--c-text-2))' }}>压力水平</th>
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
                  <td className="py-2 px-3" style={{ color: 'rgb(var(--c-text))' }}>{row.stressLevel}</td>
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

      <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>分析依据</h3>
        <div className="space-y-2">
          {data.signal.evidence.map((e, i) => (
            <div key={i} className="text-sm py-2" style={{ borderBottom: '1px solid rgb(var(--c-border))', color: 'rgb(var(--c-text))' }}>
              {e}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

import { useMemo, useState, useEffect } from 'react'
import type { EChartsOption } from 'echarts'
import { ChartBox } from '../charts/ChartBox'
import { StatTile } from '../ui/StatTile'
import { DataFreshness } from '../ui/DataFreshness'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { EmptyState, ErrorState } from '../ui/States'
import { PageHeader } from '../ui/PageHeader'

interface InflationAnchorData {
  breakevenHistory: {
    dates: string[]
    series: { name: string; tenor: string; data: (number | null)[] }[]
  }
  anchorDeviation: {
    currentDeviation: number | null
    currentDeviation10y: number | null
    zScore: number | null
    percentile1y: number | null
    percentile5y: number | null
    anchorStatus: string
    anchorDesc: string
  }
  termStructure: {
    current: { tenor: string; value: number }[]
    slope5y10y: number | null
    slope5y20y: number | null
    slope10y20y: number | null
  }
  currentSnapshot: {
    breakeven5y: number | null
    breakeven10y: number | null
    breakeven20y: number | null
    realYield5y: number | null
    realYield10y: number | null
    realYield20y: number | null
    fedTargetPct: number
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

const ANCHOR_STATUS_COLORS: Record<string, string> = {
  anchored: 'text-green-400',
  drifting: 'text-yellow-400',
  deanchored: 'text-red-400',
}

const DIRECTION_COLORS: Record<string, string> = {
  dovish: 'text-green-400',
  hawkish: 'text-red-400',
  neutral: 'text-yellow-400',
}

export default function InflationAnchorDashboard() {
  const [data, setData] = useState<InflationAnchorData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/analysis/inflation-anchor.json')
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

  const breakevenOption = useMemo<EChartsOption | null>(() => {
    if (!data?.breakevenHistory) return null
    const { dates, series } = data.breakevenHistory
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: series.map(s => s.name) },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value', name: '盈亏平衡通胀 (%)' },
      series: series.map(s => ({
        name: s.name,
        type: 'line',
        data: s.data,
        smooth: true,
      })),
      dataZoom: [{ type: 'slider', start: 70, end: 100 }],
    }
  }, [data])

  const deviationOption = useMemo<EChartsOption | null>(() => {
    if (!data?.breakevenHistory) return null
    const { dates } = data.breakevenHistory
    const deviationData = data.breakevenHistory.series.find(s => s.tenor === '10Y')?.data.map((v, i) => {
      if (v == null) return null
      return +(v - 2.0).toFixed(2)
    }) ?? []
    return {
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value', name: '偏差 (%)' },
      series: [
        { name: '偏差', type: 'line', data: deviationData, smooth: true },
        { name: '零线', type: 'line', data: dates.map(() => 0), lineStyle: { type: 'dashed', color: '#666' } },
      ],
      dataZoom: [{ type: 'slider', start: 70, end: 100 }],
    }
  }, [data])

  if (isLoading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  const anchorClass = ANCHOR_STATUS_COLORS[data.anchorDeviation.anchorStatus] || 'text-yellow-400'
  const directionClass = DIRECTION_COLORS[data.signal.direction] || 'text-yellow-400'

  return (
    <div className="space-y-6">
      <PageHeader
        title="通胀预期锚定分析"
        subtitle="TIPS隐含通胀率 vs 联储2%目标的偏离分析"
        actions={<DataFreshness />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="5Y 盈亏平衡"
          value={data.currentSnapshot.breakeven5y != null ? `${data.currentSnapshot.breakeven5y.toFixed(2)}%` : '--'}
        />
        <StatTile
          label="10Y 盈亏平衡"
          value={data.currentSnapshot.breakeven10y != null ? `${data.currentSnapshot.breakeven10y.toFixed(2)}%` : '--'}
        />
        <StatTile
          label="20Y 盈亏平衡"
          value={data.currentSnapshot.breakeven20y != null ? `${data.currentSnapshot.breakeven20y.toFixed(2)}%` : '--'}
        />
        <StatTile
          label="联储目标"
          value={`${data.currentSnapshot.fedTargetPct}%`}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="5Y 实际利率"
          value={data.currentSnapshot.realYield5y != null ? `${data.currentSnapshot.realYield5y.toFixed(2)}%` : '--'}
        />
        <StatTile
          label="10Y 实际利率"
          value={data.currentSnapshot.realYield10y != null ? `${data.currentSnapshot.realYield10y.toFixed(2)}%` : '--'}
        />
        <StatTile
          label="20Y 实际利率"
          value={data.currentSnapshot.realYield20y != null ? `${data.currentSnapshot.realYield20y.toFixed(2)}%` : '--'}
        />
        <StatTile
          label="偏差 Z-Score"
          value={data.anchorDeviation.zScore != null ? data.anchorDeviation.zScore.toFixed(2) : '--'}
          className={data.anchorDeviation.zScore != null && Math.abs(data.anchorDeviation.zScore) > 1 ? 'text-yellow-400' : ''}
        />
      </div>

      <div className={`p-4 rounded-lg border ${anchorClass} bg-opacity-10`} style={{ backgroundColor: 'rgb(var(--c-surface-2))' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className={`font-semibold ${anchorClass}`}>{data.anchorDeviation.anchorStatus.toUpperCase()}</div>
            <div className="text-sm mt-1" style={{ color: 'rgb(var(--c-text-2))' }}>{data.anchorDeviation.anchorDesc}</div>
          </div>
          <div className={`font-semibold ${directionClass}`}>{data.signal.direction.toUpperCase()}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>盈亏平衡通胀率曲线</h3>
          <ChartBox option={breakevenOption} height={300} />
        </div>
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>10Y 偏差走势</h3>
          <ChartBox option={deviationOption} height={300} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>期限结构斜率</h3>
          <div className="space-y-3">
            <div className="flex justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span style={{ color: 'rgb(var(--c-text-2))' }}>5Y-10Y 斜率</span>
              <span style={{ color: 'rgb(var(--c-text))' }}>{data.termStructure.slope5y10y != null ? `${data.termStructure.slope5y10y.toFixed(2)}%` : '--'}</span>
            </div>
            <div className="flex justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span style={{ color: 'rgb(var(--c-text-2))' }}>5Y-20Y 斜率</span>
              <span style={{ color: 'rgb(var(--c-text))' }}>{data.termStructure.slope5y20y != null ? `${data.termStructure.slope5y20y.toFixed(2)}%` : '--'}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'rgb(var(--c-text-2))' }}>10Y-20Y 斜率</span>
              <span style={{ color: 'rgb(var(--c-text))' }}>{data.termStructure.slope10y20y != null ? `${data.termStructure.slope10y20y.toFixed(2)}%` : '--'}</span>
            </div>
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
            {data.signal.counterEvidence.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-semibold mb-2" style={{ color: 'rgb(var(--c-text-3))' }}>反向证据</div>
                {data.signal.counterEvidence.map((e, i) => (
                  <div key={i} className="text-sm py-2 text-yellow-400" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
                    {e}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

import { useMemo, useState, useEffect } from 'react'
import type { EChartsOption } from 'echarts'
import { ChartBox } from '../charts/ChartBox'
import { StatTile } from '../ui/StatTile'
import { DataFreshness } from '../ui/DataFreshness'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { EmptyState, ErrorState } from '../ui/States'
import { PageHeader } from '../ui/PageHeader'

interface CreditStressData {
  spreadHistory: { dates: string[]; series: { name: string; data: (number | null)[] }[] }
  combinedStress: {
    creditStress: number | null
    rateStress: number | null
    combinedIndex: number | null
    status: string
    statusDesc: string
  }
  currentSpread: { bbbSpread: number | null; hyOas: number | null; aaaSpread: number | null; spreadZScore: number | null }
  rateCreditCorr: number | null
  signal: { direction: string; strength: string; confidence: number; evidence: string[] }
  updatedAt: string
}

const STATUS_COLORS: Record<string, string> = {
  normal: 'text-green-400',
  elevated: 'text-yellow-400',
  high_stress: 'text-red-400',
}

const DIRECTION_COLORS: Record<string, string> = {
  risk_on: 'text-green-400',
  risk_off: 'text-red-400',
  neutral: 'text-yellow-400',
}

export default function CreditStressDashboard() {
  const [data, setData] = useState<CreditStressData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/analysis/credit-stress.json')
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
    const { dates, series } = data.spreadHistory
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: series.map(s => s.name) },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value', name: '利差 / 收益率 (%)' },
      series: series.map(s => ({
        name: s.name,
        type: 'line',
        data: s.data,
        smooth: true,
      })),
      dataZoom: [{ type: 'slider', start: 70, end: 100 }],
    }
  }, [data])

  if (isLoading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  const statusClass = STATUS_COLORS[data.combinedStress.status] || 'text-yellow-400'
  const directionClass = DIRECTION_COLORS[data.signal.direction] || 'text-yellow-400'

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="BBB信用利差"
          value={data.currentSpread.bbbSpread != null ? `${data.currentSpread.bbbSpread.toFixed(2)}%` : '--'}
        />
        <StatTile
          label="HY OAS"
          value={data.currentSpread.hyOas != null ? `${data.currentSpread.hyOas.toFixed(2)}%` : '--'}
        />
        <StatTile
          label="AAA利差"
          value={data.currentSpread.aaaSpread != null ? `${data.currentSpread.aaaSpread.toFixed(2)}%` : '--'}
        />
        <StatTile
          label="利差Z-Score"
          value={data.currentSpread.spreadZScore != null ? data.currentSpread.spreadZScore.toFixed(2) : '--'}
          className={data.currentSpread.spreadZScore != null && Math.abs(data.currentSpread.spreadZScore) > 1 ? 'text-yellow-400' : ''}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="信用压力指数"
          value={data.combinedStress.creditStress != null ? data.combinedStress.creditStress.toFixed(3) : '--'}
        />
        <StatTile
          label="利率压力指数"
          value={data.combinedStress.rateStress != null ? data.combinedStress.rateStress.toFixed(3) : '--'}
        />
        <StatTile
          label="复合压力指数"
          value={data.combinedStress.combinedIndex != null ? data.combinedStress.combinedIndex.toFixed(3) : '--'}
        />
        <StatTile
          label="信用-利率相关性"
          value={data.rateCreditCorr != null ? data.rateCreditCorr.toFixed(3) : '--'}
        />
      </div>

      <div className={`p-4 rounded-lg border ${statusClass}`} style={{ backgroundColor: 'rgb(var(--c-surface-2))' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className={`font-semibold ${statusClass}`}>{data.combinedStress.status.toUpperCase()}</div>
            <div className="text-sm mt-1" style={{ color: 'rgb(var(--c-text-2))' }}>{data.combinedStress.statusDesc}</div>
          </div>
          <div className={`font-semibold ${directionClass}`}>{data.signal.direction.toUpperCase()}</div>
        </div>
      </div>

      <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>信用利差 vs 国债收益率</h3>
        <ChartBox option={spreadOption} height={350} />
      </div>

      <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>分析依据</h3>
        <div className="space-y-2">
          {data.signal.evidence.map((e, i) => (
            <div key={i} className="text-sm py-2" style={{ borderBottom: '1px solid rgb(var(--c-border))', color: 'rgb(var(--c-text))' }}>
              {e}
            </div>
          ))}
          {data.signal.evidence.length === 0 && (
            <div className="text-sm py-2" style={{ color: 'rgb(var(--c-text-3))' }}>暂无显著信号</div>
          )}
        </div>
      </div>
    </div>
  )
}

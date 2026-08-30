import { useMemo, useState, useEffect } from 'react'
import type { EChartsOption } from 'echarts'
import { ChartBox } from '../charts/ChartBox'
import { StatTile } from '../ui/StatTile'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { EmptyState, ErrorState } from '../ui/States'
import { PageHeader } from '../ui/PageHeader'

interface CrossAssetData {
  correlationMatrix: { dates: string[]; series: { name: string; data: (number | null)[] }[] }
  currentCorrelations: { pair: string; correlation: number; status: string }[]
  regimeDetection: { regime: string; regimeDesc: string; confidence: number }
  diversificationScore: number
  signal: { direction: string; strength: string; confidence: number; evidence: string[] }
  updatedAt: string
}

const REGIME_COLORS: Record<string, string> = {
  normal_correlation: 'text-green-400',
  flight_to_quality: 'text-blue-400',
  contagion: 'text-red-400',
}

const CORR_COLORS: Record<string, string> = {
  positive: 'text-orange-400',
  negative: 'text-blue-400',
  neutral: 'text-yellow-400',
}

export default function CrossAssetDashboard() {
  const [data, setData] = useState<CrossAssetData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/analysis/cross-asset-correlation.json')
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

  const correlationOption = useMemo<EChartsOption | null>(() => {
    if (!data?.correlationMatrix) return null
    const { dates, series } = data.correlationMatrix
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: series.map(s => s.name) },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value', name: '数值' },
      series: series.map(s => ({
        name: s.name,
        type: 'line',
        data: s.data,
        smooth: true,
        lineStyle: { width: 1.5 },
      })),
      dataZoom: [{ type: 'slider', start: 70, end: 100 }],
    }
  }, [data])

  if (isLoading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  const regimeClass = REGIME_COLORS[data.regimeDetection.regime] || 'text-yellow-400'

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatTile
          label="分散化评分"
          value={`${data.diversificationScore}`}
          className={data.diversificationScore > 60 ? 'text-green-400' : data.diversificationScore < 40 ? 'text-red-400' : ''}
        />
        <StatTile
          label="当前体制"
          value={data.regimeDetection.regime}
          className={regimeClass}
        />
        <StatTile
          label="信号方向"
          value={data.signal.direction}
          className={data.signal.direction === 'risk_off' ? 'text-red-400' : 'text-green-400'}
        />
      </div>

      <div className={`p-4 rounded-lg border ${regimeClass}`} style={{ backgroundColor: 'rgb(var(--c-surface-2))' }}>
        <div className="font-semibold">体制检测: {data.regimeDetection.regime}</div>
        <div className="text-sm mt-1" style={{ color: 'rgb(var(--c-text-2))' }}>{data.regimeDetection.regimeDesc}</div>
      </div>

      <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>资产/指标联动</h3>
        <ChartBox option={correlationOption} height={350} />
      </div>

      <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>相关系数矩阵</h3>
        <div className="space-y-2">
          {data.currentCorrelations.map((c, i) => (
            <div key={i} className="flex justify-between py-2" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span style={{ color: 'rgb(var(--c-text))' }}>{c.pair}</span>
              <span className={CORR_COLORS[c.status] || 'text-yellow-400'}>
                {c.correlation.toFixed(3)}
              </span>
            </div>
          ))}
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
          {data.signal.evidence.length === 0 && (
            <div className="text-sm py-2" style={{ color: 'rgb(var(--c-text-3))' }}>暂无显著信号</div>
          )}
        </div>
      </div>
    </div>
  )
}

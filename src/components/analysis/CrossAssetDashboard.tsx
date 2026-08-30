import { useState, useEffect } from 'react'
import { StatTile } from '../ui/StatTile'
import { DataFreshness } from '../ui/DataFreshness'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { EmptyState, ErrorState } from '../ui/States'
import { PageHeader } from '../ui/PageHeader'

interface CrossAssetData {
  correlationMatrix: {
    current: {
      assets: string[]
      matrix: number[][]
    }
  }
  contagionAnalysis: {
    currentContagionIndex: number | null
    alerts: { date: string; pair: string; corr: number; severity: string }[]
  }
  diversificationMetrics: {
    currentDiversification: number | null
    minCorrelation: { pair: string; value: number } | null
    maxCorrelation: { pair: string; value: number } | null
    avgCorrelation: number | null
  }
  currentSnapshot: {
    goldDxy: number | null
    goldSp500: number | null
    goldDgs10: number | null
    sp500Dgs10: number | null
    sp500Dxy: number | null
    dgs10Dxy: number | null
    avgCorrelation: number | null
    diversificationScore: number | null
  }
  signal: {
    regimeAlignment: string
    alignmentDesc: string
    recommendedAction: string
    evidence: string[]
  }
  updatedAt: string
}

const ALIGNMENT_COLORS: Record<string, string> = {
  diversified: 'text-green-400',
  correlated: 'text-yellow-400',
  crisis: 'text-red-400',
}

function getCorrColor(value: number): string {
  if (value < -0.3) return 'text-blue-400'
  if (value < 0) return 'text-cyan-400'
  if (value < 0.3) return 'text-yellow-400'
  return 'text-orange-400'
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

  if (isLoading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  const alignmentClass = ALIGNMENT_COLORS[data.signal.regimeAlignment] || 'text-yellow-400'

  return (
    <div className="space-y-6">
      <PageHeader
        title="跨资产联动矩阵"
        subtitle="动态相关性变化检测与分散化分析"
        actions={<DataFreshness />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="分散化得分"
          value={data.currentSnapshot.diversificationScore != null ? `${data.currentSnapshot.diversificationScore}` : '--'}
          className={data.currentSnapshot.diversificationScore != null && data.currentSnapshot.diversificationScore > 70 ? 'text-green-400' : 'text-yellow-400'}
        />
        <StatTile
          label="传染指数"
          value={data.contagionAnalysis.currentContagionIndex != null ? `${data.contagionAnalysis.currentContagionIndex.toFixed(3)}` : '--'}
          className={data.contagionAnalysis.currentContagionIndex != null && data.contagionAnalysis.currentContagionIndex > 0.7 ? 'text-red-400' : ''}
        />
        <StatTile
          label="平均相关性"
          value={data.currentSnapshot.avgCorrelation != null ? `${data.currentSnapshot.avgCorrelation.toFixed(4)}` : '--'}
        />
        <StatTile
          label="相关性模式"
          value={data.signal.regimeAlignment.replace('_', ' ').toUpperCase()}
          className={alignmentClass}
        />
      </div>

      <div className={`p-4 rounded-lg border ${alignmentClass} bg-opacity-10`} style={{ backgroundColor: 'rgb(var(--c-surface-2))' }}>
        <div className="font-semibold mb-2" style={{ color: 'rgb(var(--c-text))' }}>{data.signal.alignmentDesc}</div>
        <div className="text-sm" style={{ color: 'rgb(var(--c-text-2))' }}>{data.signal.recommendedAction}</div>
      </div>

      <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>相关性矩阵</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
                <th className="text-left py-2 px-3" style={{ color: 'rgb(var(--c-text-2))' }}></th>
                {data.correlationMatrix.current.assets.map(a => (
                  <th key={a} className="text-center py-2 px-3" style={{ color: 'rgb(var(--c-text-2))' }}>{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.correlationMatrix.current.assets.map((rowAsset, i) => (
                <tr key={rowAsset} style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
                  <td className="py-2 px-3 font-medium" style={{ color: 'rgb(var(--c-text))' }}>{rowAsset}</td>
                  {data.correlationMatrix.current.matrix[i].map((val, j) => (
                    <td key={j} className={`text-center py-2 px-3 ${i === j ? 'text-gray-500' : getCorrColor(val)}`}>
                      {val.toFixed(3)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>关键资产对</h3>
          <div className="space-y-3">
            <div className="flex justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span style={{ color: 'rgb(var(--c-text-2))' }}>黄金-美元</span>
              <span className={getCorrColor(data.currentSnapshot.goldDxy ?? 0)}>
                {data.currentSnapshot.goldDxy != null ? data.currentSnapshot.goldDxy.toFixed(4) : '--'}
              </span>
            </div>
            <div className="flex justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span style={{ color: 'rgb(var(--c-text-2))' }}>黄金-标普</span>
              <span className={getCorrColor(data.currentSnapshot.goldSp500 ?? 0)}>
                {data.currentSnapshot.goldSp500 != null ? data.currentSnapshot.goldSp500.toFixed(4) : '--'}
              </span>
            </div>
            <div className="flex justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span style={{ color: 'rgb(var(--c-text-2))' }}>黄金-10Y国债</span>
              <span className={getCorrColor(data.currentSnapshot.goldDgs10 ?? 0)}>
                {data.currentSnapshot.goldDgs10 != null ? data.currentSnapshot.goldDgs10.toFixed(4) : '--'}
              </span>
            </div>
            <div className="flex justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span style={{ color: 'rgb(var(--c-text-2))' }}>标普-美元</span>
              <span className={getCorrColor(data.currentSnapshot.sp500Dxy ?? 0)}>
                {data.currentSnapshot.sp500Dxy != null ? data.currentSnapshot.sp500Dxy.toFixed(4) : '--'}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'rgb(var(--c-text-2))' }}>标普-10Y国债</span>
              <span className={getCorrColor(data.currentSnapshot.sp500Dgs10 ?? 0)}>
                {data.currentSnapshot.sp500Dgs10 != null ? data.currentSnapshot.sp500Dgs10.toFixed(4) : '--'}
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>分散化指标</h3>
          <div className="space-y-3">
            <div className="flex justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span style={{ color: 'rgb(var(--c-text-2))' }}>最高相关性</span>
              <span style={{ color: 'rgb(var(--c-text))' }}>
                {data.diversificationMetrics.maxCorrelation ? `${data.diversificationMetrics.maxCorrelation.pair} (${data.diversificationMetrics.maxCorrelation.value.toFixed(4)})` : '--'}
              </span>
            </div>
            <div className="flex justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span style={{ color: 'rgb(var(--c-text-2))' }}>最低相关性</span>
              <span style={{ color: 'rgb(var(--c-text))' }}>
                {data.diversificationMetrics.minCorrelation ? `${data.diversificationMetrics.minCorrelation.pair} (${data.diversificationMetrics.minCorrelation.value.toFixed(4)})` : '--'}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'rgb(var(--c-text-2))' }}>平均相关性</span>
              <span style={{ color: 'rgb(var(--c-text))' }}>
                {data.diversificationMetrics.avgCorrelation != null ? data.diversificationMetrics.avgCorrelation.toFixed(4) : '--'}
              </span>
            </div>
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
        </div>
      </div>

      {data.contagionAnalysis.alerts.length > 0 && (
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>传染警报</h3>
          <div className="space-y-2">
            {data.contagionAnalysis.alerts.map((alert, i) => (
              <div key={i} className="flex justify-between text-sm py-2" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
                <span style={{ color: 'rgb(var(--c-text-2))' }}>{alert.date}</span>
                <span style={{ color: 'rgb(var(--c-text))' }}>{alert.pair}</span>
                <span className={alert.severity === 'high' ? 'text-red-400' : 'text-yellow-400'}>
                  {alert.corr.toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

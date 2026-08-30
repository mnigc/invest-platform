import { useMemo, useState, useEffect } from 'react'
import type { EChartsOption } from 'echarts'
import { ChartBox } from '../charts/ChartBox'
import { StatTile } from '../ui/StatTile'
import { DataFreshness } from '../ui/DataFreshness'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { EmptyState, ErrorState } from '../ui/States'
import { PageHeader } from '../ui/PageHeader'

interface MacroConsensusData {
  signals: { id: string; name: string; category: string; current: number | null; zScore: number | null; direction: string; weight: number }[]
  consensusScore: {
    overall: number | null
    growth: number | null
    inflation: number | null
    risk: number | null
    liquidity: number | null
    direction: string
    strength: string
    confidence: number
  }
  historicalConsensus: {
    dates: string[]
    overall: (number | null)[]
    liquidity: (number | null)[]
    inflation: (number | null)[]
    risk: (number | null)[]
  }
  signal: {
    direction: string
    strength: string
    confidence: number
    evidence: string[]
  }
  updatedAt: string
}

const DIRECTION_COLORS: Record<string, string> = {
  bullish: 'text-green-400',
  bearish: 'text-red-400',
  neutral: 'text-yellow-400',
}

const CATEGORY_COLORS: Record<string, string> = {
  growth: 'text-blue-400',
  inflation: 'text-orange-400',
  risk: 'text-red-400',
  liquidity: 'text-purple-400',
}

export default function MacroConsensusDashboard() {
  const [data, setData] = useState<MacroConsensusData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/analysis/macro-consensus.json')
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

  const historicalOption = useMemo<EChartsOption | null>(() => {
    if (!data?.historicalConsensus) return null
    const { dates, overall, liquidity, inflation, risk } = data.historicalConsensus
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['综合', '流动性', '通胀', '风险'] },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value', name: '得分' },
      series: [
        { name: '综合', type: 'line', data: overall, smooth: true, lineStyle: { width: 2 } },
        { name: '流动性', type: 'line', data: liquidity, smooth: true },
        { name: '通胀', type: 'line', data: inflation, smooth: true },
        { name: '风险', type: 'line', data: risk, smooth: true },
      ],
      dataZoom: [{ type: 'slider', start: 70, end: 100 }],
    }
  }, [data])

  if (isLoading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState title="暂无数据" />

  const directionClass = DIRECTION_COLORS[data.signal.direction] || 'text-yellow-400'

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="综合评分"
          value={data.consensusScore.overall != null ? `${data.consensusScore.overall}` : '--'}
          className={directionClass}
        />
        <StatTile
          label="增长维度"
          value={data.consensusScore.growth != null ? `${data.consensusScore.growth}` : '--'}
          className={CATEGORY_COLORS.growth}
        />
        <StatTile
          label="通胀维度"
          value={data.consensusScore.inflation != null ? `${data.consensusScore.inflation}` : '--'}
          className={CATEGORY_COLORS.inflation}
        />
        <StatTile
          label="风险维度"
          value={data.consensusScore.risk != null ? `${data.consensusScore.risk}` : '--'}
          className={CATEGORY_COLORS.risk}
        />
      </div>

      <div className={`p-4 rounded-lg border ${directionClass}`} style={{ backgroundColor: 'rgb(var(--c-surface-2))' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className={`font-semibold ${directionClass}`}>{data.consensusScore.direction.toUpperCase()}</div>
            <div className="text-sm mt-1" style={{ color: 'rgb(var(--c-text-2))' }}>信号强度: {data.consensusScore.strength} | 置信度: {data.consensusScore.confidence}%</div>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>历史综合评分走势</h3>
        <ChartBox option={historicalOption} height={350} />
      </div>

      <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>信号明细</h3>
        <div className="space-y-2">
          {data.signals.map((s, i) => (
            <div key={i} className="flex justify-between items-center py-2" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <div>
                <span className={CATEGORY_COLORS[s.category] || ''} style={{ color: 'rgb(var(--c-text))' }}>{s.name}</span>
                <span className="text-xs ml-2" style={{ color: 'rgb(var(--c-text-3))' }}>{s.category}</span>
              </div>
              <div className="flex items-center gap-3">
                <span style={{ color: 'rgb(var(--c-text))' }}>{s.current != null ? s.current.toFixed(2) : '--'}</span>
                <span className={s.zScore != null && s.zScore > 1 ? 'text-red-400' : s.zScore != null && s.zScore < -1 ? 'text-blue-400' : 'text-yellow-400'}>
                  Z: {s.zScore != null ? s.zScore.toFixed(2) : '--'}
                </span>
                <span className="text-xs" style={{ color: 'rgb(var(--c-text-3))' }}>权重 {(s.weight * 100).toFixed(0)}%</span>
              </div>
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

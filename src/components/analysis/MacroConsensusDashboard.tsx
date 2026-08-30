import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { ChartBox } from '../charts/ChartBox'
import { StatTile } from '../ui/StatTile'
import { DataFreshness } from '../ui/DataFreshness'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { EmptyState, ErrorState } from '../ui/States'
import { PageHeader } from '../ui/PageHeader'

interface MacroConsensusData {
  signals: { id: string; name: string; category: string; value: number | null; normalizedValue: number | null; direction: string; weight: number; confidence: number }[]
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
  divergenceAnalysis: {
    currentDivergence: number | null
    divergenceLevel: string
    divergenceDesc: string
    divergentSignals: { signal1: string; signal2: string; divergence: number }[]
  }
  regimeAlignment: {
    currentRegime: string
    regimeLabel: string
    alignmentScore: number
    alignmentDesc: string
    misalignedSignals: string[]
  }
  historicalConsensus: {
    dates: string[]
    overall: (number | null)[]
    growth: (number | null)[]
    inflation: (number | null)[]
    risk: (number | null)[]
    liquidity: (number | null)[]
  }
  currentSnapshot: {
    overallScore: number | null
    growthScore: number | null
    inflationScore: number | null
    riskScore: number | null
    liquidityScore: number | null
    signalCount: number
    bullishCount: number
    bearishCount: number
    neutralCount: number
  }
  signal: {
    direction: string
    strength: string
    confidence: number
    evidence: string[]
    counterEvidence: string[]
    recommendedAction: string
  }
  updatedAt: string
}

const DIRECTION_COLORS: Record<string, string> = {
  conviction_buy: 'text-green-500',
  buy: 'text-green-400',
  neutral: 'text-yellow-400',
  sell: 'text-red-400',
  conviction_sell: 'text-red-500',
}

const SIGNAL_DIRECTION_COLORS: Record<string, string> = {
  positive: 'text-green-400',
  negative: 'text-red-400',
  neutral: 'text-gray-400',
}

const CATEGORY_COLORS: Record<string, string> = {
  growth: 'text-blue-400',
  inflation: 'text-orange-400',
  risk: 'text-red-400',
  liquidity: 'text-purple-400',
}

function getBarWidth(value: number): string {
  const width = Math.abs(value) * 100
  return `${Math.min(100, width)}%`
}

export default function MacroConsensusDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['macroConsensus'],
    queryFn: async () => {
      const res = await fetch('/api/v1/analysis/macro-consensus.json')
      if (!res.ok) throw new Error('Network error')
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      return json.data as MacroConsensusData
    },
    refetchInterval: 600000,
    staleTime: 300000,
  })

  const historicalOption = useMemo<EChartsOption | null>(() => {
    if (!data?.historicalConsensus) return null
    const { dates, overall, growth, inflation, risk, liquidity } = data.historicalConsensus
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['综合', '增长', '通胀', '风险', '流动性'] },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value', name: '得分' },
      series: [
        { name: '综合', type: 'line', data: overall, smooth: true, lineStyle: { width: 2 } },
        { name: '增长', type: 'line', data: growth, smooth: true },
        { name: '通胀', type: 'line', data: inflation, smooth: true },
        { name: '风险', type: 'line', data: risk, smooth: true },
        { name: '流动性', type: 'line', data: liquidity, smooth: true },
      ],
      dataZoom: [{ type: 'slider', start: 70, end: 100 }],
    }
  }, [data])

  if (isLoading) return <LoadingSkeleton />
  if (error) return <ErrorState message="加载失败" />
  if (!data) return <EmptyState title="暂无数据" />

  const directionClass = DIRECTION_COLORS[data.signal.direction] || 'text-yellow-400'

  return (
    <div className="space-y-6">
      <PageHeader
        title="宏观信号一致性评分"
        subtitle="多维度信号的一致性/分歧度分析"
        actions={<DataFreshness />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="综合得分"
          value={data.currentSnapshot.overallScore != null ? `${data.currentSnapshot.overallScore.toFixed(3)}` : '--'}
          className={directionClass}
        />
        <StatTile
          label="分歧度"
          value={data.divergenceAnalysis.currentDivergence != null ? `${data.divergenceAnalysis.currentDivergence.toFixed(3)}` : '--'}
        />
        <StatTile
          label="看涨信号"
          value={`${data.currentSnapshot.bullishCount}`}
          className="text-green-400"
        />
        <StatTile
          label="看跌信号"
          value={`${data.currentSnapshot.bearishCount}`}
          className="text-red-400"
        />
      </div>

      <div className={`p-4 rounded-lg border ${directionClass} bg-opacity-10`} style={{ backgroundColor: 'rgb(var(--c-surface-2))' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className={`font-semibold ${directionClass}`}>{data.signal.direction.replace('_', ' ').toUpperCase()}</div>
            <div className="text-sm mt-1" style={{ color: 'rgb(var(--c-text-2))' }}>{data.signal.recommendedAction}</div>
          </div>
          <div className="text-right">
            <div className="text-sm" style={{ color: 'rgb(var(--c-text-2))' }}>置信度</div>
            <div className={`font-semibold ${directionClass}`}>{data.signal.confidence}%</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>维度得分</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span className="text-sm" style={{ color: 'rgb(var(--c-text-2))' }}>增长</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${data.currentSnapshot.growthScore != null && data.currentSnapshot.growthScore > 0 ? 'bg-green-500' : 'bg-red-500'}`}
                    style={{ width: getBarWidth(data.currentSnapshot.growthScore ?? 0), marginLeft: data.currentSnapshot.growthScore != null && data.currentSnapshot.growthScore < 0 ? 'auto' : 0 }}
                  />
                </div>
                <span className={`text-sm font-mono ${data.currentSnapshot.growthScore != null && data.currentSnapshot.growthScore > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {data.currentSnapshot.growthScore != null ? data.currentSnapshot.growthScore.toFixed(3) : '--'}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span className="text-sm" style={{ color: 'rgb(var(--c-text-2))' }}>通胀</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${data.currentSnapshot.inflationScore != null && data.currentSnapshot.inflationScore > 0 ? 'bg-green-500' : 'bg-red-500'}`}
                    style={{ width: getBarWidth(data.currentSnapshot.inflationScore ?? 0), marginLeft: data.currentSnapshot.inflationScore != null && data.currentSnapshot.inflationScore < 0 ? 'auto' : 0 }}
                  />
                </div>
                <span className={`text-sm font-mono ${data.currentSnapshot.inflationScore != null && data.currentSnapshot.inflationScore > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {data.currentSnapshot.inflationScore != null ? data.currentSnapshot.inflationScore.toFixed(3) : '--'}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span className="text-sm" style={{ color: 'rgb(var(--c-text-2))' }}>风险</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${data.currentSnapshot.riskScore != null && data.currentSnapshot.riskScore > 0 ? 'bg-green-500' : 'bg-red-500'}`}
                    style={{ width: getBarWidth(data.currentSnapshot.riskScore ?? 0), marginLeft: data.currentSnapshot.riskScore != null && data.currentSnapshot.riskScore < 0 ? 'auto' : 0 }}
                  />
                </div>
                <span className={`text-sm font-mono ${data.currentSnapshot.riskScore != null && data.currentSnapshot.riskScore > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {data.currentSnapshot.riskScore != null ? data.currentSnapshot.riskScore.toFixed(3) : '--'}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: 'rgb(var(--c-text-2))' }}>流动性</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${data.currentSnapshot.liquidityScore != null && data.currentSnapshot.liquidityScore > 0 ? 'bg-green-500' : 'bg-red-500'}`}
                    style={{ width: getBarWidth(data.currentSnapshot.liquidityScore ?? 0), marginLeft: data.currentSnapshot.liquidityScore != null && data.currentSnapshot.liquidityScore < 0 ? 'auto' : 0 }}
                  />
                </div>
                <span className={`text-sm font-mono ${data.currentSnapshot.liquidityScore != null && data.currentSnapshot.liquidityScore > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {data.currentSnapshot.liquidityScore != null ? data.currentSnapshot.liquidityScore.toFixed(3) : '--'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>宏观体制对齐</h3>
          <div className="space-y-3">
            <div className="flex justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span style={{ color: 'rgb(var(--c-text-2))' }}>当前体制</span>
              <span style={{ color: 'rgb(var(--c-text))' }}>{data.regimeAlignment.regimeLabel}</span>
            </div>
            <div className="flex justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span style={{ color: 'rgb(var(--c-text-2))' }}>对齐状态</span>
              <span style={{ color: 'rgb(var(--c-text))' }}>{data.regimeAlignment.alignmentDesc}</span>
            </div>
            <div className="flex justify-between" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
              <span style={{ color: 'rgb(var(--c-text-2))' }}>分歧水平</span>
              <span style={{ color: 'rgb(var(--c-text))' }}>{data.divergenceAnalysis.divergenceLevel}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>历史一致性走势</h3>
          <ChartBox option={historicalOption} height={300} />
        </div>

        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>信号详情</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {data.signals.map((signal) => (
              <div key={signal.id} className="flex items-center justify-between text-sm py-2" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${CATEGORY_COLORS[signal.category] || ''}`}>[{signal.category}]</span>
                  <span style={{ color: 'rgb(var(--c-text))' }}>{signal.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span style={{ color: 'rgb(var(--c-text-2))' }}>{signal.value != null ? signal.value.toFixed(2) : '--'}</span>
                  <span className={`font-mono ${SIGNAL_DIRECTION_COLORS[signal.direction] || ''}`}>
                    {signal.normalizedValue != null ? signal.normalizedValue.toFixed(2) : '--'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>支持依据</h3>
          <div className="space-y-2">
            {data.signal.evidence.map((e, i) => (
              <div key={i} className="text-sm py-2" style={{ borderBottom: '1px solid rgb(var(--c-border))', color: 'rgb(var(--c-text))' }}>
                {e}
              </div>
            ))}
          </div>
        </div>

        {data.signal.counterEvidence.length > 0 && (
          <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>反向证据</h3>
            <div className="space-y-2">
              {data.signal.counterEvidence.map((e, i) => (
                <div key={i} className="text-sm py-2 text-yellow-400" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
                  {e}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {data.divergenceAnalysis.divergentSignals.length > 0 && (
        <div className="p-4 rounded-lg border" style={{ backgroundColor: 'rgb(var(--c-surface))', borderColor: 'rgb(var(--c-border))' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--c-text))' }}>分歧信号对</h3>
          <div className="space-y-2">
            {data.divergenceAnalysis.divergentSignals.map((d, i) => (
              <div key={i} className="flex justify-between text-sm py-2" style={{ borderBottom: '1px solid rgb(var(--c-border))' }}>
                <span style={{ color: 'rgb(var(--c-text))' }}>{d.signal1}</span>
                <span style={{ color: 'rgb(var(--c-text-2))' }}>vs</span>
                <span style={{ color: 'rgb(var(--c-text))' }}>{d.signal2}</span>
                <span className="text-yellow-400">{d.divergence.toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

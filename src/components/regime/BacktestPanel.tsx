import { useEffect, useState } from 'react'
import { fetchApi } from '../../lib/api'
import { MacroCard } from '../ui/MacroCard'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { THEME } from '../ui/theme'
import type { BacktestResponse, BacktestSummary } from '@invest/core'

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

function colorClass(v: number): string {
  return v > 0 ? '#089981' : v < 0 ? '#EF4444' : THEME.textMuted
}

function SummaryRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 12px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
      <div style={{ fontSize: '10px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: THEME.fontDisplay, color: THEME.textPrimary }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: THEME.textSecondary, marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

function RegimeTable({ summaries }: { summaries: BacktestSummary[] }) {
  const cols = [
    { key: 'label', label: '制式' },
    { key: 'count', label: '次数' },
    { key: 'avgConfidence', label: '置信度' },
    { key: 'avgReturn1m', label: '1月' },
    { key: 'winRate1m', label: '胜率1m' },
    { key: 'avgReturn3m', label: '3月' },
    { key: 'winRate3m', label: '胜率3m' },
    { key: 'avgReturn6m', label: '6月' },
    { key: 'winRate6m', label: '胜率6m' },
    { key: 'avgReturn12m', label: '12月' },
    { key: 'winRate12m', label: '胜率12m' },
  ] as const

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontFamily: THEME.fontMono }}>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.key} style={{
                padding: '6px 8px', textAlign: 'right', color: THEME.textMuted,
                borderBottom: `1px solid ${THEME.borderColor}`, fontWeight: 500,
                whiteSpace: 'nowrap',
              }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summaries.map(s => (
            <tr key={s.regime}>
              <td style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: THEME.textPrimary, whiteSpace: 'nowrap' }}>{s.label}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: THEME.textSecondary }}>{s.count}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: THEME.textSecondary }}>{s.avgConfidence.toFixed(0)}%</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: colorClass(s.avgReturn1m) }}>{pct(s.avgReturn1m)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: colorClass(s.winRate1m - 0.5) }}>{pct(s.winRate1m)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: colorClass(s.avgReturn3m) }}>{pct(s.avgReturn3m)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: colorClass(s.winRate3m - 0.5) }}>{pct(s.winRate3m)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: colorClass(s.avgReturn6m) }}>{pct(s.avgReturn6m)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: colorClass(s.winRate6m - 0.5) }}>{pct(s.winRate6m)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: colorClass(s.avgReturn12m) }}>{pct(s.avgReturn12m)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: colorClass(s.winRate12m - 0.5) }}>{pct(s.winRate12m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function BacktestPanel() {
  const [data, setData] = useState<BacktestResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const end = new Date().toISOString().slice(0, 10)
    fetchApi<BacktestResponse>(`/regime/backtest?startDate=2010-01-01&endDate=${end}`)
      .then(r => { if (!cancelled) setData(r); setLoading(false) })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading || !data) return <LoadingSkeleton type="card" rows={6} />

  const { overall, summaries } = data

  return (
    <MacroCard title="市场制式回测" badge={`${overall.totalSnapshots} 样本`}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '20px' }}>
        <SummaryRow label="区间" value={`${overall.startDate}~${overall.endDate}`} />
        <SummaryRow label="平均 1月" value={pct(overall.avgReturn1m)} />
        <SummaryRow label="平均 3月" value={pct(overall.avgReturn3m)} />
        <SummaryRow label="平均 12月" value={pct(overall.avgReturn12m)} />
      </div>

      {summaries.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            各制式表现
          </div>
          <RegimeTable summaries={summaries} />
        </div>
      )}

      {summaries.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', color: THEME.textMuted, fontSize: '13px' }}>
          暂无回测数据 — 请先同步 SP500 价格数据和宏观指标
        </div>
      )}
    </MacroCard>
  )
}

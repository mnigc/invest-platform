import { MacroCard } from '../ui/MacroCard'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { useRegimeBacktest } from '../../hooks/useRegimeBacktest'
import type { BacktestSummary } from '../../lib/core'

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

function SummaryRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: '8px', border: `1px solid var(--border-light)` }}>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

function RegimeTable({ summaries }: { summaries: BacktestSummary[] }) {
  function colorClass(v: number): string {
    return v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text-muted)'
  }
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
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.key} style={{
                padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)',
                borderBottom: `1px solid var(--border-color)`, fontWeight: 500,
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
              <td style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{s.label}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{s.count}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{s.avgConfidence.toFixed(0)}%</td>
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
  const { data, loading } = useRegimeBacktest()

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
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            各制式表现
          </div>
          <RegimeTable summaries={summaries} />
        </div>
      )}

      {summaries.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          暂无回测数据 — 请先同步 SP500 价格数据和宏观指标
        </div>
      )}
    </MacroCard>
  )
}

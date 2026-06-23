import { useAnomalies } from '../../hooks/useAnomalies'
import { MacroCard } from '../ui/MacroCard'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import type { AnomalySeverity } from '../../lib/core'

function getSevStyles(): Record<AnomalySeverity, { bg: string; border: string; dot: string; label: string }> {
  return {
    critical: { bg: 'var(--red-bg)', border: 'var(--border-light)', dot: 'var(--red)', label: '严重' },
    high: { bg: 'var(--accent-gold-dim)', border: 'var(--border-light)', dot: 'var(--accent-gold)', label: '高' },
    medium: { bg: 'var(--accent-cyan-dim)', border: 'var(--border-light)', dot: 'var(--accent-cyan)', label: '中' },
    low: { bg: 'var(--bg-card)', border: 'var(--border-light)', dot: 'var(--text-muted)', label: '低' },
  }
}

function AnomalyItem({ anomaly }: { anomaly: { id: string; title: string; description: string; severity: AnomalySeverity; indicator: string; currentValue: string; threshold: string } }) {
  const s = getSevStyles()[anomaly.severity]
  return (
    <div key={anomaly.id} style={{
      display: 'flex', gap: '10px', padding: '10px 12px',
      background: s.bg,
      borderRadius: 8,
    }}>
      <div style={{ width: '4px', background: s.dot, borderRadius: '2px', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{anomaly.title}</span>
          <span style={{
            fontSize: '10px', fontWeight: 600, padding: '1px 6px',
            color: s.dot, fontFamily: 'var(--font-mono)',
          }}>{s.label}</span>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 4px 0', lineHeight: 1.4 }}>{anomaly.description}</p>
        <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          <span>当前: <b style={{ color: 'var(--text-primary)' }}>{anomaly.currentValue}</b></span>
          <span>阈值: {anomaly.threshold}</span>
        </div>
      </div>
    </div>
  )
}

export default function AnomalyAlertPanel() {
  const { data, loading } = useAnomalies()

  if (loading || !data) return <LoadingSkeleton type="card" rows={3} />

  return (
    <MacroCard title="异动警报" badge={`${data.totalCount} 条`}>
      {data.totalCount === 0 && (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>✓</div>
          <div>当前无异常信号</div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {data.anomalies.map(a => <AnomalyItem key={a.id} anomaly={a} />)}
      </div>
      <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--text-muted)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        更新: {data.updatedAt}
      </div>
    </MacroCard>
  )
}

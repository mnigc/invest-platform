import { useAnomalies } from '../../hooks/useAnomalies'
import { MacroCard } from '../ui/MacroCard'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { THEME } from '../ui/theme'
import type { AnomalySeverity } from '../../lib/core'

const SEV_STYLES: Record<AnomalySeverity, { bg: string; border: string; dot: string; label: string }> = {
  critical: { bg: 'rgba(239,68,68,0.1)', border: '#EF4444', dot: '#EF4444', label: '严重' },
  high: { bg: 'rgba(249,115,22,0.1)', border: '#F97316', dot: '#F97316', label: '高' },
  medium: { bg: 'rgba(234,179,8,0.1)', border: '#EAB308', dot: '#EAB308', label: '中' },
  low: { bg: 'rgba(107,114,128,0.1)', border: '#6B7280', dot: '#6B7280', label: '低' },
}

function AnomalyItem({ anomaly }: { anomaly: { id: string; title: string; description: string; severity: AnomalySeverity; indicator: string; currentValue: string; threshold: string } }) {
  const s = SEV_STYLES[anomaly.severity]
  return (
    <div key={anomaly.id} style={{
      display: 'flex', gap: '10px', padding: '10px 12px',
      background: s.bg, borderRadius: '8px', border: `1px solid ${s.border}25`,
    }}>
      <div style={{ width: '4px', background: s.dot, borderRadius: '2px', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.textPrimary }}>{anomaly.title}</span>
          <span style={{
            fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px',
            background: s.dot + '30', color: s.dot, fontFamily: THEME.fontMono,
          }}>{s.label}</span>
        </div>
        <p style={{ fontSize: '12px', color: THEME.textSecondary, margin: '0 0 4px 0', lineHeight: 1.4 }}>{anomaly.description}</p>
        <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: THEME.textMuted, fontFamily: THEME.fontMono }}>
          <span>当前: <b style={{ color: THEME.textPrimary }}>{anomaly.currentValue}</b></span>
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
        <div style={{ padding: '20px', textAlign: 'center', color: THEME.textMuted, fontSize: '13px' }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>✓</div>
          <div>当前无异常信号</div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {data.anomalies.map(a => <AnomalyItem key={a.id} anomaly={a} />)}
      </div>
      <div style={{ marginTop: '8px', fontSize: '10px', color: THEME.textMuted, textAlign: 'right', fontFamily: THEME.fontMono }}>
        更新: {data.updatedAt}
      </div>
    </MacroCard>
  )
}

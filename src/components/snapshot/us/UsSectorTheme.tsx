import { MacroCard } from '../../ui/MacroCard'
import { MacroBadge } from '../../ui/MacroBadge'
import { THEME } from '../../ui/theme'

interface Props {
  data?: Array<{ symbol: string; name: string; change: number }> | null
}

export default function UsSectorTheme({ data }: Props) {
  const hasData = data && data.length > 0

  const top5 = hasData
    ? [...data!].sort((a, b) => b.change - a.change).slice(0, 5)
    : [
        { name: '信息技术', change: 0.85 }, { name: '通信服务', change: 0.72 },
        { name: '非必需消费', change: 0.45 }, { name: '医疗', change: 0.32 }, { name: '工业', change: 0.18 },
      ]

  const btm3 = hasData
    ? [...data!].sort((a, b) => a.change - b.change).slice(0, 3)
    : [
        { name: '能源', change: -0.65 }, { name: '公用事业', change: -0.42 }, { name: '材料', change: -0.28 },
      ]

  const sectionTitle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 600, color: THEME.textMuted,
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px',
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '4px 8px', borderRadius: '4px',
  }

  return (
    <MacroCard title="行业主题" badge="1D">
      <div style={{ marginBottom: '10px' }}>
        <div style={sectionTitle}>领涨行业 TOP 5</div>
        {top5.map(s => (
          <div key={s.name} style={rowStyle}>
            <span style={{ fontSize: '12px', color: THEME.textSecondary }}>{s.name}</span>
            <MacroBadge value={s.change} variant={s.change >= 0 ? 'up' : 'down'} size="sm" />
          </div>
        ))}
      </div>
      <div style={{ height: '1px', background: THEME.borderLight, margin: '8px 0' }} />
      <div>
        <div style={sectionTitle}>领跌行业 BOTTOM 3</div>
        {btm3.map(s => (
          <div key={s.name} style={rowStyle}>
            <span style={{ fontSize: '12px', color: THEME.textSecondary }}>{s.name}</span>
            <MacroBadge value={s.change} variant={s.change >= 0 ? 'up' : 'down'} size="sm" />
          </div>
        ))}
      </div>
    </MacroCard>
  )
}

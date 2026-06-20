import { MacroCard } from '../../ui/MacroCard'
import { THEME } from '../../ui/theme'

interface Props {
  data?: { evidence: string[]; falsify: string[]; action: string[] } | null
}

const block = (color: string, bg: string, border: string): React.CSSProperties => ({
  padding: '10px 12px', borderRadius: '8px', border: `1px solid ${border}`,
  background: bg,
})

const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontSize: '12px',
  fontWeight: 600, letterSpacing: '0.04em',
}

export default function UsSummary({ data }: Props) {
  const hasData = data && data.evidence?.length > 0
  const evidence = hasData ? data!.evidence : [
    'SPX 距历史高点 0.5% 以内，VIX < 14 低位运行',
    '10Y-3M 利差倒挂收窄至 -30bp，信用利差 < 1%',
  ]
  const falsify = hasData ? data!.falsify : [
    '科技板块成交占比 > 35%，集中度过高',
    '市场宽度（%>200MA）从 78% 降至 62%',
  ]
  const action = hasData ? data!.action : [
    '维持权重股底仓，不加杠杆，不追 AI',
    '关注半导体设备回调机会',
  ]

  const itemStyle = (color: string): React.CSSProperties => ({
    fontSize: '12px', lineHeight: '1.5', color: THEME.textSecondary,
    paddingLeft: '12px', position: 'relative',
    listStyle: 'none',
  })

  return (
    <MacroCard title="三段式方法论" badge="RISK ON">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={block('#089981', 'rgba(8,153,129,0.06)', 'rgba(8,153,129,0.2)')}>
          <div style={{ ...headerStyle, color: '#089981' }}>证据</div>
          <ul style={{ margin: 0, padding: 0 }}>
            {evidence.map((e, i) => <li key={i} style={itemStyle('#089981')}>{e}</li>)}
          </ul>
        </div>
        <div style={block('#F23645', 'rgba(242,54,69,0.06)', 'rgba(242,54,69,0.2)')}>
          <div style={{ ...headerStyle, color: '#F23645' }}>证伪</div>
          <ul style={{ margin: 0, padding: 0 }}>
            {falsify.map((f, i) => <li key={i} style={itemStyle('#F23645')}>{f}</li>)}
          </ul>
        </div>
        <div style={block(THEME.blue, 'rgba(59,130,246,0.06)', 'rgba(59,130,246,0.2)')}>
          <div style={{ ...headerStyle, color: THEME.blue }}>行动</div>
          <ul style={{ margin: 0, padding: 0 }}>
            {action.map((a, i) => <li key={i} style={itemStyle(THEME.blue)}>{a}</li>)}
          </ul>
        </div>
      </div>
    </MacroCard>
  )
}

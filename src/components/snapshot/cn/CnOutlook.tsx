import { MacroCard } from '../../ui/MacroCard'
import { THEME } from '../../ui/theme'

interface Props {
  data?: { evidence: string[]; falsify: string[]; action: string[] } | null
}

const block = (color: string, bg: string, border: string): React.CSSProperties => ({
  padding: '10px 12px', borderRadius: '8px', border: `1px solid ${border}`,
  background: bg,
})

export default function CnOutlook({ data }: Props) {
  const hasData = data && data.evidence?.length > 0
  const evidence = hasData ? data!.evidence : [
    '政策宽松周期延续，LPR 下调 25bp',
    '北向资金本周净流入 120 亿',
  ]
  const falsify = hasData ? data!.falsify : [
    '人民币汇率压力仍在',
    '地产销售数据未见明显改善',
  ]
  const action = hasData ? data!.action : [
    '维持高股息 + 科技哑铃配置',
    '关注 PPI 触底后的工业品机会',
  ]

  return (
    <MacroCard title="A股三段式方法论" badge="谨慎乐观">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {[
          { title: '证据', color: '#089981', bg: 'rgba(8,153,129,0.06)', bdr: 'rgba(8,153,129,0.2)', items: evidence },
          { title: '证伪', color: '#F23645', bg: 'rgba(242,54,69,0.06)', bdr: 'rgba(242,54,69,0.2)', items: falsify },
          { title: '行动', color: THEME.blue, bg: 'rgba(59,130,246,0.06)', bdr: 'rgba(59,130,246,0.2)', items: action },
        ].map(s => (
          <div key={s.title} style={block(s.color, s.bg, s.bdr)}>
            <div style={{ color: s.color, fontSize: '12px', fontWeight: 600, letterSpacing: '0.04em', marginBottom: '6px' }}>{s.title}</div>
            <ul style={{ margin: 0, padding: 0 }}>
              {s.items.map((item, i) => (
                <li key={i} style={{
                  fontSize: '12px', lineHeight: '1.5', color: THEME.textSecondary,
                  paddingLeft: '12px', position: 'relative', listStyle: 'none',
                }}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </MacroCard>
  )
}

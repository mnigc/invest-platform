import { MacroCard } from '../../ui/MacroCard'
import { THEME } from '../../ui/theme'

const cycleStage = '分歧'
const limitUp = 42; const limitDown = 8; const boardHeight = 4; const breakRate = 38; const firstBoard = 18
const coreLeader = { name: '中际旭创', code: '300308', boards: 3, concept: 'CPO/光模块' }

export default function CnSentimentCycle() {
  return (
    <MacroCard title="情绪周期" badge={cycleStage}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
          <span style={{ fontSize: '12px', color: THEME.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>当前阶段</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: i < 2 ? THEME.blue : i === 2 ? '#F59E0B' : THEME.borderColor,
                boxShadow: i === 2 ? '0 0 8px rgba(245,158,11,0.5)' : 'none',
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
            {['启动', '主升', '分歧', '退潮'].map((name, i) => (
              <span key={name} style={{ fontSize: '11px', color: i === 2 ? '#F59E0B' : THEME.textMuted, fontFamily: THEME.fontMono, fontWeight: i === 2 ? 600 : 400 }}>{name}</span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', marginBottom: '12px' }}>
        {[
          { label: '涨停', val: limitUp, clr: THEME.red },
          { label: '跌停', val: limitDown, clr: THEME.green },
          { label: '连板高度', val: boardHeight, clr: THEME.red },
          { label: '炸板率', val: breakRate, clr: THEME.green },
          { label: '首板', val: firstBoard, clr: THEME.red },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '8px 4px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
            <span style={{ fontSize: '11px', color: THEME.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.label}</span>
            <span style={{ fontSize: '22px', fontWeight: 700, fontFamily: THEME.fontMono, lineHeight: 1, color: item.clr }}>{item.val}</span>
          </div>
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${THEME.borderLight}`, paddingTop: '12px' }}>
        <div style={{ fontSize: '12px', color: THEME.blue, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>核心龙头</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: THEME.blueDim, borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.textPrimary }}>{coreLeader.name}</div>
            <div style={{ fontSize: '12px', color: THEME.textMuted, fontFamily: THEME.fontMono }}>{coreLeader.code}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', padding: '3px 8px', borderRadius: '4px', background: 'rgba(245,158,11,0.12)', color: '#F59E0B', fontWeight: 600 }}>{coreLeader.boards}连板</span>
            <span style={{ fontSize: '12px', color: THEME.cyan, fontWeight: 500 }}>{coreLeader.concept}</span>
          </div>
        </div>
      </div>
    </MacroCard>
  )
}

import { MacroCard } from '../../ui/MacroCard'
import { MacroBadge } from '../../ui/MacroBadge'
import { THEME } from '../../ui/theme'

const swTop5 = [
  { name: '通信', perf: 2.35, up: true }, { name: '电子', perf: 1.82, up: true },
  { name: '计算机', perf: 1.56, up: true }, { name: '传媒', perf: 1.12, up: true },
  { name: '汽车', perf: 0.85, up: true },
]
const swBottom3 = [
  { name: '银行', perf: -0.72, up: false }, { name: '房地产', perf: -0.58, up: false },
  { name: '食品饮料', perf: -0.41, up: false },
]
const hotConcepts = [
  { name: 'CPO/光模块', roi: 3.85, leader: '中际旭创', days: 5 },
  { name: '人形机器人', roi: 3.12, leader: '拓普集团', days: 3 },
  { name: '低空经济', roi: 2.76, leader: '万丰奥威', days: 8 },
  { name: 'AI芯片', roi: 2.45, leader: '寒武纪', days: 4 },
  { name: '存储芯片', roi: 2.18, leader: '兆易创新', days: 2 },
  { name: '量子通信', roi: 1.92, leader: '国盾量子', days: 6 },
]

export default function CnSectorTheme() {
  return (
    <MacroCard title="板块题材轮动" badge="申万一级">
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>强势行业 TOP 5</div>
        {swTop5.map(s => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}`, marginBottom: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
              <span style={{ fontSize: '13px', color: THEME.textPrimary, fontWeight: 500, width: '60px' }}>{s.name}</span>
              <MacroBadge value={s.perf} variant={s.up ? 'up' : 'down'} size="sm" />
            </div>
            <div style={{ width: '80px', height: '6px', background: THEME.borderColor, borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.abs(s.perf) * 20}%`, background: s.up ? THEME.green : THEME.red, borderRadius: '2px' }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.green, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>弱势行业 BOTTOM 3</div>
        {swBottom3.map(s => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}`, marginBottom: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
              <span style={{ fontSize: '13px', color: THEME.textPrimary, fontWeight: 500, width: '60px' }}>{s.name}</span>
              <MacroBadge value={s.perf} variant={s.up ? 'up' : 'down'} size="sm" />
            </div>
            <div style={{ width: '80px', height: '6px', background: THEME.borderColor, borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.abs(s.perf) * 20}%`, background: s.up ? THEME.green : THEME.red, borderRadius: '2px' }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${THEME.borderLight}`, paddingTop: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>热门概念 TOP 6</div>
        {hotConcepts.map((t, i) => (
          <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: THEME.bgCard, borderRadius: '6px', border: `1px solid ${THEME.borderLight}`, marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textMuted, width: '24px', textAlign: 'center' }}>#{i + 1}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', color: THEME.textPrimary, fontWeight: 500 }}>{t.name}</div>
              <div style={{ fontSize: '11px', color: THEME.textMuted, fontFamily: THEME.fontMono }}>{t.leader} · {t.days}天</div>
            </div>
            <span style={{ fontSize: '14px', fontWeight: 700, fontFamily: THEME.fontMono, color: '#F59E0B' }}>{t.roi >= 0 ? '+' : ''}{t.roi.toFixed(2)}%</span>
          </div>
        ))}
      </div>
    </MacroCard>
  )
}

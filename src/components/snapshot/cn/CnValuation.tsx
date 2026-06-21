import { MacroCard } from '../../ui/MacroCard'
import { THEME } from '../../ui/theme'

interface Industry {
  name: string
  pe?: number
  pb?: number
  stockCount?: number
}

interface ValuationData {
  overallPE?: number
  overallPB?: number
  overallSignal?: string
  industries?: Industry[]
}

const FALLBACK_TOP3: Industry[] = [
  { name: '食品饮料', pe: 28.5, pb: 6.2, stockCount: 120 },
  { name: '计算机', pe: 52.3, pb: 4.8, stockCount: 280 },
  { name: '电子', pe: 45.8, pb: 5.1, stockCount: 350 },
]

const FALLBACK_BOTTOM3: Industry[] = [
  { name: '银行', pe: 6.2, pb: 0.6, stockCount: 42 },
  { name: '建筑', pe: 8.5, pb: 0.8, stockCount: 80 },
  { name: '钢铁', pe: 12.3, pb: 1.1, stockCount: 60 },
]

export default function CnValuation({ data }: { data?: ValuationData | null }) {
  const hasData = data && data.overallPE != null && Array.isArray(data.industries) && data.industries.length > 0

  const overallPE = data?.overallPE ?? 16.8
  const overallSignal = data?.overallSignal || '中性偏低'
  const industries = hasData ? data.industries! : []

  const sorted = [...industries]
    .filter((s) => typeof s.pe === 'number' && !isNaN(s.pe))
    .sort((a, b) => (b.pe ?? 0) - (a.pe ?? 0))
  const top3 = sorted.length >= 3 ? sorted.slice(0, 3) : FALLBACK_TOP3
  const bottom3 = sorted.length >= 3 ? sorted.slice(-3).reverse() : FALLBACK_BOTTOM3

  return (
    <MacroCard title="估值体系" badge={overallSignal}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>全市场</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', background: THEME.blueDim, borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)' }}>
          <span style={{ fontSize: '32px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.blue }}>{overallPE.toFixed(2)}</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '11px', color: THEME.textMuted }}>全部 A 股 PE (TTM)</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: THEME.textMuted, marginTop: '6px' }}>
              <span>{overallSignal}</span>
              {data?.overallPB != null && <span>PB {data.overallPB.toFixed(2)}</span>}
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>高估行业 TOP3</div>
        {top3.map(s => (
          <div key={s.name} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 60px', gap: '8px', alignItems: 'center', padding: '8px 10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}`, marginBottom: '4px' }}>
            <span style={{ fontSize: '13px', color: THEME.textPrimary, fontWeight: 500 }}>{s.name}</span>
            <span style={{ fontSize: '12px', color: THEME.textSecondary, fontFamily: THEME.fontMono }}>PE {(s.pe ?? 0).toFixed(1)}</span>
            <span style={{ fontSize: '12px', color: THEME.textSecondary, fontFamily: THEME.fontMono }}>PB {(s.pb ?? 0).toFixed(1)}</span>
            <span style={{ fontSize: '12px', fontFamily: THEME.fontMono, color: '#F59E0B', textAlign: 'right' }}>{s.stockCount ?? '--'}</span>
          </div>
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${THEME.borderLight}`, paddingTop: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>低估行业 BOTTOM 3</div>
        {bottom3.map(s => (
          <div key={s.name} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 60px', gap: '8px', alignItems: 'center', padding: '8px 10px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}`, marginBottom: '4px' }}>
            <span style={{ fontSize: '13px', color: THEME.textPrimary, fontWeight: 500 }}>{s.name}</span>
            <span style={{ fontSize: '12px', color: THEME.textSecondary, fontFamily: THEME.fontMono }}>PE {(s.pe ?? 0).toFixed(1)}</span>
            <span style={{ fontSize: '12px', color: THEME.textSecondary, fontFamily: THEME.fontMono }}>PB {(s.pb ?? 0).toFixed(1)}</span>
            <span style={{ fontSize: '12px', fontFamily: THEME.fontMono, color: THEME.cyan, textAlign: 'right' }}>{s.stockCount ?? '--'}</span>
          </div>
        ))}
      </div>
    </MacroCard>
  )
}

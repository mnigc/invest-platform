import { MacroCard } from '../../ui/MacroCard'
import { MacroBadge } from '../../ui/MacroBadge'
import { THEME } from '../../ui/theme'

interface Props {
  data?: Array<{ symbol: string; name: string; price: number; change: number }> | null
}

export default function CnIndexStyle({ data }: Props) {
  const hasData = data && data.length > 0

  const items = hasData
    ? data!.map(d => ({ name: d.name, code: d.symbol, value: d.price, change: d.change }))
    : [
        { name: '上证指数', code: '000001', value: 3150.45, change: 0.35 },
        { name: '深证成指', code: '399001', value: 10320.10, change: 0.72 },
        { name: '创业板指', code: '399006', value: 1950.28, change: -0.25 },
        { name: '风格大盘', code: '399364', value: 4520.18, change: 0.42 },
        { name: '风格小盘', code: '399367', value: 2840.35, change: -0.58 },
      ]

  return (
    <MacroCard title="核心指数 & 风格">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
        {items.map(idx => (
          <div key={idx.code} style={{
            padding: '10px 8px', background: THEME.bgCard, borderRadius: '8px',
            border: `1px solid ${THEME.borderLight}`,
          }}>
            <div style={{ fontSize: '10px', color: THEME.textMuted, fontFamily: THEME.fontMono }}>{idx.code}</div>
            <div style={{ fontSize: '13px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary, margin: '2px 0' }}>
              {idx.value != null ? idx.value.toFixed(2) : '--'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: THEME.textSecondary }}>{idx.name}</span>
              <MacroBadge value={idx.change} variant={idx.change >= 0 ? 'up' : 'down'} size="sm" />
            </div>
          </div>
        ))}
      </div>
    </MacroCard>
  )
}

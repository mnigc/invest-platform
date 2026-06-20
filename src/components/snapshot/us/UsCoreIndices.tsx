import { MacroCard } from '../../ui/MacroCard'
import { MacroBadge } from '../../ui/MacroBadge'
import { THEME } from '../../ui/theme'

interface Props {
  data?: Array<{ symbol: string; name: string; price: number; change: number }> | null
}

const fallback = [
  { name: 'S&P 500', code: 'SPX', value: 5487.03, change: 0.25 },
  { name: 'NASDAQ 100', code: 'NDX', value: 19685.42, change: 0.68 },
  { name: 'Dow Jones', code: 'DJI', value: 38920.35, change: -0.12 },
  { name: 'Russell 2000', code: 'RUT', value: 2042.18, change: -0.45 },
]

export default function UsCoreIndices({ data }: Props) {
  const indices = data?.length
    ? data.map(d => ({ name: d.name, code: d.symbol.replace('^', ''), value: d.price, change: d.change }))
    : fallback

  return (
    <MacroCard title="核心指数" badge="1D">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
        {indices.map(idx => (
          <div key={idx.code} style={{
            padding: '12px 10px', background: THEME.bgCard, borderRadius: '10px',
            border: `1px solid ${THEME.borderLight}`, transition: 'all 0.2s',
          }}>
            <div style={{ marginBottom: '6px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textPrimary, fontFamily: THEME.fontMono }}>{idx.code}</div>
              <div style={{ fontSize: '10px', color: THEME.textMuted, marginTop: '1px' }}>{idx.name}</div>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary, marginBottom: '4px' }}>
              {typeof idx.value === 'number' ? idx.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
            </div>
            <MacroBadge value={idx.change} variant={idx.change >= 0 ? 'up' : 'down'} size="sm" />
          </div>
        ))}
      </div>
    </MacroCard>
  )
}

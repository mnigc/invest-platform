import { MacroCard } from '../../ui/MacroCard'

interface Props {
  data?: Array<{ code: string; name: string; value: number; unit: string }> | null
}

export default function UsMacroRisk({ data }: Props) {
  const findVal = (code: string) => data?.find(d => d.code === code)

  const dxy = findVal('DEXUSEU')
  const vix = findVal('VIXCLS')
  const fedFunds = findVal('FEDFUNDS')
  const dgs10 = findVal('DGS10')
  const spread = dgs10 != null && fedFunds != null ? (Number(dgs10.value) - Number(fedFunds.value)).toFixed(2) : null

  return (
    <MacroCard
      title="宏观与风险指标"
      badge={spread != null ? `利差 ${spread}%` : undefined}
    >
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px',
        padding: '0',
      }}>
        {[
          { label: '联邦利率', val: fedFunds?.value, unit: '%' },
          { label: '10Y', val: dgs10?.value, unit: '%' },
          { label: 'VIX', val: vix?.value, unit: '' },
          { label: '美元指数', val: dxy?.value, unit: '' },
        ].map(item => (
          <div key={item.label} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 10px', background: 'var(--bg-card)', borderRadius: '8px',
            border: `1px solid var(--border-light)`,
            transition: 'all 0.2s',
          }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 500, width: '44px' }}>{item.label}</span>
            <span style={{
              fontSize: '13px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
            }}>
              {item.val != null ? `${Number(item.val).toFixed(2)}${item.unit}` : '--'}
            </span>
          </div>
        ))}
      </div>
    </MacroCard>
  )
}

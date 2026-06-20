import { MacroCard } from '../../ui/MacroCard'
import { THEME } from '../../ui/theme'

const volAgg = { amount: 8562, amountPrev: 9230, volumeRatio: 0.93, turnoverRate: 1.85, activeStocks: 1850 }
const anomalies = {
  volumeSurge: [
    { name: '中科曙光', code: '603019', change: 8.5, ratio: 3.2 },
    { name: '浪潮信息', code: '000977', change: 6.8, ratio: 2.8 },
    { name: '工业富联', code: '601138', change: 5.2, ratio: 2.5 },
  ],
  volumeShrink: [
    { name: '贵州茅台', code: '600519', change: -0.3, ratio: 0.35 },
    { name: '中国平安', code: '601318', change: -0.5, ratio: 0.42 },
    { name: '招商银行', code: '600036', change: -0.8, ratio: 0.48 },
  ],
}

export default function CnVolumeMicro() {
  return (
    <MacroCard title="量能微观异动" badge={`成交额 ${volAgg.amount.toLocaleString()}亿`}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>市场概况</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
          {[
            { label: '成交额', val: `${volAgg.amount.toLocaleString()}亿` },
            { label: '前日', val: `${volAgg.amountPrev.toLocaleString()}亿` },
            { label: '量比', val: volAgg.volumeRatio.toFixed(2) },
            { label: '换手率', val: `${volAgg.turnoverRate}%` },
            { label: '活跃股', val: volAgg.activeStocks },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '8px 4px', background: THEME.bgCard, borderRadius: '8px', border: `1px solid ${THEME.borderLight}` }}>
              <span style={{ fontSize: '11px', color: THEME.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.label}</span>
              <span style={{ fontSize: '16px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary }}>{item.val}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>异动监测</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {[
            { title: '放量异动 TOP3', items: anomalies.volumeSurge, clr: THEME.red },
            { title: '缩量异动 TOP3', items: anomalies.volumeShrink, clr: THEME.cyan },
          ].map(section => (
            <div key={section.title}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>{section.title}</div>
              {section.items.map(s => (
                <div key={s.code} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', background: THEME.bgCard, borderRadius: '6px', border: `1px solid ${THEME.borderLight}`, marginBottom: '4px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.textPrimary, fontFamily: THEME.fontMono, width: '60px' }}>{s.name}</span>
                  <span style={{ fontSize: '10px', color: THEME.textMuted, fontFamily: THEME.fontMono, width: '56px' }}>{s.code}</span>
                  <div style={{ flex: 1, height: '4px', background: THEME.borderColor, borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${s.ratio * 15}%`, background: section.clr, borderRadius: '2px' }} />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: THEME.fontMono, color: s.change >= 0 ? THEME.red : THEME.green, width: '48px', textAlign: 'right' }}>
                    {s.change >= 0 ? '+' : ''}{s.change.toFixed(1)}%
                  </span>
                  <span style={{ fontSize: '10px', color: THEME.textMuted, fontFamily: THEME.fontMono, width: '32px', textAlign: 'right' }}>{s.ratio.toFixed(1)}x</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </MacroCard>
  )
}

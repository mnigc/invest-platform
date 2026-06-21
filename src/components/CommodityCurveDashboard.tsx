import { useEffect, useMemo, useState } from 'react'
import { MacroCard } from './ui/MacroCard'
import { THEME } from './ui/theme'
import { LoadingSkeleton } from './ui/LoadingSkeleton'
import { CommodityCurveChart } from './CommodityCurveChart'
import { useChart } from './charts/useChart'

interface CurvePoint {
  contract: string
  month: string
  price: number | null
  change: number | null
}

interface CommodityData {
  code: string
  name_cn: string
  curve: CurvePoint[]
  frontPrice: number | null
  frontChange: number | null
  spread: number | null
  contango: boolean | null
  updatedAt: string
}

interface ApiData {
  commodities: Record<string, CommodityData>
  date: string
}

const COMMODITY_LIST = ['CL', 'NG', 'HG', 'GC', 'C', 'W', 'S']

const COMMODITY_LABELS: Record<string, string> = {
  CL: 'WTI原油',
  NG: '天然气',
  HG: '铜',
  GC: '黄金',
  C: '玉米',
  W: '小麦',
  S: '大豆',
}

const COMMODITY_ICONS: Record<string, string> = {
  CL: '🛢️',
  NG: '🔥',
  HG: '🪙',
  GC: '👑',
  C: '🌽',
  W: '🌾',
  S: '🫘',
}

function MiniCard({ icon, title, children, accent }: { icon: string; title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      background: THEME.bgCard, borderRadius: '12px', border: `1px solid ${THEME.borderLight}`,
      padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
        <span style={{ fontSize: '12px' }}>{icon}</span>
        <span style={{ fontSize: '10px', color: THEME.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function HeroRow({ data }: { data: CommodityData }) {
  const changeUp = data.frontChange != null && data.frontChange >= 0
  const isContango = data.contango === true
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px' }}>
      <MiniCard icon={COMMODITY_ICONS[data.code] || '📦'} title={`${data.name_cn} 最新`}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '28px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary }}>
            {data.frontPrice != null ? data.frontPrice.toFixed(2) : '--'}
          </span>
          <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: THEME.fontMono, color: changeUp ? THEME.red : THEME.green }}>
            {data.frontChange != null ? `${changeUp ? '↑' : '↓'} ${Math.abs(data.frontChange).toFixed(2)}%` : '--'}
          </span>
        </div>
        <div style={{ fontSize: '10px', color: THEME.textMuted, marginTop: '2px' }}>
          {data.updatedAt || '--'}
        </div>
      </MiniCard>

      <MiniCard icon="📐" title="期限结构">
        <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: THEME.fontMono, color: isContango ? THEME.cyan : THEME.gold }}>
          {isContango ? '远月升水' : data.contango === false ? '远月贴水' : '--'}
        </div>
        <div style={{ fontSize: '11px', color: THEME.textSecondary, marginTop: '2px' }}>
          {isContango ? `Contango ${data.spread?.toFixed(2)}%` : data.contango === false ? `Backwardation ${Math.abs(data.spread || 0).toFixed(2)}%` : '暂无数据'}
        </div>
      </MiniCard>

      <MiniCard icon="↕️" title="近远月价差">
        <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: THEME.fontMono, color: data.spread != null ? (data.spread >= 0 ? THEME.green : THEME.red) : THEME.textMuted }}>
          {data.spread != null ? `${data.spread >= 0 ? '+' : ''}${data.spread.toFixed(2)}%` : '--'}
        </div>
        <div style={{ fontSize: '11px', color: THEME.textSecondary, marginTop: '2px' }}>
          {data.curve.length > 0 ? `${data.curve[0]?.contract || ''} → ${data.curve[data.curve.length - 1]?.contract || ''}` : ''}
        </div>
      </MiniCard>

      <MiniCard icon="📊" title="合约数量">
        <div style={{ fontSize: '28px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.blue }}>
          {data.curve.filter(p => p.price != null).length}
        </div>
        <div style={{ fontSize: '11px', color: THEME.textSecondary, marginTop: '2px' }}>
          有效合约月份
        </div>
      </MiniCard>
    </div>
  )
}

function CommodityTabs({ active, onChange }: { active: string; onChange: (code: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {COMMODITY_LIST.map(code => (
        <button
          key={code}
          onClick={() => onChange(code)}
          style={{
            padding: '6px 16px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 600,
            fontFamily: THEME.fontDisplay,
            letterSpacing: '0.03em',
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: active === code ? THEME.cyan : THEME.bgCard,
            color: active === code ? THEME.textPrimary : THEME.textSecondary,
            border: active === code ? 'none' : `1px solid ${THEME.borderLight}`,
          }}
        >
          {COMMODITY_ICONS[code] || ''} {COMMODITY_LABELS[code] || code}
        </button>
      ))}
    </div>
  )
}

function CrossCommodityChart({ commodities }: { commodities: Record<string, CommodityData> }) {
  const codes = COMMODITY_LIST.filter(c => commodities[c]?.curve?.length > 0)

  const option = useMemo(() => {
    if (codes.length === 0) return null

    const series = codes.map((code, i) => {
      const data = commodities[code]
      const prices = data.curve.filter(p => p.price != null).map(p => p.price as number)
      if (prices.length < 2) return null
      const base = prices[0]
      const normalized = prices.map(p => ((p - base) / base) * 100)
      const colors = [THEME.cyan, THEME.gold, THEME.red, THEME.green, '#A855F7', '#EC4899', '#F97316']
      return {
        type: 'line',
        name: COMMODITY_LABELS[code] || code,
        data: normalized,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, color: colors[i % colors.length] },
      }
    }).filter(Boolean)

    if (series.length === 0) return null

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: THEME.bgCard, borderColor: THEME.borderLight, borderWidth: 1,
        textStyle: { color: THEME.textPrimary, fontSize: 12 },
        formatter: (params: any) => {
          if (!Array.isArray(params)) return ''
          let html = `<div style="font-weight:600;margin-bottom:4px">跨商品曲线对比（归一化）</div>`
          params.forEach((p: any) => {
            if (p.value == null) return
            html += `<div style="color:${p.color}">${p.marker} ${p.seriesName}: <b>${Number(p.value).toFixed(2)}%</b></div>`
          })
          return html
        },
      },
      legend: {
        data: series.map((s: any) => s.name),
        textStyle: { color: THEME.textSecondary, fontSize: 10 },
        top: 0,
      },
      grid: { left: 60, right: 20, top: 40, bottom: 30 },
      xAxis: {
        type: 'category',
        data: Array.from({ length: Math.max(...series.map((s: any) => s.data.length)) }, (_, i) => `M${i + 1}`),
        axisLabel: { color: THEME.textMuted, fontSize: 11 },
        axisLine: { lineStyle: { color: THEME.borderColor } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: THEME.textMuted, fontSize: 11, formatter: '{value}%' },
        splitLine: { lineStyle: { color: THEME.borderColor, type: 'dashed' } },
        axisLine: { show: false },
      },
      series,
    } as any
  }, [commodities])

  const { ref } = useChart(option, [commodities])

  if (codes.length === 0) return null

  return (
    <MacroCard title="跨商品曲线归一化对比" badge={`${codes.length} 个`}>
      <div style={{ fontSize: '11px', color: THEME.textMuted, marginBottom: '8px' }}>
        所有商品以 M1 价格为基准归一化至 0%，展示期限结构斜率差异
      </div>
      <div ref={ref} style={{ width: '100%', height: '300px' }} />
    </MacroCard>
  )
}

export default function CommodityCurveDashboard() {
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeCode, setActiveCode] = useState('CL')

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/commodity-curve.json')
      .then(r => r.json())
      .then(res => {
        if (cancelled) return
        if (!res.success) { setError(res.error || '请求失败'); return }
        setData(res.data)
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const activeCommodity = data?.commodities?.[activeCode] || null

  if (loading) return <LoadingSkeleton type="card" height={600} />
  if (error) return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: THEME.red, fontSize: '14px' }}>
      ⚠️ {error}
    </div>
  )
  if (!data || !Object.keys(data.commodities).length) return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: THEME.textMuted, fontSize: '14px' }}>
      暂无数据，请先运行同步脚本
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <CommodityTabs active={activeCode} onChange={setActiveCode} />

      {activeCommodity && (
        <>
          <HeroRow data={activeCommodity} />

          <MacroCard title={`${activeCommodity.name_cn} 期限结构`}>
            <CommodityCurveChart
              curve={activeCommodity.curve}
              commodityName={activeCommodity.name_cn}
            />
          </MacroCard>

          <MacroCard title={`${activeCommodity.name_cn} 合约明细`}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: THEME.bgElevated }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: THEME.textMuted, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: THEME.fontMono }}>合约</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: THEME.textMuted, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: THEME.fontMono }}>相对月</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 500, color: THEME.textMuted, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: THEME.fontMono }}>价格</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 500, color: THEME.textMuted, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: THEME.fontMono }}>日变动</th>
                  </tr>
                </thead>
                <tbody>
                  {activeCommodity.curve.map((p, i) => (
                    <tr key={p.contract} style={{ transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = THEME.bgElevated)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '8px 12px', borderTop: `1px solid ${THEME.borderLight}`, color: THEME.textSecondary, fontFamily: THEME.fontMono }}>{p.contract}</td>
                      <td style={{ padding: '8px 12px', borderTop: `1px solid ${THEME.borderLight}`, color: THEME.textMuted }}>M{i + 1}</td>
                      <td style={{ padding: '8px 12px', borderTop: `1px solid ${THEME.borderLight}`, textAlign: 'right', color: THEME.textPrimary, fontWeight: 600, fontFamily: THEME.fontMono }}>
                        {p.price != null ? p.price.toFixed(2) : '-'}
                      </td>
                      <td style={{ padding: '8px 12px', borderTop: `1px solid ${THEME.borderLight}`, textAlign: 'right', color: p.change != null ? (p.change >= 0 ? THEME.green : THEME.red) : THEME.textMuted, fontFamily: THEME.fontMono }}>
                        {p.change != null ? `${p.change >= 0 ? '+' : ''}${p.change.toFixed(2)}%` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </MacroCard>
        </>
      )}

      <CrossCommodityChart commodities={data.commodities} />
    </div>
  )
}

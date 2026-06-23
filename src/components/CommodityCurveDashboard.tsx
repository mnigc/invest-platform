import { useEffect, useMemo, useState } from 'react'
import { MacroCard } from './ui/MacroCard'
import { useChartTheme } from './ui/theme'
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
      background: 'var(--bg-card)', borderRadius: '12px',
      padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
        <span style={{ fontSize: '12px' }}>{icon}</span>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
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
          <span style={{ fontSize: '28px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {data.frontPrice != null ? data.frontPrice.toFixed(2) : '--'}
          </span>
          <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: changeUp ? 'var(--red)' : 'var(--green)' }}>
            {data.frontChange != null ? `${changeUp ? '↑' : '↓'} ${Math.abs(data.frontChange).toFixed(2)}%` : '--'}
          </span>
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
          {data.updatedAt || '--'}
        </div>
      </MiniCard>

      <MiniCard icon="📐" title="期限结构">
        <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: isContango ? 'var(--accent-cyan)' : 'var(--accent-gold)' }}>
          {isContango ? '远月升水' : data.contango === false ? '远月贴水' : '--'}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {isContango ? `Contango ${data.spread?.toFixed(2)}%` : data.contango === false ? `Backwardation ${Math.abs(data.spread || 0).toFixed(2)}%` : '暂无数据'}
        </div>
      </MiniCard>

      <MiniCard icon="↕️" title="近远月价差">
        <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: data.spread != null ? (data.spread >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' }}>
          {data.spread != null ? `${data.spread >= 0 ? '+' : ''}${data.spread.toFixed(2)}%` : '--'}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {data.curve.length > 0 ? `${data.curve[0]?.contract || ''} → ${data.curve[data.curve.length - 1]?.contract || ''}` : ''}
        </div>
      </MiniCard>

      <MiniCard icon="📊" title="合约数量">
        <div style={{ fontSize: '28px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)' }}>
          {data.curve.filter(p => p.price != null).length}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
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
            fontFamily: 'var(--font-display)',
            letterSpacing: '0.03em',
            cursor: 'pointer',
            background: active === code ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: active === code ? '#FFFFFF' : 'var(--text-secondary)',
            border: 'none',
          }}
        >
          {COMMODITY_ICONS[code] || ''} {COMMODITY_LABELS[code] || code}
        </button>
      ))}
    </div>
  )
}

function CrossCommodityChart({ commodities }: { commodities: Record<string, CommodityData> }) {
  const chartTheme = useChartTheme()
  const codes = COMMODITY_LIST.filter(c => commodities[c]?.curve?.length > 0)

  const option = useMemo(() => {
    if (codes.length === 0) return null

    const series = codes.map((code, i) => {
      const data = commodities[code]
      const prices = data.curve.filter(p => p.price != null).map(p => p.price as number)
      if (prices.length < 2) return null
      const base = prices[0]
      const normalized = prices.map(p => ((p - base) / base) * 100)
      const colors = [chartTheme.cyan, chartTheme.gold, chartTheme.red, chartTheme.green, chartTheme.blue]
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
        backgroundColor: chartTheme.bgCard, borderColor: chartTheme.borderLight, borderWidth: 1,
        textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
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
        textStyle: { color: chartTheme.textSecondary, fontSize: 10 },
        top: 0,
      },
      grid: { left: 60, right: 20, top: 40, bottom: 30 },
      xAxis: {
        type: 'category',
        data: Array.from({ length: Math.max(...series.map((s: any) => s.data.length)) }, (_, i) => `M${i + 1}`),
        axisLabel: { color: chartTheme.textMuted, fontSize: 11 },
        axisLine: { lineStyle: { color: chartTheme.borderColor } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: chartTheme.textMuted, fontSize: 11, formatter: '{value}%' },
        splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } },
        axisLine: { show: false },
      },
      series,
    } as any
  }, [commodities, chartTheme])

  const { ref } = useChart(option, [commodities, chartTheme])

  if (codes.length === 0) return null

  return (
    <MacroCard title="跨商品曲线归一化对比" badge={`${codes.length} 个`}>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
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
    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--red)', fontSize: '14px' }}>
      ⚠️ {error}
    </div>
  )
  if (!data || !Object.keys(data.commodities).length) return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
      暂无数据，请先运行同步脚本
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px',
      minHeight: '650px',  /* prevent layout shift on tab switch */ }}>
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
                  <tr style={{ background: 'var(--bg-elevated)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>合约</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>相对月</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 500, color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>价格</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 500, color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>日变动</th>
                  </tr>
                </thead>
                <tbody>
                  {activeCommodity.curve.map((p, i) => (
                    <tr key={p.contract}>
                      <td style={{ padding: '8px 12px', borderTop: `1px solid var(--border-light)`, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{p.contract}</td>
                      <td style={{ padding: '8px 12px', borderTop: `1px solid var(--border-light)`, color: 'var(--text-muted)' }}>M{i + 1}</td>
                      <td style={{ padding: '8px 12px', borderTop: `1px solid var(--border-light)`, textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                        {p.price != null ? p.price.toFixed(2) : '-'}
                      </td>
                      <td style={{ padding: '8px 12px', borderTop: `1px solid var(--border-light)`, textAlign: 'right', color: p.change != null ? (p.change >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
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

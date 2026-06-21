import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { THEME } from './ui/theme'

// ==================== Types ====================

type OverviewData = {
  period_date: string | null
  holdings: { country: string; country_cn: string; region: string | null; tonnes: number; share_pct: number | null; period_date: string | null }[]
  global_totals: { country: string; country_cn: string; tonnes: number; share_pct: number | null; period_date: string }[]
  major_countries_trend: {
    periods: string[]
    countries: { country: string; country_cn: string; region: string | null; values: (number | null)[] }[]
  }
  us_gold_series: { period_date: string; tonnes: number }[]
  cn_gold_series: { period_date: string; tonnes: number }[]
}

type ChangesData = {
  periods: string[]
  latest_period: string | null
  series: { country: string; country_cn: string; values: number[] }[]
  top_buyers: { country: string; country_cn: string; tonnes: number }[]
  top_sellers: { country: string; country_cn: string; tonnes: number }[]
}

type PriceData = {
  source: string
  latest_date: string | null
  latest_price: number
  daily_change: number
  daily_change_pct: number
  ytd_change: number
  ytd_change_pct: number
  high52: number
  low52: number
  avg5y: number
  series_5y: { date: string; price: number }[]
  series_30d: { date: string; price: number }[]
}

// ==================== Shared dark chart base ====================

const DARK_BG = THEME.bgCard
const TEXT_PRIMARY = '#e2e8f0'
const TEXT_MUTED = '#64748b'
const GRID_LINE = 'rgba(42,46,57,0.5)'
const SPLIT_LINE = 'rgba(71,85,105,0.3)'

const darkChartBase: any = {
  backgroundColor: DARK_BG,
  textStyle: { fontFamily: THEME.fontBody, fontSize: 12, color: TEXT_PRIMARY },
  grid: { left: 55, right: 24, top: 36, bottom: 36 },
  tooltip: {
    trigger: 'axis',
    backgroundColor: '#1c2128',
    borderColor: THEME.borderColor,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: TEXT_PRIMARY, fontSize: 12 },
  },
  animation: true,
}

function useEChart<T extends HTMLElement>(opts: (data: any) => any, dep: any) {
  const ref = useRef<T | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, 'dark', { renderer: 'canvas' })
    // override the built-in "dark" theme with our custom palette
    chart.setOption({ backgroundColor: 'transparent' })
    chartRef.current = chart
    const handle = () => chart.resize()
    window.addEventListener('resize', handle)
    return () => {
      window.removeEventListener('resize', handle)
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!chartRef.current) return
    chartRef.current.setOption(opts(dep), true)
    chartRef.current.resize()
  }, [dep])

  return ref
}

// ==================== Sub-charts ====================

// 区域配色方案
const REGION_PALETTE: Record<string, { from: string; to: string; label: string; tagColor: string }> = {
  US:     { from: '#60a5fa', to: '#2563eb', label: '美国',     tagColor: '#3b82f6' },
  CN:     { from: '#f87171', to: '#dc2626', label: '中国',     tagColor: '#ef4444' },
  EUROPE: { from: '#fbbf24', to: '#d97706', label: '欧洲',     tagColor: '#f59e0b' },
  ASIA:   { from: '#34d399', to: '#059669', label: '亚洲',     tagColor: '#10b981' },
  EM:     { from: '#a78bfa', to: '#7c3aed', label: '新兴市场', tagColor: '#8b5cf6' },
  GLOBAL: { from: '#94a3b8', to: '#64748b', label: '全球',     tagColor: '#64748b' },
}

function HoldingsTable({ data }: { data: OverviewData }) {
  const top = data.holdings.slice(0, 20)
  const maxTonnes = top.length > 0 ? top[0].tonnes : 1

  // 排名徽章颜色
  const rankBadge = (rank: number) => {
    if (rank === 1) return { bg: 'linear-gradient(135deg,#fde047,#facc15)', color: '#78350f', shadow: '0 0 8px rgba(250,204,21,0.5)' }
    if (rank === 2) return { bg: 'linear-gradient(135deg,#e2e8f0,#cbd5e1)', color: '#334155', shadow: '0 0 6px rgba(203,213,225,0.4)' }
    if (rank === 3) return { bg: 'linear-gradient(135deg,#fdba74,#fb923c)', color: '#7c2d12', shadow: '0 0 6px rgba(251,146,60,0.4)' }
    return { bg: 'rgba(71,85,105,0.35)', color: TEXT_MUTED, shadow: 'none' }
  }

  const renderRow = (r: typeof top[0], idx: number) => {
    const rank = idx + 1
    const badge = rankBadge(rank)
    const palette = REGION_PALETTE[r.region || ''] || REGION_PALETTE.GLOBAL
    const pct = Math.max(2, (r.tonnes / maxTonnes) * 100)
    const isTop3 = rank <= 3

    return (
      <div key={`${r.country}-${idx}`} style={{
        display: 'grid',
        gridTemplateColumns: '30px 78px 1fr 72px 60px',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        borderBottom: `1px solid ${THEME.borderLight}`,
        transition: 'background .2s',
      }}
        onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(245,158,11,0.04)')}
        onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {/* 排名徽章 */}
        <div style={{
          width: 24, height: 24, borderRadius: 7,
          background: badge.bg, color: badge.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11.5, fontWeight: 800, fontFamily: THEME.fontMono,
          boxShadow: badge.shadow, flexShrink: 0,
        }}>{rank}</div>

        {/* 国家名 */}
        <div style={{
          fontSize: 12.5, fontWeight: isTop3 ? 600 : 500, color: TEXT_PRIMARY,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {r.country_cn || r.country}
        </div>

        {/* 进度条（纯视觉，无数值） */}
        <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'rgba(71,85,105,0.2)', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${pct}%`, borderRadius: 4,
            background: `linear-gradient(90deg, ${palette.from}${isTop3 ? '' : 'aa'}, ${palette.to})`,
            boxShadow: isTop3 ? `0 0 8px ${palette.to}66` : 'none',
            transition: 'width .6s cubic-bezier(.4,0,.2,1)',
          }} />
        </div>

        {/* 储备量（吨）— 单独一列靠右 */}
        <div style={{
          textAlign: 'right', fontSize: 11.5, fontFamily: THEME.fontMono, fontWeight: 700,
          color: isTop3 ? THEME.gold : TEXT_PRIMARY, whiteSpace: 'nowrap',
        }}>
          {r.tonnes.toLocaleString()}
        </div>

        {/* 占外储比例 */}
        <div style={{
          textAlign: 'right', fontSize: 11.5, fontFamily: THEME.fontMono, fontWeight: 600,
          color: r.share_pct != null ? THEME.cyan : TEXT_MUTED,
        }}>
          {r.share_pct != null ? `${r.share_pct.toFixed(1)}%` : '—'}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 260 }}>
      {/* 标题区 */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${THEME.borderLight}` }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: TEXT_PRIMARY, fontFamily: THEME.fontDisplay }}>
          官方黄金储备 Top 20
        </span>
        <span style={{ fontSize: 10.5, color: TEXT_MUTED, fontFamily: THEME.fontMono }}>
          截至 {data.period_date || '—'} · 单位：吨
        </span>
      </div>

      {/* 表头 */}
      <div style={{
        display: 'grid', gridTemplateColumns: '30px 78px 1fr 72px 60px', gap: 10,
        padding: '0 12px 8px', fontSize: 10, color: TEXT_MUTED, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0,
      }}>
        <span>#</span>
        <span>国家 / 地区</span>
        <span>占比</span>
        <span style={{ textAlign: 'right' }}>吨</span>
        <span style={{ textAlign: 'right' }}>占外储</span>
      </div>

      {/* 滚动列表（复制一份实现无缝循环） */}
      <div
        className="gold-holdings-scroll"
        style={{ flex: 1, overflow: 'hidden', position: 'relative', maskImage: 'linear-gradient(to bottom, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%)' }}
        onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.animationPlayState = 'paused' }}
        onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.animationPlayState = 'running' }}
      >
        <div className="gold-holdings-track" style={{ animation: 'goldHoldingsScroll 32s linear infinite' }}>
          {top.map(renderRow)}
          {top.map(renderRow)}
        </div>
      </div>

      <style>{`
        @keyframes goldHoldingsScroll {
          0%   { transform: translateY(0); }
          100% { transform: translateY(-50%); }
        }
      `}</style>
    </div>
  )
}

function GoldPriceChart({ data }: { data: PriceData }) {
  const opts = () => ({
    ...darkChartBase,
    title: { text: '伦敦黄金定盘价：最近 5 年（USD/oz）', left: 'left', textStyle: { fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, fontFamily: THEME.fontDisplay } },
    grid: { left: 60, right: 50, top: 40, bottom: 56 },
    xAxis: {
      type: 'category', data: data.series_5y.map(r => r.date), boundaryGap: false,
      axisLabel: { color: TEXT_MUTED, interval: 'auto', fontSize: 10 },
      axisLine: { lineStyle: { color: GRID_LINE } },
    },
    yAxis: {
      type: 'value', scale: true, axisLabel: { color: TEXT_MUTED, fontSize: 11, formatter: '$' },
      splitLine: { lineStyle: { color: SPLIT_LINE } },
      axisLine: { show: false },
    },
    dataZoom: [
      { type: 'slider', start: 35, end: 100, height: 18, bottom: 14,
        borderColor: GRID_LINE, backgroundColor: 'rgba(19,23,34,0.6)', fillerColor: 'rgba(245,158,11,0.15)',
        handleIcon: 'M0,0 v9h9v-9H0z M-11,-1 h22v11 h-22 Z M-11,10 h22v11 h-22 Z',
        handleSize: '80%', handleStyle: { color: THEME.gold, borderColor: THEME.gold } },
    ],
    series: [{
      type: 'line', data: data.series_5y.map(r => r.price),
      smooth: true, symbol: 'none',
      lineStyle: { color: THEME.gold, width: 2.2, shadowBlur: 8, shadowColor: 'rgba(245,158,11,0.25)' },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: 'rgba(245,158,11,0.28)' },
        { offset: 1, color: 'rgba(245,158,11,0.01)' },
      ])},
      markLine: {
        silent: true, symbol: 'none', precision: 0,
        lineStyle: { color: '#475569', type: 'dashed', width: 1 },
        label: { formatter: `5年均值 $${data.avg5y.toFixed(0)}`, color: TEXT_MUTED, fontSize: 11 },
        data: [{ yAxis: data.avg5y }],
      },
    }],
  })
  return <div ref={useEChart<HTMLDivElement>(opts, [data.series_5y.length])} style={{ width: '100%', height: 340 }} />
}

function RecentPriceChart({ data }: { data: PriceData }) {
  const opts = () => ({
    ...darkChartBase,
    title: { text: '最近 30 个交易日（USD/oz）', left: 'left', textStyle: { fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, fontFamily: THEME.fontDisplay } },
    grid: { left: 60, right: 24, top: 40, bottom: 32 },
    xAxis: { type: 'category', data: data.series_30d.map(r => r.date), axisLabel: { color: TEXT_MUTED, fontSize: 10 }, axisLine: { lineStyle: { color: GRID_LINE } } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: TEXT_MUTED, fontSize: 11, formatter: '$' }, splitLine: { lineStyle: { color: SPLIT_LINE } }, axisLine: { show: false } },
    series: [{
      type: 'bar', data: data.series_30d.map((r, i) => ({
        value: r.price,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: i > data.series_30d.length - 2 ? THEME.gold : 'rgba(245,158,11,0.45)' },
            { offset: 1, color: i > data.series_30d.length - 2 ? '#d97706' : 'rgba(245,158,11,0.18)' },
          ]),
          borderRadius: [2, 2, 0, 0],
        },
      })),
      barMaxWidth: 14,
    }],
  })
  return <div ref={useEChart<HTMLDivElement>(opts, [data.series_30d.length])} style={{ width: '100%', height: 260 }} />
}

function ChangesChart({ data }: { data: ChangesData }) {
  const COLORS = ['#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#a78bfa', '#34d399', '#fb923c']
  const opts = () => ({
    ...darkChartBase,
    title: { text: '各国每月净增持（吨）', left: 'left', textStyle: { fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, fontFamily: THEME.fontDisplay } },
    legend: { top: 0, type: 'scroll', textStyle: { color: TEXT_MUTED, fontSize: 11 }, iconColor: TEXT_PRIMARY, itemGap: 16 },
    grid: { left: 60, right: 24, top: 48, bottom: 76 },
    xAxis: { type: 'category', data: data.periods, axisLabel: { color: TEXT_MUTED, rotate: 38, fontSize: 10 }, axisLine: { lineStyle: { color: GRID_LINE } } },
    yAxis: { type: 'value', axisLabel: { color: TEXT_MUTED, fontSize: 11 }, splitLine: { lineStyle: { color: SPLIT_LINE } }, axisLine: { show: false } },
    dataZoom: [
      { type: 'slider', height: 18, bottom: 32, start: 60, end: 100,
        borderColor: GRID_LINE, backgroundColor: 'rgba(19,23,34,0.6)', fillerColor: 'rgba(59,130,246,0.1)',
        handleStyle: { color: THEME.blue, borderColor: THEME.blue } },
    ],
    series: data.series.slice(0, 12).map((s, idx) => ({
      name: s.country_cn || s.country, type: 'bar', stack: null,
      data: s.values, emphasis: { focus: 'series' }, barMaxWidth: 12,
      itemStyle: { color: COLORS[idx % COLORS.length], borderRadius: s.values.some(v => v > 0) && s.values.some(v => v < 0) ? undefined : [2, 2, 0, 0] },
    })),
  })
  return <div ref={useEChart<HTMLDivElement>(opts, [data.series.length, data.periods.length])} style={{ width: '100%', height: 380 }} />
}

function BuySellRanking({ data }: { data: ChangesData }) {
  const buyerOpts = () => ({
    ...darkChartBase,
    title: { text: `净增持 Top 10（${data.latest_period?.slice(0, 7) || ''}）`, left: 'left', textStyle: { fontSize: 13, fontWeight: 600, color: THEME.green, fontFamily: THEME.fontDisplay } },
    grid: { left: 120, right: 40, top: 40, bottom: 20 },
    tooltip: { ...darkChartBase.tooltip, formatter: (p: any) => `<b>${p[0].name}</b><br/>增持：${p[0].value.toLocaleString()} 吨` },
    xAxis: { type: 'value', axisLabel: { color: TEXT_MUTED }, splitLine: { lineStyle: { color: SPLIT_LINE } }, axisLine: { show: false } },
    yAxis: { type: 'category', data: data.top_buyers.map(r => r.country_cn || r.country).reverse(), axisLabel: { color: TEXT_PRIMARY, fontSize: 11.5 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: 'bar', data: data.top_buyers.map(r => ({ value: r.tonnes, itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#059669' }, { offset: 1, color: '#047857' }]), borderRadius: [0, 4, 4, 0] } })), barMaxWidth: 16 }],
  })
  const sellerOpts = () => ({
    ...darkChartBase,
    title: { text: `净减持 Top 10（${data.latest_period?.slice(0, 7) || ''}）`, left: 'left', textStyle: { fontSize: 13, fontWeight: 600, color: THEME.red, fontFamily: THEME.fontDisplay } },
    grid: { left: 120, right: 40, top: 40, bottom: 20 },
    tooltip: { ...darkChartBase.tooltip, formatter: (p: any) => `<b>${p[0].name}</b><br/>减持：${Math.abs(p[0].value).toLocaleString()} 吨` },
    xAxis: { type: 'value', axisLabel: { color: TEXT_MUTED }, splitLine: { lineStyle: { color: SPLIT_LINE } }, axisLine: { show: false } },
    yAxis: { type: 'category', data: data.top_sellers.map(r => r.country_cn || r.country), axisLabel: { color: TEXT_PRIMARY, fontSize: 11.5 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: 'bar', data: data.top_sellers.map(r => ({ value: Math.abs(r.tonnes), itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#dc2626' }, { offset: 1, color: '#991b1b' }]), borderRadius: [0, 4, 4, 0] } })), barMaxWidth: 16 }],
  })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div ref={useEChart<HTMLDivElement>(buyerOpts, [data.top_buyers.length, data.latest_period])} style={{ width: '100%', height: 320 }} />
      <div ref={useEChart<HTMLDivElement>(sellerOpts, [data.top_sellers.length, data.latest_period])} style={{ width: '100%', height: 320 }} />
    </div>
  )
}

// 主要国家颜色映射（按区域分组，便于视觉区分）
const COUNTRY_COLORS: Record<string, string> = {
  'United States': '#3b82f6',  '美国': '#3b82f6',
  'Germany':       '#f59e0b',  '德国': '#f59e0b',
  'Italy':         '#22c55e',  '意大利': '#22c55e',
  'France':        '#a78bfa',  '法国': '#a78bfa',
  'Russia':        '#ef4444',  '俄罗斯': '#ef4444',
  'China':         '#f43f5e',  '中国': '#f43f5e',
  'Switzerland':   '#06b6d4',  '瑞士': '#06b6d4',
  'Japan':         '#eab308',  '日本': '#eab308',
  'India':         '#fb923c',  '印度': '#fb923c',
  'Netherlands':   '#14b8a6',  '荷兰': '#14b8a6',
}
const FALLBACK_COLORS = ['#8b5cf6', '#ec4899', '#34d399', '#f97316', '#6366f1', '#84cc16']

function GoldHoldingTimeline({ data }: { data: OverviewData }) {
  const trend = data.major_countries_trend
  const hasTrend = trend && trend.countries && trend.countries.length > 0 && trend.periods.length > 0

  // 如果没有趋势数据，显示占位
  if (!hasTrend) {
    return (
      <div style={{ width: '100%', height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_MUTED, fontSize: 13 }}>
        暂无主流国家历史趋势数据
      </div>
    )
  }

  const periods = trend.periods
  const countries = trend.countries
  let colorIdx = 0

  const opts = () => ({
    ...darkChartBase,
    title: { text: '主要国家官方黄金储备趋势', left: 'left', textStyle: { fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, fontFamily: THEME.fontDisplay } },
    legend: {
      top: 0, type: 'scroll', textStyle: { color: TEXT_MUTED, fontSize: 11 }, itemGap: 12,
    },
    grid: { left: 65, right: 24, top: 44, bottom: 56 },
    xAxis: [{
      type: 'category', data: periods, boundaryGap: false,
      axisLabel: { color: TEXT_MUTED, fontSize: 10, interval: Math.floor(periods.length / 10) },
      axisLine: { lineStyle: { color: GRID_LINE } },
    }],
    yAxis: {
      type: 'value', name: '吨 (Tonnes)', position: 'left',
      nameTextStyle: { color: TEXT_MUTED, fontSize: 10 },
      axisLabel: { color: TEXT_MUTED, fontSize: 11 },
      splitLine: { lineStyle: { color: SPLIT_LINE } },
      axisLine: { show: false },
    },
    dataZoom: [
      { type: 'slider', height: 16, bottom: 18, start: 0, end: 100,
        borderColor: GRID_LINE, backgroundColor: 'rgba(19,23,34,0.6)', fillerColor: 'rgba(59,130,246,0.1)',
        handleStyle: { color: THEME.blue, borderColor: THEME.blue } },
    ],
    series: countries.map((c) => {
      const color = COUNTRY_COLORS[c.country] || COUNTRY_COLORS[c.country_cn] || FALLBACK_COLORS[colorIdx++ % FALLBACK_COLORS.length]
      const isHighlight = c.country.includes('China') || c.country_cn.includes('中国') || c.country.includes('Russia') || c.country_cn.includes('俄罗斯')
      return {
        name: c.country_cn || c.country,
        type: 'line',
        data: c.values,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color,
          width: isHighlight ? 2.8 : 1.8,
          shadowBlur: isHighlight ? 8 : 0,
          shadowColor: color + '40',
        },
        areaStyle: isHighlight ? {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: color + '20' },
            { offset: 1, color: color + '00' },
          ]),
        } : undefined,
        emphasis: { focus: 'series', lineStyle: { width: 3.5 } },
      }
    }),
    tooltip: {
      ...darkChartBase.tooltip,
      formatter: (p: any) => {
        let s = `<b>${p[0].axisValue}</b>`
        // 按值降序排列
        const sorted = p.filter((i: any) => i.value != null).sort((a: any, b: any) => b.value - a.value)
        for (const item of sorted) {
          s += `<br/>${item.marker} ${item.seriesName}：<b style="color:${item.color};font-weight:700">${Number(item.value).toLocaleString()}</b> 吨`
        }
        return s
      },
    },
  })

  return <div ref={useEChart<HTMLDivElement>(opts, [periods.length, countries.length])} style={{ width: '100%', height: 380 }} />
}

// ==================== Main Dashboard ====================

export default function GoldDashboard() {
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [changes, setChanges] = useState<ChangesData | null>(null)
  const [price, setPrice] = useState<PriceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const [o, c, p] = await Promise.all([
          fetch('/api/v1/gold/overview.json').then(r => r.json()).catch(() => null),
          fetch('/api/v1/gold/changes.json').then(r => r.json()).catch(() => null),
          fetch('/api/v1/gold/price.json').then(r => r.json()).catch(() => null),
        ])
        if (cancelled) return
        setOverview(o); setChanges(c); setPrice(p)
      } catch (e: any) { setError(e.message || '数据加载失败') }
      finally { if (!cancelled) setLoading(false) }
    }
    load(); return () => { cancelled = true }
  }, [])

  const hasNoData = !loading && !overview?.holdings?.length && !price?.series_5y?.length && !changes?.series?.length

  // ---- loading ----
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 }}>
        <div style={{ width: 36, height: 36, border: `3px solid ${THEME.borderColor}`, borderTopColor: THEME.gold, borderRadius: '50%', animation: 'goldSpin 0.8s linear infinite' }} />
        <p style={{ margin: 0, color: TEXT_MUTED, fontSize: 14 }}>正在加载黄金数据...</p>
        <style>{'@keyframes goldSpin{to{transform:rotate(360deg)}}'}</style>
      </div>
    )
  }

  // ---- empty / error ----
  if (hasNoData || error) {
    return (
      <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', color: TEXT_MUTED }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{error ? '\u274C' : '\u{1FA99}'}</div>
        <h2 style={{ color: TEXT_PRIMARY, margin: '0 0 8px', fontSize: 17, fontFamily: THEME.fontDisplay }}>{error ? '加载失败' : '暂无黄金数据'}</h2>
        <p style={{ margin: '0 0 24px', fontSize: 13.5, lineHeight: 1.8 }}>
          {error
            ? `${error}。请检查网络或联系管理员。`
            : <>
              黄金数据尚未同步。请在终端执行：
              <code style={{ display: 'block', background: '#0f172a', border: `1px solid ${THEME.borderColor}`, padding: '12px 18px', marginTop: 10, borderRadius: 8, fontSize: 12.5, color: THEME.cyan, textAlign: 'left', whiteSpace: 'normal', wordBreak: 'break-all', letterSpacing: '0.02em' }}>
                cd sync &amp;&amp; python fetch_gold_reserves.py
              </code>
              <br /><br />运行前请确保本地有{' '}
              <code style={{ background: '#0f172a', border: `1px solid ${THEME.borderColor}`, padding: '2px 8px', borderRadius: 4, fontSize: 11.5, color: THEME.gold }}>gold_holdings.xlsx</code>
              {' '}和{' '}
              <code style={{ background: '#0f172a', border: `1px solid ${THEME.borderColor}`, padding: '2px 8px', borderRadius: 4, fontSize: 11.5, color: THEME.gold }}>gold_changes.xlsx</code>
            </>
          }
        </p>
        {!error && (
          <button onClick={() => window.location.reload()} style={{
            padding: '9px 28px', background: THEME.gold, color: '#000', border: 'none', borderRadius: 10,
            fontWeight: 700, cursor: 'pointer', fontSize: 13, letterSpacing: '.02em', transition: 'opacity .2s',
          }} onMouseOver={(e) => e.currentTarget.style.opacity = '0.85'} onMouseOut={(e) => e.currentTarget.style.opacity = '1'}>
            重新加载
          </button>
        )}
      </div>
    )
  }

  // ---- render dashboard ----
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ===== Intro Card ===== */}
      <section style={CARD}>
        <h2 style={{ margin: '0 0 10px 0', fontSize: 16, fontWeight: 700, color: TEXT_PRIMARY, fontFamily: THEME.fontDisplay }}>
          黄金：跨越千年的价值锚
        </h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: TEXT_MUTED }}>
          黄金是全球公认的<span style={{ color: THEME.gold, fontWeight: 600 }}>终极避险资产</span>与<span style={{ color: THEME.gold, fontWeight: 600 }}>央行储备核心</span>。
          它稀缺、无信用风险、全球流通，能够在法币贬值、通胀高企或地缘政治动荡时提供价值保护。
          同时，黄金在珠宝、电子与航天等领域拥有实体需求，兼具商品与货币双重属性。
        </p>
        <p style={{ margin: '10px 0 0 0', fontSize: 13, lineHeight: 1.7, color: TEXT_MUTED }}>
          <b style={{ color: TEXT_PRIMARY }}>涨跌逻辑：</b>
          黄金以美元计价，<span style={{ color: THEME.green }}>美元走弱</span>时，其他国家买家买黄金更便宜，需求增加，金价容易上涨；反之美元走强，黄金变贵，买盘减少，金价就承压。
          此外黄金本身不生利息，当<span style={{ color: THEME.green }}>利率下降</span>时，存银行和买债券的收益变低，持有黄金的机会成本降低，资金更愿意流入黄金；而当<span style={{ color: THEME.red }}>利率上行、实际收益率抬升</span>时，无息的吸引力下降，黄金容易被抛售。
          <span style={{ color: THEME.green }}>通胀高企</span>会侵蚀纸币购买力，黄金作为保值工具受到追捧；<span style={{ color: THEME.green }}>地缘冲突、经济衰退担忧</span>则会推高避险需求；全球<span style={{ color: THEME.green }}>央行持续购金</span>也会给金价提供长期支撑。
        </p>
      </section>

      {/* ===== Hero Metrics Row ===== */}
      <section style={CARD}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {/* 第一行 */}
          <MetricCard label="最新金价" unit="USD/oz" value={price!.latest_price} delta={price!.daily_change_pct} meta={price!.latest_date} accent="gold" large />
          <MetricCard label="年初至今" unit="" value={price!.ytd_change_pct ? price!.ytd_change_pct : null} isPct meta={price!.latest_date} />
          <MetricCard label="52 周区间" unit="" value={null} range={`$${price!.high52.toLocaleString()} / $${price!.low52.toLocaleString()}`} />
          {/* 第二行 */}
          <MetricCard label="数据周期" unit="" value={null} dateValue={overview?.period_date || '—'} />
          {overview?.global_totals.map(g => (
            <MetricCard
              key={g.country}
              label={g.country_cn || g.country}
              unit="吨"
              value={g.tonnes}
              meta={g.period_date}
            />
          ))}
        </div>
      </section>

      {/* ===== 5-Year Price Chart (full width) ===== */}
      <section style={CARD}>
        <GoldPriceChart data={price!} />
      </section>

      {/* ===== Holdings + 30-Day (2-col) ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <section style={CARD}><HoldingsTable data={overview!} /></section>
        <section style={CARD}><RecentPriceChart data={price!} /></section>
      </div>

      {/* ===== Major Countries Trend (full width) ===== */}
      <section style={CARD}>
        <GoldHoldingTimeline data={overview!} />
      </section>

      {/* ===== Changes + Ranking ===== */}
      {changes && changes.series.length > 0 && (
        <>
          <section style={CARD}>
            <ChangesChart data={changes} />
          </section>
          <section style={CARD}>
            <BuySellRanking data={changes} />
          </section>
        </>
      )}

      {/* ===== Data Table ===== */}
      <section style={CARD}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${THEME.borderLight}`,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, fontFamily: THEME.fontDisplay, letterSpacing: '.03em' }}>
            各国官方黄金储备（Top 40）
          </span>
          <span style={{ fontSize: 11, color: TEXT_MUTED, fontFamily: THEME.fontMono }}>
            共 {overview?.holdings.slice(0, 40).reduce((s) => s + 1, 0)} 个国家/地区
          </span>
        </div>
        <table style={TBL}>
          <thead>
            <tr>
              <th style={TH}>#</th>
              <th style={TH}>国家 / 地区</th>
              <th style={TH_L}>持有量（吨）</th>
              <th style={TH_R}>占外储比例</th>
              <th style={TH_C}>数据日期</th>
              <th style={TH_C}>区域</th>
            </tr>
          </thead>
          <tbody>
            {overview!.holdings.slice(0, 40).map((r, i) => (
              <tr key={r.country} style={{ borderBottom: `1px solid ${THEME.borderLight}` }}>
                <td style={TD}>{i + 1}</td>
                <td style={{ ...TD, fontWeight: 500, color: TEXT_PRIMARY }}>{r.country_cn || r.country}</td>
                <td style={{ ...TD_L, fontFamily: THEME.fontMono, color: THEME.gold, fontWeight: 600 }}>{r.tonnes.toLocaleString()}</td>
                <td style={TD_R}>{r.share_pct != null ? <span style={{ color: THEME.cyan, fontWeight: 500 }}>{r.share_pct.toFixed(1)}%</span> : '—'}</td>
                <td style={{ ...TD_C, fontFamily: THEME.fontMono, color: TEXT_MUTED, fontSize: 11.5 }}>{r.period_date || '—'}</td>
                <td style={TD_C}>{regionTag(r.region)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

// ==================== Style Constants ====================

const CARD: React.CSSProperties = {
  background: THEME.bgCard,
  border: `1px solid ${THEME.borderLight}`,
  borderRadius: 16,
  padding: '18px',
  boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
}

const TBL: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }
const TH: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', color: TEXT_MUTED, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }
const TH_L: React.CSSProperties = { ...TH, textAlign: 'right' }
const TH_R: React.CSSProperties = { ...TH, textAlign: 'right' }
const TH_C: React.CSSProperties = { ...TH, textAlign: 'center' }
const TD: React.CSSProperties = { padding: '9px 12px', color: TEXT_PRIMARY }
const TD_L: React.CSSProperties = { ...TD, textAlign: 'right' }
const TD_R: React.CSSProperties = { ...TD, textAlign: 'right' }
const TD_C: React.CSSProperties = { ...TD, textAlign: 'center' }

// ==================== Small Components ====================

function MetricCard({
  label, unit, value, delta, meta, accent, isPct, range, dateValue, large, rowSpan,
}: {
  label: string; unit: string; value: number | null; delta?: number; meta?: string;
  accent?: 'gold'; isPct?: boolean; range?: string; dateValue?: string; large?: boolean; rowSpan?: number;
}) {
  const positive = (delta ?? 0) >= 0
  const accentColor = accent === 'gold' ? THEME.gold : positive ? THEME.green : THEME.red
  const dimBg = accent === 'gold' ? THEME.goldDim : positive ? THEME.greenBg : THEME.redBg

  return (
    <div style={{
      padding: '16px 18px', borderRadius: 12,
      background: 'rgba(19,23,34,0.6)', border: `1px solid ${THEME.borderLight}`,
      transition: 'border-color .2s',
      gridRow: rowSpan ? `span ${rowSpan}` : undefined,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
    }}>
      <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.08em' }}>
        {label}
      </div>

      {/* main value */}
      {isPct && value != null ? (
        <div style={{ fontSize: large ? 32 : 24, fontWeight: 800, color: Number(value) >= 0 ? THEME.green : THEME.red, fontFamily: THEME.fontMono, lineHeight: 1.2 }}>
          {Number(value) >= 0 ? '+' : ''}{Number(value).toFixed(2)}%
        </div>
      ) : value != null ? (
        <div style={{ fontSize: large ? 32 : 24, fontWeight: 800, color: accentColor, fontFamily: THEME.fontMono, lineHeight: 1.2 }}>
          {value.toLocaleString()}{unit ? ' ' + unit : ''}
        </div>
      ) : range ? (
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT_PRIMARY, lineHeight: 1.2 }}>
          {range}
        </div>
      ) : (
        <div style={{ fontSize: 24, fontWeight: 800, color: TEXT_PRIMARY, lineHeight: 1.2 }}>
          {dateValue}
        </div>
      )}

      {/* delta badge */}
      {typeof delta === 'number' && (
        <div style={{
          display: 'inline-block', marginTop: 8, padding: '2px 8px', borderRadius: 6,
          fontSize: 11.5, fontWeight: 700, fontFamily: THEME.fontMono, letterSpacing: '.03em',
          color: positive ? THEME.green : THEME.red, background: positive ? THEME.greenBg : THEME.redBg,
        }}>
          {positive ? '\u25B2' : '\u25BC'} {Math.abs(delta).toFixed(2)}%
        </div>
      )}

      {/* meta */}
      {meta && <div style={{ marginTop: 6, fontSize: 11, color: TEXT_MUTED, fontFamily: THEME.fontMono }}>{meta}</div>}
    </div>
  )
}

function regionTag(region: string | null | undefined): React.ReactNode {
  const map: Record<string, { color: string; label: string }> = {
    US:   { color: THEME.blue,  label: '美国' },
    CN:   { color: THEME.red,   label: '中国' },
    EUROPE:{ color: THEME.gold,  label: '欧洲' },
    ASIA: { color: THEME.cyan,  label: '亚洲' },
    EM:   { color: '#a78bfa',   label: '新兴市场' },
  }
  const tag = map[String(region)]
  return tag
    ? <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 11, color: tag.color, background: tag.color.replace(')', ',0.15)').replace('#', 'rgba('), fontWeight: 600 }}>{tag.label}</span>
    : <span style={{ color: TEXT_MUTED, fontSize: 11.5 }}>全球</span>
}

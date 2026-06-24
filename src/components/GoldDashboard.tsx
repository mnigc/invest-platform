import { useEffect, useRef, useState } from 'react'
import echarts from '../lib/echarts'
import { useChartTheme, type ChartThemeValues } from './ui/theme'
import { LoadingSkeleton } from './ui/LoadingSkeleton'

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
  dxy: {
    series_5y: { date: string; value: number }[]
    latest_value: number | null
    daily_change: number
    daily_change_pct: number
    gold_dxy_corr: {
      d30: number; d90: number; d180: number; y1: number; y3: number; all: number
    }
    aligned_5y: { date: string; gold: number; dxy: number | null }[]
  }
}

function getChartBase(chartTheme: ChartThemeValues): any {
  return {
    backgroundColor: chartTheme.bgCard,
    textStyle: { fontFamily: chartTheme.fontBody, fontSize: 12, color: chartTheme.textSecondary },
    grid: { left: 55, right: 24, top: 36, bottom: 36 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: chartTheme.bgElevated,
      borderColor: chartTheme.borderColor,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
    },
    animation: true,
  }
}

function useEChart<T extends HTMLElement>(opts: (data: any) => any, dep: any) {
  const ref = useRef<T | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
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
  }, [opts, dep])

  return ref
}

// ==================== Sub-charts ====================

function HoldingsTable({ data }: { data: OverviewData }) {
  const top = data.holdings.slice(0, 20)
  const maxTonnes = top.length > 0 ? top[0].tonnes : 1
  const scrollRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(false)

  // 排名徽章颜色
  const rankBadge = (rank: number) => {
    if (rank === 1) return { bg: 'var(--accent-gold)', color: '#000' }
    if (rank === 2) return { bg: 'var(--text-secondary)', color: 'var(--text-primary)' }
    if (rank === 3) return { bg: 'var(--accent-gold-dim)', color: 'var(--text-primary)' }
    return { bg: 'var(--accent-gold-dim)', color: 'var(--text-secondary)' }
  }

  const renderRow = (r: typeof top[0], idx: number, keyPrefix: string) => {
    const rank = idx + 1
    const badge = rankBadge(rank)
    const pct = Math.max(2, (r.tonnes / maxTonnes) * 100)
    const isTop3 = rank <= 3

    return (
      <div key={`${keyPrefix}-${r.country}-${idx}`} style={{
        display: 'grid',
        gridTemplateColumns: '30px 78px 1fr 72px 60px',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        borderRadius: 6,
      }}
      >
        <div style={{
          width: 24, height: 24, borderRadius: 7,
          background: badge.bg, color: badge.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11.5, fontWeight: 800, fontFamily: 'var(--font-mono)',
          flexShrink: 0,
        }}>{rank}</div>

        <div style={{
          fontSize: 12.5, fontWeight: isTop3 ? 600 : 500, color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {r.country_cn || r.country}
        </div>

        <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--border-light)', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${pct}%`, borderRadius: 4,
            background: isTop3 ? 'var(--accent-gold)' : 'var(--accent-gold-dim)',
          }} />
        </div>

        <div style={{
          textAlign: 'right', fontSize: 11.5, fontFamily: 'var(--font-mono)', fontWeight: 700,
          color: isTop3 ? 'var(--accent-gold)' : 'var(--text-primary)', whiteSpace: 'nowrap',
        }}>
          {r.tonnes.toLocaleString()}
        </div>

        <div style={{
          textAlign: 'right', fontSize: 11.5, fontFamily: 'var(--font-mono)', fontWeight: 600,
          color: r.share_pct != null ? 'var(--accent-cyan)' : 'var(--text-secondary)',
        }}>
          {r.share_pct != null ? `${r.share_pct.toFixed(1)}%` : '—'}
        </div>
      </div>
    )
  }

  // 自动循环滚动（requestAnimationFrame 驱动，60fps 丝滑）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const SPEED_PX_PER_SEC = 40 // 滚动速度：像素/秒
    let rafId: number | null = null
    let lastTs = performance.now()

    const loop = (ts: number) => {
      const dt = (ts - lastTs) / 1000 // 秒
      lastTs = ts
      if (!pausedRef.current && el) {
        const halfHeight = el.scrollHeight / 2
        el.scrollTop += SPEED_PX_PER_SEC * dt
        if (el.scrollTop >= halfHeight) {
          el.scrollTop = el.scrollTop - halfHeight
        }
      }
      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)

    const onEnter = () => { pausedRef.current = true }
    const onLeave = () => { pausedRef.current = false }
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 260 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
          官方黄金储备 Top 20
        </span>
        <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          截至 {data.period_date || '—'} · 单位：吨
        </span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '30px 78px 1fr 72px 60px', gap: 10,
        padding: '0 12px 8px', fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0,
      }}>
        <span>#</span>
        <span>国家 / 地区</span>
        <span>占比</span>
        <span style={{ textAlign: 'right' }}>吨</span>
        <span style={{ textAlign: 'right' }}>占外储</span>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'hidden', position: 'relative' }}>
        <div>
          {top.map((r, i) => renderRow(r, i, 'A'))}
          {top.map((r, i) => renderRow(r, i, 'B'))}
        </div>
      </div>
    </div>
  )
}

function GoldPriceChart({ data }: { data: PriceData }) {
  const chartTheme = useChartTheme()
  const opts = () => ({
    ...getChartBase(chartTheme),
    title: { text: '伦敦黄金定盘价：最近 5 年（USD/oz）', left: 'left', textStyle: { fontSize: 13, fontWeight: 600, color: chartTheme.textPrimary, fontFamily: chartTheme.fontDisplay } },
    grid: { left: 60, right: 50, top: 40, bottom: 56 },
    xAxis: {
      type: 'category', data: data.series_5y.map(r => r.date), boundaryGap: false,
      axisLabel: { color: chartTheme.textSecondary, interval: 'auto', fontSize: 10 },
      axisLine: { lineStyle: { color: chartTheme.borderColor } },
    },
    yAxis: {
      type: 'value', scale: true, axisLabel: { color: chartTheme.textSecondary, fontSize: 11, formatter: '${value}' },
      splitLine: { lineStyle: { color: chartTheme.borderColor } },
      axisLine: { show: false },
    },
    dataZoom: [
      { type: 'slider', start: 35, end: 100, height: 18, bottom: 14,
        borderColor: chartTheme.borderColor, backgroundColor: chartTheme.bgCard, fillerColor: chartTheme.goldDim,
        handleIcon: 'path://M0,0 v9h9v-9H0z M-11,-1 h22v11 h-22 Z M-11,10 h22v11 h-22 Z',
        handleSize: '80%', handleStyle: { color: chartTheme.gold, borderColor: chartTheme.gold } },
    ],
    series: [{
      type: 'line', data: data.series_5y.map(r => r.price),
      smooth: true, symbol: 'none',
      lineStyle: { color: chartTheme.gold, width: 2.2, shadowBlur: 8, shadowColor: chartTheme.goldDim },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
        { offset: 0, color: chartTheme.goldDim },
        { offset: 1, color: chartTheme.bgCard },
      ] } },
      markLine: {
        silent: true, symbol: 'none', precision: 0,
        lineStyle: { color: chartTheme.borderColor, type: 'dashed', width: 1 },
        label: { formatter: `5年均值 $${data.avg5y.toFixed(0)}`, color: chartTheme.textSecondary, fontSize: 11 },
        data: [{ yAxis: data.avg5y }],
      },
    }],
  })
  return <div ref={useEChart<HTMLDivElement>(opts, [data.series_5y.length, chartTheme])} style={{ width: '100%', height: 340 }} />
}

function RecentPriceChart({ data }: { data: PriceData }) {
  const chartTheme = useChartTheme()
  const opts = () => ({
    ...getChartBase(chartTheme),
    title: { text: '最近 30 个交易日（USD/oz）', left: 'left', textStyle: { fontSize: 13, fontWeight: 600, color: chartTheme.textPrimary, fontFamily: chartTheme.fontDisplay } },
    grid: { left: 60, right: 24, top: 40, bottom: 32 },
    xAxis: { type: 'category', data: data.series_30d.map(r => r.date), axisLabel: { color: chartTheme.textSecondary, fontSize: 10 }, axisLine: { lineStyle: { color: chartTheme.borderColor } } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: chartTheme.textSecondary, fontSize: 11, formatter: '${value}' }, splitLine: { lineStyle: { color: chartTheme.borderColor } }, axisLine: { show: false } },
    series: [{
      type: 'bar', data: data.series_30d.map((r, i) => ({
        value: r.price,
        itemStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
            { offset: 0, color: i > data.series_30d.length - 2 ? chartTheme.gold : chartTheme.goldDim },
            { offset: 1, color: chartTheme.bgCard },
          ] },
          borderRadius: [2, 2, 0, 0],
        },
      })),
      barMaxWidth: 14,
    }],
  })
  return <div ref={useEChart<HTMLDivElement>(opts, [data.series_30d.length, chartTheme])} style={{ width: '100%', height: 260 }} />
}

function ChangesChart({ data }: { data: ChangesData }) {
  const chartTheme = useChartTheme()
  const COLORS = [chartTheme.red, chartTheme.gold, chartTheme.green, chartTheme.cyan, chartTheme.blue]
  const opts = () => ({
    ...getChartBase(chartTheme),
    title: { text: '各国每月净增持（吨）', left: 'left', textStyle: { fontSize: 13, fontWeight: 600, color: chartTheme.textPrimary, fontFamily: chartTheme.fontDisplay } },
    legend: { top: 0, type: 'scroll', textStyle: { color: chartTheme.textSecondary, fontSize: 11 }, iconColor: chartTheme.textPrimary, itemGap: 16 },
    grid: { left: 60, right: 24, top: 48, bottom: 76 },
    xAxis: { type: 'category', data: data.periods, axisLabel: { color: chartTheme.textSecondary, rotate: 38, fontSize: 10 }, axisLine: { lineStyle: { color: chartTheme.borderColor } } },
    yAxis: { type: 'value', axisLabel: { color: chartTheme.textSecondary, fontSize: 11 }, splitLine: { lineStyle: { color: chartTheme.borderColor } }, axisLine: { show: false } },
    dataZoom: [
      { type: 'slider', height: 18, bottom: 32, start: 60, end: 100,
        borderColor: chartTheme.borderColor, backgroundColor: chartTheme.bgCard, fillerColor: chartTheme.blueDim,
        handleStyle: { color: chartTheme.blue, borderColor: chartTheme.blue } },
    ],
    series: data.series.slice(0, 12).map((s, idx) => ({
      name: s.country_cn || s.country, type: 'bar', stack: null,
      data: s.values, emphasis: { focus: 'series' }, barMaxWidth: 12,
      itemStyle: { color: COLORS[idx % COLORS.length], borderRadius: s.values.some(v => v > 0) && s.values.some(v => v < 0) ? undefined : [2, 2, 0, 0] },
    })),
  })
  return <div ref={useEChart<HTMLDivElement>(opts, [data.series.length, data.periods.length, chartTheme])} style={{ width: '100%', height: 380 }} />
}

function BuySellRanking({ data }: { data: ChangesData }) {
  const chartTheme = useChartTheme()
  const buyerOpts = () => ({
    ...getChartBase(chartTheme),
    title: { text: `净增持 Top 10（${data.latest_period?.slice(0, 7) || ''}）`, left: 'left', textStyle: { fontSize: 13, fontWeight: 600, color: chartTheme.green, fontFamily: chartTheme.fontDisplay } },
    grid: { left: 120, right: 40, top: 40, bottom: 20 },
    tooltip: { ...getChartBase(chartTheme).tooltip, formatter: (p: any) => `<b>${p[0].name}</b><br/>增持：${p[0].value.toLocaleString()} 吨` },
    xAxis: { type: 'value', axisLabel: { color: chartTheme.textSecondary }, splitLine: { lineStyle: { color: chartTheme.borderColor } }, axisLine: { show: false } },
    yAxis: { type: 'category', data: data.top_buyers.map(r => r.country_cn || r.country).reverse(), axisLabel: { color: chartTheme.textPrimary, fontSize: 11.5 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: 'bar', data: data.top_buyers.map(r => ({ value: r.tonnes, itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: chartTheme.green }, { offset: 1, color: chartTheme.greenBg }] }, borderRadius: [0, 4, 4, 0] } })), barMaxWidth: 16 }],
  })
  const sellerOpts = () => ({
    ...getChartBase(chartTheme),
    title: { text: `净减持 Top 10（${data.latest_period?.slice(0, 7) || ''}）`, left: 'left', textStyle: { fontSize: 13, fontWeight: 600, color: chartTheme.red, fontFamily: chartTheme.fontDisplay } },
    grid: { left: 120, right: 40, top: 40, bottom: 20 },
    tooltip: { ...getChartBase(chartTheme).tooltip, formatter: (p: any) => `<b>${p[0].name}</b><br/>减持：${Math.abs(p[0].value).toLocaleString()} 吨` },
    xAxis: { type: 'value', axisLabel: { color: chartTheme.textSecondary }, splitLine: { lineStyle: { color: chartTheme.borderColor } }, axisLine: { show: false } },
    yAxis: { type: 'category', data: data.top_sellers.map(r => r.country_cn || r.country), axisLabel: { color: chartTheme.textPrimary, fontSize: 11.5 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: 'bar', data: data.top_sellers.map(r => ({ value: Math.abs(r.tonnes), itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: chartTheme.red }, { offset: 1, color: chartTheme.redBg }] }, borderRadius: [0, 4, 4, 0] } })), barMaxWidth: 16 }],
  })
  return (
    <div className="g-grid-2" style={{ display: 'grid', gap: 16 }}>
      <div ref={useEChart<HTMLDivElement>(buyerOpts, [data.top_buyers.length, data.latest_period, chartTheme])} style={{ width: '100%', height: 320 }} />
      <div ref={useEChart<HTMLDivElement>(sellerOpts, [data.top_sellers.length, data.latest_period, chartTheme])} style={{ width: '100%', height: 320 }} />
    </div>
  )
}

function GoldDxyComparisonChart({ data }: { data: PriceData }) {
  const chartTheme = useChartTheme()
  const aligned = data.dxy?.aligned_5y || []
  const hasAligned = aligned.length > 0 && aligned.some(r => r.dxy != null)

  if (!hasAligned) {
    return (
      <div style={{ width: '100%', height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
        暂无美元指数（DXY）对齐数据 · 请先同步 asset_prices 表中的 DX-Y.NYB
      </div>
    )
  }

  const corr = data.dxy?.gold_dxy_corr
  const corrLabel = (v: number) => v <= -0.3 ? '强负相关' : v <= -0.15 ? '负相关' : v < 0.15 ? '弱相关' : v < 0.3 ? '正相关' : '强正相关'
  const corrColorOf = (v: number) => v <= -0.3 ? 'var(--green)' : v >= 0.3 ? 'var(--red)' : 'var(--text-secondary)'

  const opts = () => ({
    ...getChartBase(chartTheme),
    title: {
      text: '金价 vs 美元指数（近 5 年，可拖动底部缩放条查看区间）',
      left: 'left',
      textStyle: { fontSize: 13, fontWeight: 600, color: chartTheme.textPrimary, fontFamily: chartTheme.fontDisplay },
    },
    legend: {
      top: 0, right: 0,
      textStyle: { color: chartTheme.textSecondary, fontSize: 11 },
      itemGap: 16,
    },
    grid: { left: 60, right: 60, top: 44, bottom: 72 },
    xAxis: {
      type: 'category',
      data: aligned.map(r => r.date),
      boundaryGap: false,
      axisLabel: { color: chartTheme.textSecondary, fontSize: 10, interval: 'auto' },
      axisLine: { lineStyle: { color: chartTheme.borderColor } },
    },
    yAxis: [
      {
        type: 'value',
        scale: true,
        name: '金价 USD/oz',
        position: 'left',
        nameTextStyle: { color: chartTheme.gold, fontSize: 10 },
        axisLabel: { color: chartTheme.gold, fontSize: 11, formatter: '${value}' },
        splitLine: { lineStyle: { color: chartTheme.borderColor } },
        axisLine: { show: false },
      },
      {
        type: 'value',
        scale: true,
        name: '美元指数 DXY',
        position: 'right',
        nameTextStyle: { color: chartTheme.blue, fontSize: 10 },
        axisLabel: { color: chartTheme.blue, fontSize: 11 },
        splitLine: { show: false },
        axisLine: { show: false },
      },
    ],
    dataZoom: [
      {
        type: 'slider',
        start: 70,
        end: 100,
        height: 18,
        bottom: 24,
        borderColor: chartTheme.borderColor,
        backgroundColor: chartTheme.bgCard,
        fillerColor: chartTheme.blueDim,
        handleStyle: { color: chartTheme.blue, borderColor: chartTheme.blue },
        // 禁用鼠标滚轮/触控缩放（inside 模式），仅保留底部滑块
        zoomLock: true,
      },
    ],
    tooltip: {
      ...getChartBase(chartTheme).tooltip,
      formatter: (p: any) => {
        if (!Array.isArray(p) || p.length === 0) return ''
        let s = `<b>${p[0].axisValue}</b>`
        for (const item of p) {
          const v = item.value
          if (v == null) continue
          const marker = item.marker || ''
          s += `<br/>${marker} ${item.seriesName}：<b style="color:${item.color};font-weight:700">${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>`
        }
        return s
      },
    },
    series: [
      {
        name: '伦敦黄金定盘价',
        type: 'line',
        yAxisIndex: 0,
        data: aligned.map(r => r.gold),
        smooth: true,
        symbol: 'none',
        lineStyle: { color: chartTheme.gold, width: 2 },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: chartTheme.goldDim },
              { offset: 1, color: 'transparent' },
            ],
          },
        },
      },
      {
        name: '美元指数 (DXY)',
        type: 'line',
        yAxisIndex: 1,
        data: aligned.map(r => r.dxy),
        smooth: true,
        symbol: 'none',
        lineStyle: { color: chartTheme.blue, width: 1.8, type: 'solid' },
      },
    ],
  })

  const corrRows: { label: string; value: number }[] = [
    { label: '近 30 天', value: corr?.d30 ?? 0 },
    { label: '近 90 天', value: corr?.d90 ?? 0 },
    { label: '近 180 天', value: corr?.d180 ?? 0 },
    { label: '近 1 年', value: corr?.y1 ?? 0 },
    { label: '近 3 年', value: corr?.y3 ?? 0 },
    { label: '全周期', value: corr?.all ?? 0 },
  ]

  return (
    <div>
      <div ref={useEChart<HTMLDivElement>(opts, [aligned.length, chartTheme])} style={{ width: '100%', height: 380 }} />
      <div style={{
        marginTop: 8,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        padding: '10px 14px',
        background: 'var(--bg-elevated)',
        borderRadius: 10,
        fontSize: 12,
        color: 'var(--text-secondary)',
        lineHeight: 1.8,
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {corrRows.map(row => (
            <div key={row.label} style={{ display: 'flex', flexDirection: 'column', minWidth: 64 }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>{row.label}</span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontSize: 13,
                color: corrColorOf(row.value),
              }}>
                {row.value > 0 ? '+' : ''}{row.value.toFixed(3)}
                <span style={{ fontSize: 10, fontWeight: 500, marginLeft: 4, color: 'var(--text-secondary)' }}>{corrLabel(row.value)}</span>
              </span>
            </div>
          ))}
        </div>
        {data.dxy?.latest_value != null && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>DXY 最新：</span>
            <span style={{ color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{Number(data.dxy.latest_value).toFixed(2)}</span>
            <span style={{
              padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
              color: (data.dxy.daily_change_pct ?? 0) >= 0 ? 'var(--green)' : 'var(--red)',
              background: (data.dxy.daily_change_pct ?? 0) >= 0 ? 'var(--green-bg)' : 'var(--red-bg)',
            }}>
              {(data.dxy.daily_change_pct ?? 0) >= 0 ? '▲' : '▼'} {Math.abs(data.dxy.daily_change_pct || 0).toFixed(2)}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function GoldHoldingTimeline({ data }: { data: OverviewData }) {
  const chartTheme = useChartTheme()
  const trend = data.major_countries_trend
  const hasTrend = trend && trend.countries && trend.countries.length > 0 && trend.periods.length > 0

  // 如果没有趋势数据，显示占位
  if (!hasTrend) {
    return (
      <div style={{ width: '100%', height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
        暂无主流国家历史趋势数据
      </div>
    )
  }

  const periods = trend.periods
  const countries = trend.countries
  let colorIdx = 0
  const FALLBACK_COLORS = [chartTheme.red, chartTheme.gold, chartTheme.cyan, chartTheme.green, chartTheme.blue]
  const COUNTRY_COLORS: Record<string, string> = {
    'United States': chartTheme.blue,  '美国': chartTheme.blue,
    'China': chartTheme.red,  '中国': chartTheme.red,
    'Switzerland': chartTheme.cyan,  '瑞士': chartTheme.cyan,
  }

  const opts = () => ({
    ...getChartBase(chartTheme),
    title: { text: '主要国家官方黄金储备趋势', left: 'left', textStyle: { fontSize: 13, fontWeight: 600, color: chartTheme.textPrimary, fontFamily: chartTheme.fontDisplay } },
    legend: {
      top: 0, type: 'scroll', textStyle: { color: chartTheme.textSecondary, fontSize: 11 }, itemGap: 12,
    },
    grid: { left: 65, right: 24, top: 44, bottom: 56 },
    xAxis: [{
      type: 'category', data: periods, boundaryGap: false,
      axisLabel: { color: chartTheme.textSecondary, fontSize: 10, interval: Math.floor(periods.length / 10) },
      axisLine: { lineStyle: { color: chartTheme.borderColor } },
    }],
    yAxis: {
      type: 'value', name: '吨 (Tonnes)', position: 'left',
      nameTextStyle: { color: chartTheme.textSecondary, fontSize: 10 },
      axisLabel: { color: chartTheme.textSecondary, fontSize: 11 },
      splitLine: { lineStyle: { color: chartTheme.borderColor } },
      axisLine: { show: false },
    },
    dataZoom: [
      { type: 'slider', height: 16, bottom: 18, start: 0, end: 100,
        borderColor: chartTheme.borderColor, backgroundColor: chartTheme.bgCard, fillerColor: chartTheme.blueDim,
        handleStyle: { color: chartTheme.blue, borderColor: chartTheme.blue } },
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
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
            { offset: 0, color: color + '33' },
            { offset: 1, color: 'transparent' },
          ] },
        } : undefined,
        emphasis: { focus: 'series', lineStyle: { width: 3.5 } },
      }
    }),
    tooltip: {
      ...getChartBase(chartTheme).tooltip,
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

  return <div ref={useEChart<HTMLDivElement>(opts, [periods.length, countries.length, chartTheme])} style={{ width: '100%', height: 380 }} />
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
  if (loading) return <LoadingSkeleton type="card" height={600} />

  // ---- empty / error ----
  if (hasNoData || error) {
    return (
      <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{error ? '\u274C' : '\u{1FA99}'}</div>
        <h2 style={{ color: 'var(--text-primary)', margin: '0 0 8px', fontSize: 17, fontFamily: 'var(--font-display)' }}>{error ? '加载失败' : '暂无黄金数据'}</h2>
        <p style={{ margin: '0 0 24px', fontSize: 13.5, lineHeight: 1.8 }}>
          {error
            ? `${error}。请检查网络或联系管理员。`
            : <>
              黄金数据尚未同步。请在终端执行：
              <code style={{ display: 'block', background: 'var(--bg-elevated)', border: `1px solid var(--border-color)`, padding: '12px 18px', marginTop: 10, borderRadius: 8, fontSize: 12.5, color: 'var(--accent-cyan)', textAlign: 'left', whiteSpace: 'normal', wordBreak: 'break-all', letterSpacing: '0.02em' }}>
                cd sync &amp;&amp; python fetch_gold_reserves.py
              </code>
              <br /><br />运行前请确保本地有{' '}
              <code style={{ background: 'var(--bg-elevated)', border: `1px solid var(--border-color)`, padding: '2px 8px', borderRadius: 4, fontSize: 11.5, color: 'var(--accent-gold)' }}>gold_holdings.xlsx</code>
              {' '}和{' '}
              <code style={{ background: 'var(--bg-elevated)', border: `1px solid var(--border-color)`, padding: '2px 8px', borderRadius: 4, fontSize: 11.5, color: 'var(--accent-gold)' }}>gold_changes.xlsx</code>
            </>
          }
        </p>
        {!error && (
          <button onClick={() => window.location.reload()} style={{
            padding: '9px 28px', background: 'var(--accent-gold)', color: '#000', border: 'none',
            fontWeight: 700, cursor: 'pointer', fontSize: 13, letterSpacing: '.02em',
          }}>
            重新加载
          </button>
        )}
      </div>
    )
  }

  const CARD: React.CSSProperties = {
    background: 'var(--bg-card)',
    borderRadius: 16,
    padding: '18px',
  }

  const TBL: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }
  const TH: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: `1px solid var(--border-light)` }
  const TH_L: React.CSSProperties = { ...TH, textAlign: 'right' }
  const TH_R: React.CSSProperties = { ...TH, textAlign: 'right' }
  const TH_C: React.CSSProperties = { ...TH, textAlign: 'center' }
  const TD: React.CSSProperties = { padding: '9px 12px', color: 'var(--text-primary)', borderTop: `1px solid var(--border-light)` }
  const TD_L: React.CSSProperties = { ...TD, textAlign: 'right' }
  const TD_R: React.CSSProperties = { ...TD, textAlign: 'right' }
  const TD_C: React.CSSProperties = { ...TD, textAlign: 'center' }

  // ---- render dashboard ----
  return (
    <div className="gold-dashboard" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ===== Intro Card ===== */}
      <section style={CARD}>
        <h2 style={{ margin: '0 0 10px 0', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
          黄金：跨越千年的价值锚
        </h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
          黄金是全球公认的<span style={{ color: 'var(--accent-gold)', fontWeight: 600 }}>终极避险资产</span>与<span style={{ color: 'var(--accent-gold)', fontWeight: 600 }}>央行储备核心</span>。
          它稀缺、无信用风险、全球流通，能够在法币贬值、通胀高企或地缘政治动荡时提供价值保护。
          同时，黄金在珠宝、电子与航天等领域拥有实体需求，兼具商品与货币双重属性。
        </p>
        <p style={{ margin: '10px 0 0 0', fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
          <b style={{ color: 'var(--text-primary)' }}>涨跌逻辑：</b>
          黄金以美元计价，<span style={{ color: 'var(--green)' }}>美元走弱</span>时，其他国家买家买黄金更便宜，需求增加，金价容易上涨；反之美元走强，黄金变贵，买盘减少，金价就承压。
          此外黄金本身不生利息，当<span style={{ color: 'var(--green)' }}>利率下降</span>时，存银行和买债券的收益变低，持有黄金的机会成本降低，资金更愿意流入黄金；而当<span style={{ color: 'var(--red)' }}>利率上行、实际收益率抬升</span>时，无息的吸引力下降，黄金容易被抛售。
          <span style={{ color: 'var(--green)' }}>通胀高企</span>会侵蚀纸币购买力，黄金作为保值工具受到追捧；<span style={{ color: 'var(--green)' }}>地缘冲突、经济衰退担忧</span>则会推高避险需求；全球<span style={{ color: 'var(--green)' }}>央行持续购金</span>也会给金价提供长期支撑。
        </p>
      </section>

      {/* ===== Hero Metrics Row ===== */}
      <section style={CARD}>
        <div className="g-grid-3" style={{ display: 'grid', gap: 12 }}>
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

      {/* ===== 5-Year Price Chart + Gold vs DXY (宽屏一行两列) ===== */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(560px, 1fr))',
        gap: 16,
      }}>
        <section style={CARD}>
          <GoldPriceChart data={price!} />
        </section>

        <section style={CARD}>
          <GoldDxyComparisonChart data={price!} />
        </section>
      </div>

      {/* ===== Holdings + 30-Day (2-col) ===== */}
      <div className="g-grid-2" style={{ display: 'grid', gap: 16 }}>
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
          marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid var(--border-light)`,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', letterSpacing: '.03em' }}>
            各国官方黄金储备（Top 40）
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
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
              <tr key={r.country} style={{ borderBottom: `1px solid var(--border-light)` }}>
                <td style={TD}>{i + 1}</td>
                <td style={{ ...TD, fontWeight: 500, color: 'var(--text-primary)' }}>{r.country_cn || r.country}</td>
                <td style={{ ...TD_L, fontFamily: 'var(--font-mono)', color: 'var(--accent-gold)', fontWeight: 600 }}>{r.tonnes.toLocaleString()}</td>
                <td style={TD_R}>{r.share_pct != null ? <span style={{ color: 'var(--accent-cyan)', fontWeight: 500 }}>{r.share_pct.toFixed(1)}%</span> : '—'}</td>
                <td style={{ ...TD_C, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontSize: 11.5 }}>{r.period_date || '—'}</td>
                <td style={TD_C}>{regionTag(r.region)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

// ==================== Small Components ====================

function MetricCard({
  label, unit, value, delta, meta, accent, isPct, range, dateValue, large, rowSpan,
}: {
  label: string; unit: string; value: number | null; delta?: number; meta?: string;
  accent?: 'gold'; isPct?: boolean; range?: string; dateValue?: string; large?: boolean; rowSpan?: number;
}) {
  const positive = (delta ?? 0) >= 0
  const accentColor = accent === 'gold' ? 'var(--accent-gold)' : positive ? 'var(--green)' : 'var(--red)'
  const dimBg = accent === 'gold' ? 'var(--accent-gold-dim)' : positive ? 'var(--green-bg)' : 'var(--red-bg)'

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      borderRadius: 12,
      padding: '16px 18px',
      gridRow: rowSpan ? `span ${rowSpan}` : undefined,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
    }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.08em' }}>
        {label}
      </div>

      {/* main value */}
      {isPct && value != null ? (
        <div style={{ fontSize: large ? 32 : 24, fontWeight: 800, color: Number(value) >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)', lineHeight: 1.2 }}>
          {Number(value) >= 0 ? '+' : ''}{Number(value).toFixed(2)}%
        </div>
      ) : value != null ? (
        <div style={{ fontSize: large ? 32 : 24, fontWeight: 800, color: accentColor, fontFamily: 'var(--font-mono)', lineHeight: 1.2 }}>
          {value.toLocaleString()}{unit ? ' ' + unit : ''}
        </div>
      ) : range ? (
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
          {range}
        </div>
      ) : (
        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>
          {dateValue}
        </div>
      )}

      {/* delta badge */}
      {typeof delta === 'number' && (
        <div style={{
          display: 'inline-block', marginTop: 8, padding: '2px 8px',
          fontSize: 11.5, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '.03em',
          color: positive ? 'var(--green)' : 'var(--red)', background: positive ? 'var(--green-bg)' : 'var(--red-bg)',
        }}>
          {positive ? '\u25B2' : '\u25BC'} {Math.abs(delta).toFixed(2)}%
        </div>
      )}

      {/* meta */}
      {meta && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{meta}</div>}
    </div>
  )
}

function regionTag(region: string | null | undefined): React.ReactNode {
  const map: Record<string, { color: string; label: string }> = {
    US:   { color: 'var(--accent-blue)',  label: '美国' },
    CN:   { color: 'var(--red)',   label: '中国' },
    EUROPE:{ color: 'var(--accent-gold)', label: '欧洲' },
    ASIA: { color: 'var(--accent-cyan)', label: '亚洲' },
    EM:   { color: 'var(--accent-blue)', label: '新兴市场' },
  }
  const tag = map[String(region)]
  return tag
    ? <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 11, color: tag.color, background: tag.color + '26', fontWeight: 600 }}>{tag.label}</span>
    : <span style={{ color: 'var(--text-secondary)', fontSize: 11.5 }}>全球</span>
}

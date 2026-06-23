import { useEffect, useMemo, useState } from 'react'
import { MacroCard } from './ui/MacroCard'
import { useChartTheme } from './ui/theme'
import { LoadingSkeleton } from './ui/LoadingSkeleton'
import { useChart } from './charts/useChart'

interface SeriesData {
  code: string
  nameZh: string
  nameEn: string
  unit: string
  frequency: string
  data: { date: string; value: number | null }[]
}

interface Data {
  series: SeriesData[]
  updatedAt: string
}

function findSeries(data: Data | null, code: string): SeriesData | undefined {
  return data?.series.find((s) => s.code === code)
}

function fmtTrillion(v: number | null): string {
  if (v == null) return '--'
  if (Math.abs(v) >= 1) return `${v.toFixed(2)} 万亿`
  return `${(v * 10000).toFixed(0)} 亿`
}

function FedChart({ series }: { series: SeriesData[] }) {
  const chartTheme = useChartTheme()
  const fed = series.find((s) => s.code === 'FED_BALANCE_SHEET')
  const rrp = series.find((s) => s.code === 'FED_RRP')
  const tga = series.find((s) => s.code === 'FED_TGA')

  const { ref } = useChart(
    useMemo(() => {
      if (!fed?.data.length) return null
      const dates = fed.data.map((p) => p.date)
      const fedVals = fed.data.map((p) => p.value != null ? +(p.value / 1e6).toFixed(4) : null)
      const rrpMap = new Map((rrp?.data || []).map((p) => [p.date, p.value != null ? +(p.value / 1000).toFixed(4) : null]))
      const tgaMap = new Map((tga?.data || []).map((p) => [p.date, p.value != null ? +(p.value / 1e6).toFixed(4) : null]))
      const rrpAligned = dates.map((d) => rrpMap.get(d) ?? null)
      const tgaAligned = dates.map((d) => tgaMap.get(d) ?? null)

      return {
        tooltip: {
          trigger: 'axis', backgroundColor: chartTheme.bgElevated, borderColor: chartTheme.borderLight,
          borderWidth: 1, textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
          formatter: (params: any) => {
            if (!Array.isArray(params) || !params.length) return ''
            const lines = params.map((p: any) => {
              const color = p.color?.colorStops ? chartTheme.cyan : p.color
              const val = p.value != null ? fmtTrillion(p.value) : '--'
              return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle"></span>${p.seriesName}<span style="float:right;margin-left:20px;font-weight:600;color:${color}">${val}</span>`
            })
            return `<div style="font-size:11px;color:${chartTheme.textSecondary};margin-bottom:4px">${params[0].axisValue}</div>${lines.join('')}`
          }
        },
        legend: { data: ['美联储总资产', 'RRP 逆回购', 'TGA 账户'], textStyle: { color: chartTheme.textSecondary, fontSize: 11 }, top: 8, right: 16, itemWidth: 16, itemHeight: 10, itemGap: 16 },
        grid: { left: 64, right: 24, top: 48, bottom: 44 },
        xAxis: { type: 'category', data: dates, axisLabel: { color: chartTheme.textMuted, fontSize: 10 }, axisLine: { lineStyle: { color: chartTheme.borderLight } }, axisTick: { show: false } },
        yAxis: { type: 'value', name: '万亿美元', nameTextStyle: { color: chartTheme.textMuted, fontSize: 10 }, axisLabel: { color: chartTheme.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } }, axisLine: { show: false } },
        dataZoom: [{ type: 'slider', start: 50, end: 100, height: 14, bottom: 4, borderColor: chartTheme.borderLight, backgroundColor: chartTheme.bgCard, fillerColor: chartTheme.goldDim, textStyle: { color: chartTheme.textMuted } }],
        series: [
          { type: 'line', name: '美联储总资产', data: fedVals, smooth: 0.3, showSymbol: false, lineStyle: { width: 2.5, color: chartTheme.cyan }, emphasis: { lineStyle: { width: 3.5 } } },
          { type: 'bar', name: 'RRP 逆回购', data: rrpAligned, itemStyle: { color: chartTheme.gold, borderRadius: [2, 2, 0, 0] }, barMaxWidth: 3 },
          { type: 'line', name: 'TGA 账户', data: tgaAligned, smooth: 0.3, showSymbol: false, lineStyle: { width: 1.8, color: chartTheme.red, type: 'dashed' }, emphasis: { lineStyle: { width: 2.5 } } },
        ],
      } as any
    }, [series, chartTheme]),
    [series, chartTheme],
  )

  if (!fed?.data.length) return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>NO DATA</div>
  return (
    <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: '380px' }} />
    </div>
  )
}

function CbComparisonChart({ series }: { series: SeriesData[] }) {
  const chartTheme = useChartTheme()
  const fed = series.find((s) => s.code === 'FED_BALANCE_SHEET')
  const ecb = series.find((s) => s.code === 'ECB_BALANCE_SHEET')
  const boj = series.find((s) => s.code === 'BOJ_BALANCE_SHEET')

  function toMonthly(data: { date: string; value: number | null }[]): { date: string; value: number | null }[] {
    const map = new Map<string, { date: string; value: number | null }>()
    for (const p of data) {
      if (p.value == null) continue
      const ym = p.date.slice(0, 7)
      const existing = map.get(ym)
      if (!existing || p.date > existing.date) map.set(ym, { date: ym, value: p.value })
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
  }

  const COLORS = { fed: chartTheme.cyan, ecb: chartTheme.blue, boj: chartTheme.gold }
  const DASH = { fed: 'solid', ecb: 'dashed', boj: 'dotted' }
  const LINES = { fed: 2.5, ecb: 1.8, boj: 1.8 }
  const LABELS = { fed: '美联储', ecb: '欧央行', boj: '日央行' }

  const { ref } = useChart(
    useMemo(() => {
      const all: { key: string; monthly: { date: string; value: number }[] }[] = []
      if (fed?.data.length) all.push({ key: 'fed', monthly: toMonthly(fed.data) })
      if (ecb?.data.length) all.push({ key: 'ecb', monthly: toMonthly(ecb.data) })
      if (boj?.data.length) all.push({ key: 'boj', monthly: toMonthly(boj.data) })
      if (all.length < 2) return null

      const monthSets = all.map((a) => new Set(a.monthly.map((p) => p.date)))
      const common = Array.from(monthSets.reduce((a, b) => new Set([...a].filter((x) => b.has(x)))))
      common.sort()
      if (common.length < 2) return null

      const seriesData = all.map((a) => {
        const map = new Map(a.monthly.map((p) => [p.date, p.value]))
        const base = map.get(common[0])
        if (!base) return { key: a.key, vals: common.map(() => null) }
        return { key: a.key, vals: common.map((d) => { const v = map.get(d); return v != null ? +((v / base) * 100).toFixed(2) : null }) }
      })

      // Compute Y-axis range from data
      const allVals = seriesData.flatMap((s) => s.vals.filter((v): v is number => v != null))
      const yMin = Math.floor(Math.min(...allVals) / 2) * 2
      const yMax = Math.ceil(Math.max(...allVals) / 2) * 2 + 2

      return {
        tooltip: {
          trigger: 'axis', backgroundColor: chartTheme.bgElevated, borderColor: chartTheme.borderLight,
          borderWidth: 1, textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
          formatter: (params: any) => {
            if (!Array.isArray(params) || !params.length) return ''
            const lines = params.map((p: any) => {
              const color = COLORS[p.seriesName as keyof typeof COLORS] || p.color
              return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle"></span>${p.seriesName}<span style="float:right;margin-left:20px;font-weight:600;color:${color}">${p.value != null ? p.value.toFixed(1) : '--'}</span>`
            })
            return `<div style="font-size:11px;color:${chartTheme.textSecondary};margin-bottom:4px">${params[0].axisValue}</div>${lines.join('')}`
          }
        },
        legend: {
          data: seriesData.map((s) => LABELS[s.key as keyof typeof LABELS]),
          textStyle: { color: chartTheme.textSecondary, fontSize: 11 }, top: 8, right: 16,
          itemWidth: 16, itemHeight: 10, itemGap: 16
        },
        grid: { left: 52, right: 24, top: 48, bottom: 44 },
        xAxis: {
          type: 'category', data: common,
          axisLabel: { color: chartTheme.textMuted, fontSize: 10, rotate: 30 },
          axisLine: { lineStyle: { color: chartTheme.borderLight } },
          axisTick: { show: false }
        },
        yAxis: {
          type: 'value', min: yMin, max: yMax,
          name: '基准=100', nameTextStyle: { color: chartTheme.textMuted, fontSize: 10, padding: [0, 0, 0, -20] },
          axisLabel: { color: chartTheme.textMuted, fontSize: 10 },
          splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } },
          axisLine: { show: false }
        },
        series: seriesData.map((s) => ({
          type: 'line', name: LABELS[s.key as keyof typeof LABELS], data: s.vals,
          smooth: 0.3, showSymbol: false,
          lineStyle: { width: LINES[s.key as keyof typeof LINES], color: COLORS[s.key as keyof typeof COLORS], type: DASH[s.key as keyof typeof DASH] },
          emphasis: { lineStyle: { width: 3 } },
        } as any)),
        dataZoom: [{ type: 'slider', start: 0, end: 100, height: 14, bottom: 4, borderColor: chartTheme.borderLight, backgroundColor: chartTheme.bgCard, fillerColor: chartTheme.goldDim, textStyle: { color: chartTheme.textMuted } }],
      } as any
    }, [series, chartTheme]),
    [series, chartTheme],
  )

  if (!fed?.data.length) return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>NO DATA</div>
  return (
    <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: '360px' }} />
    </div>
  )
}

function SofrChart({ series }: { series: SeriesData[] }) {
  const chartTheme = useChartTheme()
  const sofr = series.find((s) => s.code === 'SOFR')

  const { ref } = useChart(
    useMemo(() => {
      if (!sofr?.data.length) return null
      const dates = sofr.data.map((p) => p.date)
      const vals = sofr.data.map((p) => p.value)

      return {
        tooltip: {
          trigger: 'axis', backgroundColor: chartTheme.bgElevated, borderColor: chartTheme.borderLight,
          borderWidth: 1, textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
          valueFormatter: (v: any) => v != null ? `${v.toFixed(2)}%` : '--'
        },
        legend: { data: ['SOFR'], textStyle: { color: chartTheme.textSecondary, fontSize: 11 }, top: 8, right: 16, itemWidth: 16, itemHeight: 10 },
        grid: { left: 52, right: 24, top: 48, bottom: 44 },
        xAxis: { type: 'category', data: dates, axisLabel: { color: chartTheme.textMuted, fontSize: 10 }, axisLine: { lineStyle: { color: chartTheme.borderLight } }, axisTick: { show: false } },
        yAxis: { type: 'value', name: '%', nameTextStyle: { color: chartTheme.textMuted, fontSize: 10 }, axisLabel: { color: chartTheme.textMuted, fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } }, axisLine: { show: false } },
        dataZoom: [{ type: 'slider', start: 40, end: 100, height: 14, bottom: 4, borderColor: chartTheme.borderLight, backgroundColor: chartTheme.bgCard, fillerColor: chartTheme.goldDim, textStyle: { color: chartTheme.textMuted } }],
        series: [{ type: 'line', name: 'SOFR', data: vals, smooth: 0.3, showSymbol: false, lineStyle: { width: 2, color: chartTheme.cyan }, emphasis: { lineStyle: { width: 3 } } }],
      } as any
    }, [series, chartTheme]),
    [series, chartTheme],
  )

  if (!sofr?.data.length) return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>NO DATA</div>
  return (
    <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: '300px' }} />
    </div>
  )
}

function HeroNumber({ label, value, unit, color }: { label: string; value: number | null; unit?: string; color?: string }) {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--bg-card)', borderRadius: '10px', border: `1px solid var(--border-light)`, display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: color || 'var(--text-primary)' }}>
        {value == null ? '--' : fmtTrillion(value)}
      </div>
    </div>
  )
}

export default function GlobalLiquidityDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/v1/global-liquidity.json')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!json.success) throw new Error(json.error || '加载失败')
        if (!cancelled) setData(json.data)
      } catch (e: any) {
        if (!cancelled) setError(e.message || '网络错误')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) return <LoadingSkeleton type="card" height={400} />
  if (error) return <div style={{ padding: '14px 18px', borderRadius: '12px', background: 'var(--red-bg)', color: 'var(--red)', fontSize: '13px', border: `1px solid var(--red-bg)` }}>⚠️ {error}</div>
  if (!data) return null

  const fedS = findSeries(data, 'FED_BALANCE_SHEET')
  const rrpS = findSeries(data, 'FED_RRP')
  const tgaS = findSeries(data, 'FED_TGA')
  const sofrS = findSeries(data, 'SOFR')
  const fedLast = fedS?.data?.[fedS.data.length - 1]?.value ?? null
  const fedPrev = fedS?.data?.[fedS.data.length - 2]?.value ?? null
  const fedChange = fedLast != null && fedPrev != null ? ((fedLast - fedPrev) / fedPrev * 100).toFixed(2) : null
  const rrpLast = rrpS?.data?.[rrpS.data.length - 1]?.value ?? null
  const tgaLast = tgaS?.data?.[tgaS.data.length - 1]?.value ?? null
  const sofrLast = sofrS?.data?.[sofrS.data.length - 1]?.value ?? null

  // Check if we have at least some data
  const hasChartData = data.series.some((s) => s.data.length > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <MacroCard title="全球流动性关键指标" variant="elevated">
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: '12px', alignItems: 'stretch' }}>
          <div style={{ padding: '14px 16px', background: 'var(--accent-cyan-dim)', borderRadius: '10px', border: `1px solid var(--accent-cyan)`, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>美联储总资产</div>
            <div style={{ fontSize: '36px', fontWeight: 700, fontFamily: 'var(--font-mono)', lineHeight: 1.1, color: 'var(--accent-cyan)' }}>
              {fedLast == null ? '--' : fmtTrillion(fedLast / 1e6)}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              周变化 {fedChange != null ? `${fedChange.startsWith('-') ? '' : '+'}${fedChange}%` : '--'}
            </div>
          </div>
          <HeroNumber label="RRP 规模" value={rrpLast ? rrpLast / 1000 : null} color='var(--accent-gold)' />
          <HeroNumber label="TGA 余额" value={tgaLast ? tgaLast / 1e6 : null} color='var(--red)' />
          <div style={{ padding: '12px 14px', background: 'var(--bg-card)', borderRadius: '10px', border: `1px solid var(--border-light)`, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>SOFR</div>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>
              {sofrLast == null ? '--' : `${sofrLast.toFixed(2)}%`}
            </div>
          </div>
        </div>
      </MacroCard>

      {hasChartData && (
        <>
          <MacroCard title="美联储资产负债表 vs 流动性回收 (RRP + TGA)" variant="elevated">
            <FedChart series={data.series} />
            <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--text-muted)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <span>● 蓝色线：美联储总资产（万亿美元）</span>
              <span>● 金色柱：RRP 逆回购（万亿美元）——越高说明流动性回收越多</span>
              <span>● 红色虚线：TGA 账户余额（万亿美元）</span>
            </div>
          </MacroCard>

          <MacroCard title="主要央行资产负债表对比 (基准=100)" variant="elevated">
            <CbComparisonChart series={data.series} />
            <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--text-muted)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <span>● 青色：美联储</span>
              <span>● 蓝色：欧央行</span>
              <span>● 金色：日央行</span>
              <span>以最早共同日期为基准 100，展示相对扩张/收缩幅度</span>
            </div>
          </MacroCard>

          <MacroCard title="SOFR — 美元融资成本" variant="elevated">
            <SofrChart series={data.series} />
          </MacroCard>
        </>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { MacroCard } from './ui/MacroCard'
import { useChartTheme } from './ui/theme'
import { LoadingSkeleton } from './ui/LoadingSkeleton'
import { useChart } from './charts/useChart'

interface VixData {
  current: { value: number; change: number; changePercent: number; date: string }
  fearZone: { label: string; key: string; color: string }
  percentile: { pct: number; window: string } | null
  momentum: { value7d: number | null; label: string }
  termStructure: { ratio: number | null; label: string; nearMean: number | null; farMean: number | null }
  spx: number | null
  correlation: Record<string, number>
  stats: Record<string, {
    zScore: number; percentile: number; mean: number; std: number;
    min: number; max: number; dataPoints: number;
  }>
  history: { date: string; value: number }[]
}

// ── Hero mini-cards ──

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

function HeroRow({ data }: { data: VixData }) {
  const chartTheme = useChartTheme()
  const { current, fearZone, percentile, momentum, termStructure } = data
  const changeUp = current.change >= 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px' }}>
      <MiniCard icon="📊" title="VIX 最新" accent={fearZone.color}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '30px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: chartTheme.textPrimary }}>
            {current.value.toFixed(2)}
          </span>
          <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: changeUp ? chartTheme.red : chartTheme.green }}>
            {changeUp ? '↑' : '↓'} {Math.abs(current.change).toFixed(2)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
          <span style={{
            display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
            background: fearZone.color,
          }} />
          <span style={{ fontSize: '12px', fontWeight: 600, color: fearZone.color }}>{fearZone.label}</span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto' }}>{current.date}</span>
        </div>
      </MiniCard>

      <MiniCard icon="📈" title={`百分位 (${percentile?.window || '--'})`}>
        <div style={{ fontSize: '30px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: chartTheme.blue }}>
          {percentile != null ? `${percentile.pct.toFixed(1)}%` : '--'}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {percentile != null
            ? (percentile.pct < 25 ? '历史低位区间' : percentile.pct < 50 ? '偏低区间' : percentile.pct < 75 ? '偏高区间' : '历史高位区间')
            : '暂无数据'}
        </div>
      </MiniCard>

      <MiniCard icon="⚡" title="7日动量">
        <div style={{ fontSize: '28px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: momentum.value7d != null ? (momentum.value7d < 0 ? chartTheme.green : chartTheme.red) : chartTheme.textMuted }}>
          {momentum.value7d != null ? `${momentum.value7d > 0 ? '+' : ''}${momentum.value7d.toFixed(2)}` : '--'}
        </div>
        <div style={{
          fontSize: '11px', fontWeight: 600, marginTop: '2px',
          color: momentum.label === '快速回落' ? chartTheme.green
            : momentum.label === '快速攀升' ? chartTheme.red
            : chartTheme.textSecondary,
        }}>
          {momentum.label}
        </div>
      </MiniCard>

      <MiniCard icon="📐" title="期限结构">
        <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: chartTheme.cyan }}>
          {termStructure.ratio != null ? termStructure.ratio.toFixed(3) : '--'}
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.4 }}>
          {termStructure.label !== '--'
            ? `${termStructure.label} · 近月均值 ${termStructure.nearMean?.toFixed(1) ?? '--'} vs 远月 ${termStructure.farMean?.toFixed(1) ?? '--'}`
            : '暂无数据'}
        </div>
      </MiniCard>
    </div>
  )
}

// ── Fear zone legend strip ──

function FearZoneStrip({ current }: { current: number }) {
  const chartTheme = useChartTheme()
  const zones = [
    { label: '极度平静', range: '< 15', color: chartTheme.green, bg: chartTheme.greenBg, max: 15 },
    { label: '正常波动', range: '15-25', color: chartTheme.cyan, bg: chartTheme.cyanDim, max: 25 },
    { label: '偏高警戒', range: '25-35', color: chartTheme.gold, bg: chartTheme.goldDim, max: 35 },
    { label: '恐慌市场', range: '> 35', color: chartTheme.red, bg: chartTheme.redBg, max: Infinity },
  ]
  const activeIdx = zones.findIndex(z => current <= z.max)

  return (
    <div style={{
      display: 'flex', borderRadius: '12px', overflow: 'hidden',
      background: 'var(--bg-card)',
    }}>
      {zones.map((z, i) => (
        <div key={z.label} style={{
          flex: 1, padding: '14px 12px', textAlign: 'center',
          background: i === activeIdx ? z.bg : 'transparent',
          borderRight: i < zones.length - 1 ? `1px solid var(--border-light)` : 'none',
          transition: 'all 0.2s ease',
        }}>
          <div style={{
            fontSize: '14px', fontWeight: i === activeIdx ? 700 : 500,
            color: i === activeIdx ? z.color : 'var(--text-muted)',
            marginBottom: '2px',
          }}>
            {z.label}
          </div>
          <div style={{
            fontSize: '12px', fontFamily: 'var(--font-mono)',
            color: i === activeIdx ? z.color : 'var(--text-muted)',
            opacity: i === activeIdx ? 1 : 0.5,
          }}>
            {z.range}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── VIX chart ──

function VixChart({ history }: { history: { date: string; value: number }[] }) {
  const chartTheme = useChartTheme()
  const { ref } = useChart(
    useMemo(() => {
      if (!history.length) return null
      const dates = history.map(p => p.date)
      const values = history.map(p => p.value)
      const yMax = Math.max(55, ...values.map(v => Math.ceil(v / 5) * 5))

      // 四个情绪分区定义（从低到高）
      const zones = [
        { min: 0, max: 15, label: '极度平静', color: chartTheme.green, bg: chartTheme.greenBg },
        { min: 15, max: 25, label: '正常波动', color: chartTheme.cyan, bg: chartTheme.cyanDim },
        { min: 25, max: 35, label: '偏高警戒', color: chartTheme.gold, bg: chartTheme.goldDim },
        { min: 35, max: Infinity, label: '恐慌市场', color: chartTheme.red, bg: chartTheme.redBg },
      ]

      return {
        tooltip: {
          trigger: 'axis', backgroundColor: chartTheme.bgElevated, borderColor: chartTheme.borderLight,
          borderWidth: 1, textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
          formatter: (params: any) => {
            const p = params[0]
            if (!p) return ''
            const v = p.value
            const zone = v > 35 ? '恐慌市场' : v > 25 ? '偏高警戒' : v > 15 ? '正常波动' : '极度平静'
            return `<div style="font-size:11px;color:${chartTheme.textSecondary};margin-bottom:4px">${p.axisValue}</div>
VIX: <strong style="color:${chartTheme.red}">${v}</strong>
状态: <span style="color:${v > 25 ? chartTheme.red : chartTheme.cyan}">${zone}</span>`
          },
        },
        grid: { left: 52, right: 80, top: 16, bottom: 50 },
        xAxis: {
          type: 'category', data: dates, axisLabel: { color: chartTheme.textMuted, fontSize: 9, showMaxLabel: true },
          axisLine: { lineStyle: { color: chartTheme.borderLight } }, axisTick: { show: false },
        },
        yAxis: {
          type: 'value', name: 'VIX', nameTextStyle: { color: chartTheme.textMuted, fontSize: 10 },
          min: 0,
          max: yMax + 5,
          axisLabel: { color: chartTheme.textMuted, fontSize: 10 },
          splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } },
          axisLine: { show: false },
        },
        dataZoom: [{ type: 'slider', start: 0, end: 100, height: 16, bottom: 4, borderColor: chartTheme.borderLight, backgroundColor: chartTheme.bgCard, fillerColor: chartTheme.redBg, textStyle: { color: chartTheme.textMuted }, handleIcon: 'path://M0,0 v9h9v-9H0z M-11,-1 h22v11 h-22 Z M-11,10 h22v11 h-22 Z', handleSize: '80%', handleStyle: { color: chartTheme.red, borderColor: chartTheme.red } }],
        series: [
          // 区域 1：极度平静 (0-15)
          {
            name: '__zone_极度平静', type: 'line', stack: '__zones',
            data: Array(dates.length).fill(15), symbol: 'none',
            lineStyle: { opacity: 0 }, areaStyle: { color: chartTheme.greenBg },
            silent: true, zlevel: 0, tooltip: { show: false },
          },
          // 区域 2：正常波动 (15-25)
          {
            name: '__zone_正常波动', type: 'line', stack: '__zones',
            data: Array(dates.length).fill(10), symbol: 'none',
            lineStyle: { opacity: 0 }, areaStyle: { color: chartTheme.cyanDim },
            silent: true, zlevel: 0, tooltip: { show: false },
          },
          // 区域 3：偏高警戒 (25-35)
          {
            name: '__zone_偏高警戒', type: 'line', stack: '__zones',
            data: Array(dates.length).fill(10), symbol: 'none',
            lineStyle: { opacity: 0 }, areaStyle: { color: chartTheme.goldDim },
            silent: true, zlevel: 0, tooltip: { show: false },
          },
          // 区域 4：恐慌市场 (35 到 yMax)
          {
            name: '__zone_恐慌市场', type: 'line', stack: '__zones',
            data: Array(dates.length).fill(yMax - 35), symbol: 'none',
            lineStyle: { opacity: 0 }, areaStyle: { color: chartTheme.redBg },
            silent: true, zlevel: 0, tooltip: { show: false },
          },
          // VIX 主线
          {
            type: 'line', data: values, smooth: 0.3, showSymbol: false,
            lineStyle: { width: 2.5, color: chartTheme.red },
            zlevel: 2,
            markLine: {
              symbol: ['none', 'none'], animation: false,
              data: zones.map((z) => ({
                yAxis: z.min,
                lineStyle: { color: z.color, width: 1, type: 'dashed' },
                label: {
                  show: true, position: 'insideEndTop',
                  formatter: z.min + '  ' + z.label,
                  color: z.color, fontSize: 10, fontWeight: 700, fontFamily: chartTheme.fontMono,
                  backgroundColor: chartTheme.bgElevated, padding: [2, 6], borderRadius: 4,
                },
              })),
            },
          },
        ],
      } as any
    }, [history, chartTheme]),
    [history, chartTheme],
  )

  if (!history.length) return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>暂无数据</div>
  return (
    <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: '380px' }} />
    </div>
  )
}

// ── Stats table ──

function StatsTable({ stats }: { stats: VixData['stats'] }) {
  const chartTheme = useChartTheme()
  const keys = ['1Y', '3Y', '5Y', '10Y', '20Y']
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: `1px solid var(--border-light)` }}>窗口</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: `1px solid var(--border-light)` }}>Z-Score</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: `1px solid var(--border-light)` }}>百分位</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: `1px solid var(--border-light)` }}>均值</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: `1px solid var(--border-light)` }}>标准差</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: `1px solid var(--border-light)` }}>最低</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: `1px solid var(--border-light)` }}>最高</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: `1px solid var(--border-light)` }}>样本</th>
          </tr>
        </thead>
        <tbody>
          {keys.map(key => {
            const s = stats[key]
            if (!s) return null
            const zColor = s.zScore > 1 ? chartTheme.red : s.zScore < -1 ? chartTheme.green : chartTheme.textSecondary
            return (
              <tr key={key} style={{ borderBottom: `1px solid var(--border-light)` }}>
                <td style={{ padding: '8px 12px', color: 'var(--text-primary)', fontWeight: 600 }}>{key}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: zColor, fontWeight: 700 }}>{s.zScore.toFixed(2)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: chartTheme.textSecondary }}>{s.percentile.toFixed(1)}%</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: chartTheme.textSecondary }}>{s.mean.toFixed(2)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: chartTheme.textSecondary }}>{s.std.toFixed(2)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: chartTheme.textSecondary }}>{s.min.toFixed(2)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: chartTheme.textSecondary }}>{s.max.toFixed(2)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-muted)' }}>{s.dataPoints}天</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── SPX vs VIX chart ──

function SpxVixChart({ history, correlation }: { history: { date: string; value: number }[]; correlation: Record<string, number> }) {
  const chartTheme = useChartTheme()
  const { ref } = useChart(
    useMemo(() => {
      if (!history.length) return null
      const dates = history.map(p => p.date)
      const values = history.map(p => p.value)
      const yMax = Math.max(55, ...values.map(v => Math.ceil(v / 5) * 5))

      return {
        tooltip: {
          trigger: 'axis', backgroundColor: chartTheme.bgElevated, borderColor: chartTheme.borderLight,
          borderWidth: 1, textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
          formatter: (params: any) => {
            const vixP = params.find((p: any) => p.seriesName === 'VIX')
            const spxP = params.find((p: any) => p.seriesName === 'SPX 反转')
            return `<div style="font-size:11px;color:${chartTheme.textSecondary};margin-bottom:4px">${params[0]?.axisValue ?? ''}</div>
VIX: <strong style="color:${chartTheme.red}">${vixP?.value ?? '--'}</strong><br/>
SPX: <strong style="color:${chartTheme.blue}">${spxP?.value ?? '--'}</strong>`
          },
        },
        legend: { data: ['VIX', 'SPX 反转'], textStyle: { color: chartTheme.textSecondary, fontSize: 11 }, top: 4, right: 16, itemWidth: 16, itemHeight: 10, itemGap: 16 },
        grid: { left: 48, right: 56, top: 40, bottom: 50 },
        xAxis: { type: 'category', data: dates, axisLabel: { color: chartTheme.textMuted, fontSize: 9, showMaxLabel: true }, axisLine: { lineStyle: { color: chartTheme.borderLight } }, axisTick: { show: false } },
        yAxis: [
          { type: 'value', name: 'VIX', nameTextStyle: { color: chartTheme.textMuted, fontSize: 10 }, axisLabel: { color: chartTheme.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } }, axisLine: { show: false } },
          { type: 'value', name: 'SPX (反转)', nameTextStyle: { color: chartTheme.textMuted, fontSize: 10 }, axisLabel: { color: chartTheme.blue, fontSize: 10 }, splitLine: { show: false }, inverse: true, axisLine: { show: false } },
        ],
        dataZoom: [{ type: 'slider', start: 40, end: 100, height: 16, bottom: 4, borderColor: chartTheme.borderLight, backgroundColor: chartTheme.bgCard, fillerColor: chartTheme.blueDim, textStyle: { color: chartTheme.textMuted }, handleIcon: 'path://M0,0 v9h9v-9H0z M-11,-1 h22v11 h-22 Z M-11,10 h22v11 h-22 Z', handleSize: '80%', handleStyle: { color: chartTheme.blue, borderColor: chartTheme.blue } }],
        series: [
          { type: 'line', name: 'VIX', data: values, smooth: 0.3, showSymbol: false, lineStyle: { width: 2, color: chartTheme.red }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: chartTheme.redBg }, { offset: 1, color: 'transparent' }] } } },
          { type: 'line', name: 'SPX 反转', data: values, smooth: 0.3, showSymbol: false, lineStyle: { width: 1.5, color: chartTheme.blue, type: 'dashed' }, yAxisIndex: 1 },
        ],
      } as any
    }, [history, chartTheme]),
    [history, chartTheme],
  )

  if (!history.length) return null
  return (
    <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 8px' }}>
        <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>VIX vs SPX</div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          60日相关性: {correlation['60d']?.toFixed(2) ?? '--'}
        </div>
      </div>
      <div ref={ref} style={{ width: '100%', height: '300px' }} />
    </div>
  )
}

// ── Signal card ──

function SignalCard({ stats, current }: { stats: VixData['stats']; current: number }) {
  const chartTheme = useChartTheme()
  const signals: { label: string; value: string; color: string; desc: string }[] = []

  for (const [key, s] of Object.entries(stats)) {
    if (!s) continue
    if (s.zScore > 1.5) {
      signals.push({
        label: `${key} 均值回归信号`,
        value: `Z=${s.zScore.toFixed(2)}`,
        color: chartTheme.green,
        desc: `VIX ${current.toFixed(1)} 高于 ${key} 均值 ${(current - s.mean).toFixed(1)} 点（+${s.zScore.toFixed(1)}σ），历史上这种极端后倾向于均值回归，可能是 SPX 反弹信号`,
      })
    } else if (s.zScore < -1.0) {
      signals.push({
        label: `${key} 低位谨慎`,
        value: `Z=${s.zScore.toFixed(2)}`,
        color: chartTheme.gold,
        desc: `VIX ${current.toFixed(1)} 低于 ${key} 均值 ${(s.mean - current).toFixed(1)} 点，波动率偏低，市场过于乐观，警惕突发事件导致 VIX 跳升`,
      })
    }
  }

  if (signals.length === 0) {
    signals.push({
      label: '无显著信号',
      value: '正常区间',
      color: chartTheme.blue,
      desc: `VIX ${current.toFixed(1)} 目前处于所有时间窗口的正常范围内，无极端偏离`,
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {signals.map((sig, i) => (
        <div key={i} style={{
          padding: '10px 14px', borderRadius: '10px',
          background: chartTheme.greenBg && sig.color === chartTheme.green ? chartTheme.greenBg
            : chartTheme.goldDim && sig.color === chartTheme.gold ? chartTheme.goldDim
            : chartTheme.blueDim,
          border: `1px solid ${sig.color}`,
          opacity: 0.9,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{
              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
              padding: '2px 8px', borderRadius: '4px',
              background: sig.color, color: '#FFFFFF',
            }}>
              {sig.value}
            </span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{sig.label}</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{sig.desc}</div>
        </div>
      ))}
    </div>
  )
}

// ── Main dashboard ──

export function VixDashboard() {
  const chartTheme = useChartTheme()
  const [data, setData] = useState<VixData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/v1/vix.json')
      .then(r => r.json())
      .then(res => {
        if (!res.success) { setError(res.error || '请求失败'); return }
        setData(res.data)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSkeleton type="chart" height={500} />
  if (error) return <div style={{ padding: '40px', textAlign: 'center', color: chartTheme.red, fontSize: '14px' }}>{error}</div>
  if (!data) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>暂无 VIX 数据</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <HeroRow data={data} />

      <MacroCard title="恐慌范围">
        <FearZoneStrip current={data.current.value} />
      </MacroCard>

      <MacroCard title="VIX 波动率走势">
        <VixChart history={data.history} />
      </MacroCard>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <MacroCard title="VIX 统计指标">
          <StatsTable stats={data.stats} />
        </MacroCard>
        <MacroCard title="VIX vs SPX">
          <SpxVixChart history={data.history} correlation={data.correlation} />
        </MacroCard>
      </div>

      <MacroCard title="VIX 均值回归信号">
        <SignalCard stats={data.stats} current={data.current.value} />
      </MacroCard>

      <div style={{
        padding: '12px 16px', background: 'var(--bg-card)', borderRadius: '12px',
        fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.8,
      }}>
        <strong style={{ color: 'var(--text-secondary)' }}>数据说明：</strong>
        VIX（CBOE Volatility Index）是标普500指数隐含波动率的衡量指标，被称为"恐慌指数"。
        恐慌范围：<strong style={{ color: chartTheme.green }}>&lt;15 极度平静</strong> · <strong style={{ color: chartTheme.cyan }}>15-25 正常波动</strong> · <strong style={{ color: chartTheme.gold }}>25-35 偏高警戒</strong> · <strong style={{ color: chartTheme.red }}>&gt;35 恐慌市场</strong>。
        期限结构比值 = 近22日均值 / 近63日均值，&lt;0.95 为 Contango，&gt;1.05 为 Backwardation。
        数据来源：FRED（VIXCLS），日频更新。
      </div>
    </div>
  )
}

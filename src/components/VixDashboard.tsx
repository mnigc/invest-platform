import { useEffect, useMemo, useState } from 'react'
import { MacroCard } from './ui/MacroCard'
import { THEME } from './ui/theme'
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

const FEAR_ZONE_BG: Record<string, string> = {
  calm: 'rgba(8,153,129,0.12)',
  normal: 'rgba(6,182,212,0.12)',
  alert: 'rgba(245,158,11,0.12)',
  panic: 'rgba(242,54,69,0.15)',
}

// ── Hero mini-cards ──

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

function HeroRow({ data }: { data: VixData }) {
  const { current, fearZone, percentile, momentum, termStructure } = data
  const changeUp = current.change >= 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px' }}>
      <MiniCard icon="📊" title="VIX 最新" accent={fearZone.color}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '30px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary }}>
            {current.value.toFixed(2)}
          </span>
          <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: THEME.fontMono, color: changeUp ? THEME.red : THEME.green }}>
            {changeUp ? '↑' : '↓'} {Math.abs(current.change).toFixed(2)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
          <span style={{
            display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
            background: fearZone.color,
          }} />
          <span style={{ fontSize: '12px', fontWeight: 600, color: fearZone.color }}>{fearZone.label}</span>
          <span style={{ fontSize: '10px', color: THEME.textMuted, marginLeft: 'auto' }}>{current.date}</span>
        </div>
      </MiniCard>

      <MiniCard icon="📈" title={`百分位 (${percentile?.window || '--'})`}>
        <div style={{ fontSize: '30px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.blue }}>
          {percentile != null ? `${percentile.pct.toFixed(1)}%` : '--'}
        </div>
        <div style={{ fontSize: '11px', color: THEME.textSecondary, marginTop: '2px' }}>
          {percentile != null
            ? (percentile.pct < 25 ? '历史低位区间' : percentile.pct < 50 ? '偏低区间' : percentile.pct < 75 ? '偏高区间' : '历史高位区间')
            : '暂无数据'}
        </div>
      </MiniCard>

      <MiniCard icon="⚡" title="7日动量">
        <div style={{ fontSize: '28px', fontWeight: 700, fontFamily: THEME.fontMono, color: momentum.value7d != null ? (momentum.value7d < 0 ? THEME.green : THEME.red) : THEME.textMuted }}>
          {momentum.value7d != null ? `${momentum.value7d > 0 ? '+' : ''}${momentum.value7d.toFixed(2)}` : '--'}
        </div>
        <div style={{
          fontSize: '11px', fontWeight: 600, marginTop: '2px',
          color: momentum.label === '快速回落' ? THEME.green
            : momentum.label === '快速攀升' ? THEME.red
            : THEME.textSecondary,
        }}>
          {momentum.label}
        </div>
      </MiniCard>

      <MiniCard icon="📐" title="期限结构">
        <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.cyan }}>
          {termStructure.ratio != null ? termStructure.ratio.toFixed(3) : '--'}
        </div>
        <div style={{ fontSize: '10px', color: THEME.textSecondary, marginTop: '2px', lineHeight: 1.4 }}>
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
  const zones = [
    { label: '极度平静', range: '< 15', color: '#089981', max: 15 },
    { label: '正常波动', range: '15-25', color: '#06b6d4', max: 25 },
    { label: '偏高警戒', range: '25-35', color: '#f59e0b', max: 35 },
    { label: '恐慌市场', range: '> 35', color: '#f23645', max: Infinity },
  ]
  const activeIdx = zones.findIndex(z => current <= z.max)

  return (
    <div style={{
      display: 'flex', borderRadius: '12px', overflow: 'hidden',
      background: THEME.bgCard,
      border: `1px solid ${THEME.borderLight}`,
    }}>
      {zones.map((z, i) => (
        <div key={z.label} style={{
          flex: 1, padding: '14px 12px', textAlign: 'center',
          background: i === activeIdx ? `${z.color}20` : 'transparent',
          borderRight: i < zones.length - 1 ? `1px solid ${THEME.borderLight}` : 'none',
          transition: 'all 0.2s ease',
        }}>
          <div style={{
            fontSize: '14px', fontWeight: i === activeIdx ? 700 : 500,
            color: i === activeIdx ? z.color : THEME.textMuted,
            marginBottom: '2px',
          }}>
            {z.label}
          </div>
          <div style={{
            fontSize: '12px', fontFamily: THEME.fontMono,
            color: i === activeIdx ? z.color : THEME.textMuted,
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
  const { ref } = useChart(
    useMemo(() => {
      if (!history.length) return null
      const dates = history.map(p => p.date)
      const values = history.map(p => p.value)
      const yMax = Math.max(55, ...values.map(v => Math.ceil(v / 5) * 5))

      // 四个情绪分区定义（从低到高）
      const zones = [
        { min: 0, max: 15, label: '极度平静', color: '#22c55e', bg: 'rgba(34,197,94,0.35)' },
        { min: 15, max: 25, label: '正常波动', color: '#38bdf8', bg: 'rgba(56,189,248,0.25)' },
        { min: 25, max: 35, label: '偏高警戒', color: '#f59e0b', bg: 'rgba(245,158,11,0.20)' },
        { min: 35, max: Infinity, label: '恐慌市场', color: '#f23645', bg: 'rgba(242,54,69,0.25)' },
      ]

      return {
        tooltip: {
          trigger: 'axis', backgroundColor: 'rgba(13,17,28,0.95)', borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1, textStyle: { color: '#e2e8f0', fontSize: 12 },
          formatter: (params: any) => {
            const p = params[0]
            if (!p) return ''
            const v = p.value
            const zone = v > 35 ? '恐慌市场' : v > 25 ? '偏高警戒' : v > 15 ? '正常波动' : '极度平静'
            return `<div style="font-size:11px;color:#94a3b8;margin-bottom:4px">${p.axisValue}</div>
VIX: <strong style="color:#f23645">${v}</strong>
状态: <span style="color:${v > 25 ? '#f23645' : '#06b6d4'}">${zone}</span>`
          },
        },
        grid: { left: 52, right: 80, top: 16, bottom: 50 },
        xAxis: {
          type: 'category', data: dates, axisLabel: { color: '#64748b', fontSize: 9, showMaxLabel: true },
          axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } }, axisTick: { show: false },
        },
        yAxis: {
          type: 'value', name: 'VIX', nameTextStyle: { color: '#64748b', fontSize: 10 },
          min: 0,
          max: yMax + 5,
          axisLabel: { color: '#64748b', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)', type: 'dashed' } },
          axisLine: { show: false },
        },
        dataZoom: [{ type: 'slider', start: 0, end: 100, height: 16, bottom: 4, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(19,23,34,0.6)', fillerColor: 'rgba(242,54,69,0.12)', textStyle: { color: '#64748b' } }],
        series: [
          // 区域 1：极度平静 (0-15) — 亮绿
          {
            name: '__zone_极度平静', type: 'line', stack: '__zones',
            data: Array(dates.length).fill(15), symbol: 'none',
            lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(34,197,94,0.35)' },
            silent: true, zlevel: 0, tooltip: { show: false },
          },
          // 区域 2：正常波动 (15-25) — 淡蓝
          {
            name: '__zone_正常波动', type: 'line', stack: '__zones',
            data: Array(dates.length).fill(10), symbol: 'none',
            lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(56,189,248,0.25)' },
            silent: true, zlevel: 0, tooltip: { show: false },
          },
          // 区域 3：偏高警戒 (25-35)
          {
            name: '__zone_偏高警戒', type: 'line', stack: '__zones',
            data: Array(dates.length).fill(10), symbol: 'none',
            lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(245,158,11,0.20)' },
            silent: true, zlevel: 0, tooltip: { show: false },
          },
          // 区域 4：恐慌市场 (35 到 yMax)
          {
            name: '__zone_恐慌市场', type: 'line', stack: '__zones',
            data: Array(dates.length).fill(yMax - 35), symbol: 'none',
            lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(242,54,69,0.25)' },
            silent: true, zlevel: 0, tooltip: { show: false },
          },
          // VIX 主线
          {
            type: 'line', data: values, smooth: 0.3, showSymbol: false,
            lineStyle: { width: 2.5, color: '#f23645' },
            zlevel: 2,
            markLine: {
              symbol: ['none', 'none'], animation: false,
              data: zones.map((z) => ({
                yAxis: z.min,
                lineStyle: { color: z.color, width: 1, type: 'dashed' },
                label: {
                  show: true, position: 'insideEndTop',
                  formatter: z.min + '  ' + z.label,
                  color: z.color, fontSize: 10, fontWeight: 700, fontFamily: THEME.fontMono,
                  backgroundColor: 'rgba(13,17,28,0.85)', padding: [2, 6], borderRadius: 4,
                },
              })),
            },
          },
        ],
      } as any
    }, [history]),
    [history],
  )

  if (!history.length) return <div style={{ padding: '40px 0', textAlign: 'center', color: THEME.textMuted, fontSize: '13px' }}>暂无数据</div>
  return (
    <div style={{ width: '100%', background: THEME.bgCard, borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: '380px' }} />
    </div>
  )
}

// ── Stats table ──

function StatsTable({ stats }: { stats: VixData['stats'] }) {
  const keys = ['1Y', '3Y', '5Y', '10Y', '20Y']
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontFamily: THEME.fontMono }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: THEME.textMuted, fontWeight: 600, borderBottom: `1px solid ${THEME.borderLight}` }}>窗口</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: THEME.textMuted, fontWeight: 600, borderBottom: `1px solid ${THEME.borderLight}` }}>Z-Score</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: THEME.textMuted, fontWeight: 600, borderBottom: `1px solid ${THEME.borderLight}` }}>百分位</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: THEME.textMuted, fontWeight: 600, borderBottom: `1px solid ${THEME.borderLight}` }}>均值</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: THEME.textMuted, fontWeight: 600, borderBottom: `1px solid ${THEME.borderLight}` }}>标准差</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: THEME.textMuted, fontWeight: 600, borderBottom: `1px solid ${THEME.borderLight}` }}>最低</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: THEME.textMuted, fontWeight: 600, borderBottom: `1px solid ${THEME.borderLight}` }}>最高</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: THEME.textMuted, fontWeight: 600, borderBottom: `1px solid ${THEME.borderLight}` }}>样本</th>
          </tr>
        </thead>
        <tbody>
          {keys.map(key => {
            const s = stats[key]
            if (!s) return null
            const zColor = s.zScore > 1 ? THEME.red : s.zScore < -1 ? THEME.green : THEME.textSecondary
            return (
              <tr key={key} style={{ borderBottom: `1px solid ${THEME.borderLight}` }}>
                <td style={{ padding: '8px 12px', color: THEME.textPrimary, fontWeight: 600 }}>{key}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: zColor, fontWeight: 700 }}>{s.zScore.toFixed(2)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: THEME.textSecondary }}>{s.percentile.toFixed(1)}%</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: THEME.textSecondary }}>{s.mean.toFixed(2)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: THEME.textSecondary }}>{s.std.toFixed(2)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: THEME.textSecondary }}>{s.min.toFixed(2)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: THEME.textSecondary }}>{s.max.toFixed(2)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: THEME.textMuted }}>{s.dataPoints}天</td>
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
  const { ref } = useChart(
    useMemo(() => {
      if (!history.length) return null
      const dates = history.map(p => p.date)
      const values = history.map(p => p.value)
      const yMax = Math.max(55, ...values.map(v => Math.ceil(v / 5) * 5))

      return {
        tooltip: {
          trigger: 'axis', backgroundColor: 'rgba(13,17,28,0.95)', borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1, textStyle: { color: '#e2e8f0', fontSize: 12 },
          formatter: (params: any) => {
            const vixP = params.find((p: any) => p.seriesName === 'VIX')
            const spxP = params.find((p: any) => p.seriesName === 'SPX 反转')
            return `<div style="font-size:11px;color:#94a3b8;margin-bottom:4px">${params[0]?.axisValue ?? ''}</div>
VIX: <strong style="color:#f23645">${vixP?.value ?? '--'}</strong><br/>
SPX: <strong style="color:#3b82f6">${spxP?.value ?? '--'}</strong>`
          },
        },
        legend: { data: ['VIX', 'SPX 反转'], textStyle: { color: '#94a3b8', fontSize: 11 }, top: 4, right: 16, itemWidth: 16, itemHeight: 10, itemGap: 16 },
        grid: { left: 48, right: 56, top: 40, bottom: 50 },
        xAxis: { type: 'category', data: dates, axisLabel: { color: '#64748b', fontSize: 9, showMaxLabel: true }, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } }, axisTick: { show: false } },
        yAxis: [
          { type: 'value', name: 'VIX', nameTextStyle: { color: '#64748b', fontSize: 10 }, axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)', type: 'dashed' } }, axisLine: { show: false } },
          { type: 'value', name: 'SPX (反转)', nameTextStyle: { color: '#64748b', fontSize: 10 }, axisLabel: { color: '#3b82f6', fontSize: 10 }, splitLine: { show: false }, inverse: true, axisLine: { show: false } },
        ],
        dataZoom: [{ type: 'slider', start: 40, end: 100, height: 16, bottom: 4, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(19,23,34,0.6)', fillerColor: 'rgba(59,130,246,0.12)', textStyle: { color: '#64748b' } }],
        series: [
          { type: 'line', name: 'VIX', data: values, smooth: 0.3, showSymbol: false, lineStyle: { width: 2, color: '#f23645' }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(242,54,69,0.2)' }, { offset: 1, color: 'rgba(242,54,69,0.01)' }] } } },
          { type: 'line', name: 'SPX 反转', data: values, smooth: 0.3, showSymbol: false, lineStyle: { width: 1.5, color: '#3b82f6', type: 'dashed' }, yAxisIndex: 1 },
        ],
      } as any
    }, [history]),
    [history],
  )

  if (!history.length) return null
  return (
    <div style={{ width: '100%', background: THEME.bgCard, borderRadius: '12px', padding: '12px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 8px' }}>
        <div style={{ fontSize: '13px', color: THEME.textPrimary, fontWeight: 600 }}>VIX vs SPX</div>
        <div style={{ fontSize: '10px', color: THEME.textMuted, fontFamily: THEME.fontMono }}>
          60日相关性: {correlation['60d']?.toFixed(2) ?? '--'}
        </div>
      </div>
      <div ref={ref} style={{ width: '100%', height: '300px' }} />
    </div>
  )
}

// ── Signal card ──

function SignalCard({ stats, current }: { stats: VixData['stats']; current: number }) {
  const signals: { label: string; value: string; color: string; desc: string }[] = []

  for (const [key, s] of Object.entries(stats)) {
    if (!s) continue
    if (s.zScore > 1.5) {
      signals.push({
        label: `${key} 均值回归信号`,
        value: `Z=${s.zScore.toFixed(2)}`,
        color: THEME.green,
        desc: `VIX ${current.toFixed(1)} 高于 ${key} 均值 ${(current - s.mean).toFixed(1)} 点（+${s.zScore.toFixed(1)}σ），历史上这种极端后倾向于均值回归，可能是 SPX 反弹信号`,
      })
    } else if (s.zScore < -1.0) {
      signals.push({
        label: `${key} 低位谨慎`,
        value: `Z=${s.zScore.toFixed(2)}`,
        color: '#f59e0b',
        desc: `VIX ${current.toFixed(1)} 低于 ${key} 均值 ${(s.mean - current).toFixed(1)} 点，波动率偏低，市场过于乐观，警惕突发事件导致 VIX 跳升`,
      })
    }
  }

  if (signals.length === 0) {
    signals.push({
      label: '无显著信号',
      value: '正常区间',
      color: THEME.blue,
      desc: `VIX ${current.toFixed(1)} 目前处于所有时间窗口的正常范围内，无极端偏离`,
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {signals.map((sig, i) => (
        <div key={i} style={{
          padding: '10px 14px', borderRadius: '10px',
          background: `${sig.color}10`,
          border: `1px solid ${sig.color}30`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{
              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
              padding: '2px 8px', borderRadius: '4px',
              background: sig.color, color: '#fff',
            }}>
              {sig.value}
            </span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.textPrimary }}>{sig.label}</span>
          </div>
          <div style={{ fontSize: '12px', color: THEME.textSecondary, lineHeight: 1.6 }}>{sig.desc}</div>
        </div>
      ))}
    </div>
  )
}

// ── Main dashboard ──

export function VixDashboard() {
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
  if (error) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.red, fontSize: '14px' }}>{error}</div>
  if (!data) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMuted, fontSize: '14px' }}>暂无 VIX 数据</div>

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
        padding: '12px 16px', background: THEME.bgCard, borderRadius: '12px',
        border: `1px solid ${THEME.borderLight}`,
        fontSize: '11px', color: THEME.textMuted, lineHeight: 1.8,
      }}>
        <strong style={{ color: THEME.textSecondary }}>数据说明：</strong>
        VIX（CBOE Volatility Index）是标普500指数隐含波动率的衡量指标，被称为"恐慌指数"。
        恐慌范围：<strong style={{ color: '#089981' }}>&lt;15 极度平静</strong> · <strong style={{ color: '#06b6d4' }}>15-25 正常波动</strong> · <strong style={{ color: '#f59e0b' }}>25-35 偏高警戒</strong> · <strong style={{ color: '#f23645' }}>&gt;35 恐慌市场</strong>。
        期限结构比值 = 近22日均值 / 近63日均值，&lt;0.95 为 Contango，&gt;1.05 为 Backwardation。
        数据来源：FRED（VIXCLS），日频更新。
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import echarts from '../../lib/echarts'
import { useChart } from '../charts/useChart'
import { useChartTheme } from '../ui/theme'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'

type Direction = 'bullish' | 'bearish' | 'neutral'
type Strength = 'strong' | 'moderate' | 'weak'

interface HorizonStat {
  n: number
  mean: number
  median: number
  winRate: number
  p25: number
  p75: number
  best: number
  worst: number
}

interface Study {
  nEvents: number
  horizons: Record<string, HorizonStat>
}

interface Data {
  latest: {
    gold: number | null
    dxy: number | null
    corr20: number
    corr60: number
    corr120: number
    band: string
    bandLabel: string
    bandDesc: string
    dfii10: number | null
    t10yie: number | null
    residZ: number | null
    residPercentile: number
  }
  priceChart: { date: string; gold: number; dxy: number | null }[]
  corrChart: { s20: { date: string; value: number }[]; s60: { date: string; value: number }[]; s120: { date: string; value: number }[] }
  bandSwitches: { date: string; from: string; to: string }[]
  residSeries: { date: string; z: number | null }[]
  extremes: { date: string; dir: string }[]
  eventStudies: {
    broken: Study
    overvalued: Study
    undervalued: Study
  }
  signal: {
    title: string
    direction: Direction
    strength: Strength
    confidence: number
    evidence: string[]
    counterEvidence: string[]
    historical: { label: string; n: number; median: number; winRate: number }[]
    updatedAt: string
  }
  updatedAt: string
}

const DIR_LABEL: Record<Direction, string> = { bullish: '看多', bearish: '看空', neutral: '中性' }
const STRENGTH_LABEL: Record<Strength, string> = { strong: '强', moderate: '中', weak: '弱' }

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

function Chart({ option, height = 320 }: { option: any | null; height?: number }) {
  const { ref } = useChart(option, [option])
  return (
    <div style={{ width: '100%', height, position: 'relative' }}>
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 16, marginTop: 14 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.04em' }}>{title}</h3>
      {children}
    </section>
  )
}

function StudyTable({ title, study }: { title: string; study: Study }) {
  if (!study || study.nEvents === 0) return null
  const horizons = Object.entries(study.horizons)
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{title}（{study.nEvents} 次事件）</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>窗口</th>
            <th style={thStyle}>样本</th>
            <th style={thStyle}>胜率</th>
            <th style={thStyle}>中位数</th>
            <th style={thStyle}>均值</th>
            <th style={thStyle}>P25</th>
            <th style={thStyle}>P75</th>
          </tr>
        </thead>
        <tbody>
          {horizons.map(([h, s]) => (
            <tr key={h}>
              <td style={tdStyle}>{h} 日</td>
              <td style={tdStyle}>{s.n}</td>
              <td style={{ ...tdStyle, color: s.winRate >= 0.5 ? 'var(--green)' : 'var(--red)' }}>{fmtPct(s.winRate)}</td>
              <td style={{ ...tdStyle, color: s.median >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtPct(s.median)}</td>
              <td style={tdStyle}>{fmtPct(s.mean)}</td>
              <td style={tdStyle}>{fmtPct(s.p25)}</td>
              <td style={tdStyle}>{fmtPct(s.p75)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border-light)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }

function SignalCard({ signal }: { signal: NonNullable<Data['signal']> }) {
  const dirColor = signal.direction === 'bullish' ? 'var(--green)' : signal.direction === 'bearish' ? 'var(--red)' : 'var(--text-muted)'
  return (
    <section style={{ background: 'var(--bg-card)', border: `1px solid ${signal.direction === 'neutral' ? 'var(--border-light)' : dirColor}`, borderRadius: 12, padding: 18, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{signal.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>更新 {signal.updatedAt} · 研究参考，非投资建议</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: dirColor }}>{DIR_LABEL[signal.direction]}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>信号强度 {STRENGTH_LABEL[signal.strength]} · 置信度 {signal.confidence}%</span>
        </div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>证据链</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            {signal.evidence.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
        {signal.counterEvidence.length > 0 && (
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>反向证据</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--red)', lineHeight: 1.8 }}>
              {signal.counterEvidence.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
      </div>
      {signal.historical.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {signal.historical.map((h, i) => (
            <div key={i} style={{ background: 'var(--bg-card-hover, rgba(255,255,255,0.04))', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
              <span style={{ color: 'var(--text-muted)' }}>{h.label}：</span>
              <strong style={{ color: h.median >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtPct(h.median)}</strong>
              <span style={{ color: 'var(--text-muted)' }}> · 胜率 {fmtPct(h.winRate)} · {h.n} 次</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function GoldDecisionDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const t = useChartTheme()

  useEffect(() => {
    let alive = true
    fetch('/api/v1/gold/correlation.json')
      .then(r => r.json())
      .then(j => {
        if (!alive) return
        if (j.success) setData(j.data)
        else setError(j.error || '加载失败')
      })
      .catch((e: any) => alive && setError(e.message || '加载失败'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  if (loading) return <LoadingSkeleton type="chart" height={480} />
  if (error || !data) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{error || '暂无数据'}</div>

  const priceChart = {
    tooltip: { trigger: 'axis', backgroundColor: t.bgCard, borderColor: t.borderLight, textStyle: { color: t.textPrimary } },
    legend: { data: ['金价 (USD/oz)', 'DXY'], textStyle: { color: t.textMuted, fontSize: 11 }, top: 0 },
    grid: { left: 56, right: 56, top: 28, bottom: 26 },
    xAxis: { type: 'category', data: data.priceChart.map(p => p.date), axisLabel: { color: t.textMuted, fontSize: 10 }, axisLine: { lineStyle: { color: t.borderColor } } },
    yAxis: [
      { type: 'value', scale: true, name: 'Gold', nameTextStyle: { color: t.textMuted }, axisLabel: { color: t.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: t.borderColor, type: 'dashed' } } },
      { type: 'value', scale: true, name: 'DXY', nameTextStyle: { color: t.textMuted }, axisLabel: { color: t.textMuted, fontSize: 10 }, splitLine: { show: false } },
    ],
    series: [
      { name: '金价 (USD/oz)', type: 'line', data: data.priceChart.map(p => p.gold), smooth: true, showSymbol: false, lineStyle: { width: 2, color: t.gold } },
      { name: 'DXY', type: 'line', yAxisIndex: 1, data: data.priceChart.map(p => p.dxy), smooth: true, showSymbol: false, lineStyle: { width: 1.5, color: t.cyan } },
    ],
  }

  const corrOption = {
    tooltip: { trigger: 'axis', backgroundColor: t.bgCard, borderColor: t.borderLight, textStyle: { color: t.textPrimary }, valueFormatter: (v: any) => Number(v).toFixed(3) },
    legend: { data: ['20 日', '60 日', '120 日'], textStyle: { color: t.textMuted, fontSize: 11 }, top: 0 },
    grid: { left: 46, right: 20, top: 28, bottom: 26 },
    xAxis: { type: 'category', data: data.corrChart.s60.map(p => p.date), axisLabel: { color: t.textMuted, fontSize: 10 }, axisLine: { lineStyle: { color: t.borderColor } } },
    yAxis: { type: 'value', min: -1, max: 1, axisLabel: { color: t.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: t.borderColor, type: 'dashed' } } },
    series: [
      { name: '20 日', type: 'line', data: data.corrChart.s20.map(p => p.value), smooth: true, showSymbol: false, lineStyle: { width: 1.5, color: t.gold } },
      { name: '60 日', type: 'line', data: data.corrChart.s60.map(p => p.value), smooth: true, showSymbol: false, lineStyle: { width: 2, color: t.cyan } },
      { name: '120 日', type: 'line', data: data.corrChart.s120.map(p => p.value), smooth: true, showSymbol: false, lineStyle: { width: 1.5, color: t.blue } },
    ],
  }

  const residDates = data.residSeries.map(p => p.date)
  const residOption = {
    tooltip: { trigger: 'axis', backgroundColor: t.bgCard, borderColor: t.borderLight, textStyle: { color: t.textPrimary }, valueFormatter: (v: any) => Number(v).toFixed(2) },
    grid: { left: 46, right: 20, top: 16, bottom: 26 },
    xAxis: { type: 'category', data: residDates, axisLabel: { color: t.textMuted, fontSize: 10 }, axisLine: { lineStyle: { color: t.borderColor } } },
    yAxis: { type: 'value', axisLabel: { color: t.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: t.borderColor, type: 'dashed' } } },
    series: [
      {
        name: '残差 z', type: 'bar',
        data: data.residSeries.map(p => {
          const v = p.z
          if (v == null) return null
          return {
            value: v,
            itemStyle: { color: v >= 2 ? t.red : v <= -2 ? '#7bc47f' : v >= 0 ? 'rgba(242,139,130,0.55)' : 'rgba(123,196,127,0.55)' },
          }
        }),
        markLine: {
          symbol: ['none', 'none'], animation: false,
          data: [
            { yAxis: 2, lineStyle: { color: t.red, width: 1.2, type: 'dashed' }, label: { show: true, position: 'insideEndTop', formatter: '+2σ', color: t.red, fontSize: 10 } },
            { yAxis: -2, lineStyle: { color: '#7bc47f', width: 1.2, type: 'dashed' }, label: { show: true, position: 'insideEndBottom', formatter: '-2σ', color: '#7bc47f', fontSize: 10 } },
          ],
        },
      },
    ],
  }

  const latest = data.latest

  return (
    <div>
      <SignalCard signal={data.signal} />

      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {[
            { label: '金价', value: latest.gold != null ? latest.gold.toFixed(2) : '--', sub: 'USD / oz' },
            { label: '美元指数 DXY', value: latest.dxy != null ? latest.dxy.toFixed(2) : '--', sub: '' },
            { label: '相关 20/60/120', value: `${latest.corr20.toFixed(2)} / ${latest.corr60.toFixed(2)} / ${latest.corr120.toFixed(2)}`, sub: '收益率口径' },
            { label: '关联状态', value: latest.bandLabel, sub: latest.bandDesc, accent: true },
            { label: '实际利率 DFII10', value: latest.dfii10 != null ? `${latest.dfii10.toFixed(2)}%` : '--', sub: '10Y TIPS' },
            { label: '盈亏平衡 T10YIE', value: latest.t10yie != null ? `${latest.t10yie.toFixed(2)}%` : '--', sub: '' },
            { label: '定价残差 z', value: latest.residZ != null ? (latest.residZ >= 0 ? '+' : '') + latest.residZ.toFixed(2) : '--', sub: `5Y 分位 ${latest.residPercentile.toFixed(0)}` },
          ].map(k => (
            <div key={k.label} style={{ background: k.accent ? 'var(--accent-blue-dim, rgba(59,130,246,0.1))' : 'var(--bg-card-hover, rgba(255,255,255,0.04))', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{k.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>{k.value}</div>
              {k.sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{k.sub}</div>}
            </div>
          ))}
        </div>
      </section>

      <Card title="金价 vs 美元指数（近 2 年）">
        <Chart option={priceChart} height={300} />
      </Card>

      <Card title="黄金-美元收益率滚动相关（20 / 60 / 120 日）">
        <Chart option={corrOption} height={300} />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          说明：越向下越负相关（经典范式）；高于 -0.15 即「失效区间」。
        </div>
      </Card>

      <Card title="定价残差 z（双因子模型：实际利率 DFII10 + DXY 20 日动量）">
        <Chart option={residOption} height={280} />
        {data.extremes.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
            历史极端点({data.extremes.length})：{data.extremes.slice(-8).map(e => `${e.date}(${e.dir === 'overvalued' ? '高估' : '低估'})`).join(' · ')}
          </div>
        )}
      </Card>

      <Card title="事件研究：信号出现后的黄金后市收益">
        <StudyTable title="① 相关性失效/正相关切换后" study={data.eventStudies.broken} />
        <StudyTable title="② 残差高估（z ≥ 2）后" study={data.eventStudies.overvalued} />
        <StudyTable title="③ 残差低估（z ≤ -2）后" study={data.eventStudies.undervalued} />
        {data.eventStudies.broken.nEvents === 0 && data.eventStudies.overvalued.nEvents === 0 && data.eventStudies.undervalued.nEvents === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0' }}>历史事件不足，样本积累后自动生成验证统计。</div>
        )}
      </Card>

      <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
        数据来源：Yahoo Finance（金价 GC=F、美元指数 DXY）、FRED（DFII10、T10YIE）。所有信号为统计研究结果，不构成投资建议。
      </div>
    </div>
  )
}

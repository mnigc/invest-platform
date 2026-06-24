import { useEffect, useMemo, useState } from 'react'
import { MacroCard } from './ui/MacroCard'
import { useChartTheme } from './ui/theme'
import { LoadingSkeleton } from './ui/LoadingSkeleton'
import { useChart } from './charts/useChart'

interface SpreadPoint {
  date: string
  cn10y: number | null
  us10y: number | null
  spread: number | null
}

interface FlowPoint {
  date: string
  northbound: number | null
  southbound: number | null
  usdcnh: number | null
  spread: number | null
}

interface Data {
  latestDate: string
  latest: {
    cn10y: number | null
    us10y: number | null
    spread: number | null
    change: number | null
  }
  history: SpreadPoint[]
  warningLines: { label: string; valueBp: number }[]
  percentile1y: number | null
  percentile5y: number | null
  inversionCount: number
}

function HeroNumber({
  label,
  value,
  suffix = '',
  change,
}: {
  label: string
  value: number | null
  suffix?: string
  change?: number | null
}) {
  return (
    <div style={{
      padding: '12px 14px',
      background: 'var(--bg-card)',
      borderRadius: '10px',
      border: `1px solid var(--border-light)`,
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    }}>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
        {value == null ? '--' : `${value.toFixed(3)}${suffix}`}
      </div>
      {change != null && (
        <div style={{
          fontSize: '11px',
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          color: change >= 0 ? 'var(--green)' : 'var(--red)',
        }}>
          {change >= 0 ? '↑' : '↓'} {Math.abs(change * 100).toFixed(1)}bp
        </div>
      )}
    </div>
  )
}

function SpreadChart({ history, warningLines }: { history: SpreadPoint[]; warningLines: { label: string; valueBp: number }[] }) {
  const chartTheme = useChartTheme()
  const { ref } = useChart(
    useMemo(() => {
      if (!history || history.length === 0) return null
      const slice = history
      const dates = slice.map((p) => p.date)
      const spreads = slice.map((p) => (p.spread != null ? +(p.spread * 100).toFixed(2) : null))
      const cnVals = slice.map((p) => p.cn10y)
      const usVals = slice.map((p) => p.us10y)

      const markLines = warningLines.map((w) => ({
        yAxis: w.valueBp,
        name: w.label,
        label: { formatter: w.label, color: chartTheme.red, fontSize: 10 },
        lineStyle: { color: chartTheme.red, type: 'dashed', width: 1, opacity: 0.5 },
      }))

      return {
        tooltip: {
          trigger: 'axis',
          backgroundColor: chartTheme.bgCard,
          borderColor: chartTheme.borderLight,
          borderWidth: 1,
          textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
          formatter: (params: any) => {
            if (!Array.isArray(params) || params.length === 0) return ''
            let html = `<div style="font-weight:600;margin-bottom:4px">${params[0].axisValue}</div>`
            params.forEach((p: any) => {
              const v = p.value
              if (v == null) return
              const seriesName = p.seriesName || ''
              const unit = seriesName.includes('利差') ? 'bp' : '%'
              html += `<div style="color:${p.color}">${p.marker} ${seriesName}: <b>${Number(v).toFixed(seriesName.includes('利差') ? 1 : 3)}${unit}</b></div>`
            })
            return html
          },
        },
        legend: {
          data: ['中美利差 (bp)', '中国10Y %', '美国10Y %'],
          textStyle: { color: chartTheme.textSecondary, fontSize: 11 },
          top: 0,
        },
        grid: { left: 60, right: 60, top: 40, bottom: 56 },
        xAxis: {
          type: 'category',
          data: dates,
          axisLabel: { color: chartTheme.textMuted, fontSize: 10 },
          axisLine: { lineStyle: { color: chartTheme.borderColor } },
          splitLine: { show: false },
        },
        yAxis: [
          {
            type: 'value',
            name: '利差(bp)',
            nameTextStyle: { color: chartTheme.textMuted, fontSize: 10 },
            position: 'left',
            axisLabel: { color: chartTheme.textMuted, fontSize: 10, formatter: '{value}' },
            splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } },
          },
          {
            type: 'value',
            name: '收益率(%)',
            nameTextStyle: { color: chartTheme.textMuted, fontSize: 10 },
            position: 'right',
            axisLabel: { color: chartTheme.textMuted, fontSize: 10, formatter: '{value}%' },
            splitLine: { show: false },
          },
        ],
        dataZoom: [
          {
            type: 'slider', start: 70, end: 100, height: 18, bottom: 14,
            borderColor: chartTheme.borderColor, backgroundColor: chartTheme.bgCard,
            fillerColor: chartTheme.goldDim,
            handleIcon: 'path://M0,0 v9h9v-9H0z M-11,-1 h22v11 h-22 Z M-11,10 h22v11 h-22 Z',
            handleSize: '80%',
            handleStyle: { color: chartTheme.gold, borderColor: chartTheme.gold },
          },
        ],
        series: [
          {
            type: 'line',
            name: '中美利差 (bp)',
            data: spreads,
            smooth: true,
            showSymbol: false,
            yAxisIndex: 0,
            itemStyle: { color: chartTheme.gold },
            lineStyle: { width: 2, color: chartTheme.gold },
            areaStyle: {
              color: {
                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: chartTheme.goldDim },
                  { offset: 1, color: 'transparent' },
                ],
              },
            },
            markLine: {
              symbol: 'none',
              silent: true,
              data: markLines as any,
            },
          },
          {
            type: 'line',
            name: '中国10Y %',
            data: cnVals,
            smooth: true,
            showSymbol: false,
            yAxisIndex: 1,
            itemStyle: { color: chartTheme.red },
            lineStyle: { width: 1.5, color: chartTheme.red, opacity: 0.8 },
          },
          {
            type: 'line',
            name: '美国10Y %',
            data: usVals,
            smooth: true,
            showSymbol: false,
            yAxisIndex: 1,
            itemStyle: { color: chartTheme.blue },
            lineStyle: { width: 1.5, color: chartTheme.blue, opacity: 0.8 },
          },
        ],
      } as any
    }, [history, warningLines, chartTheme]),
    [history, warningLines, chartTheme],
  )

  if (!history || history.length === 0)
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
        NO DATA
      </div>
    )

  return (
    <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: '380px' }} />
    </div>
  )
}

// ── 解读区域辅助组件 ──
function DataRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid var(--border-light)` }}>
      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: valueColor || 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

const SPREAD_EDU_OPEN = true

function SpreadEducation() {
  const [open, setOpen] = useState(SPREAD_EDU_OPEN)
  return (
    <div style={{
      borderRadius: '14px',
      background: 'var(--bg-card)', overflow: 'hidden',
    }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '14px 18px', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke='var(--accent-cyan)' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <span style={{ flex: 1, fontSize: '13px', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '0.03em', color: 'var(--text-primary)' }}>
          利差科普 · 一图读懂
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke='var(--text-muted)' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      {open && (
        <div style={{ padding: '0 18px 16px', fontSize: '13px', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
          <p style={{ margin: '0 0 14px 0' }}>
            <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>利差（Spread）</span>是指两个不同国家或不同期限的国债收益率之间的差值。它是国际资本流动、汇率走势和宏观经济预期的核心参考指标。
          </p>

          <div className="g-grid-2" style={{ display: 'grid', gap: '12px' }}>
            {/* 利差为正 */}
            <div style={{ borderRadius: '10px', border: `1px solid var(--border-light)`, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
              <div style={{
                padding: '10px 14px', fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '0.04em',
                color: 'var(--green)', background: 'var(--green-bg)', borderBottom: `1px solid var(--green-bg)`,
              }}>
                ✅ 利差为正（正常区间）
              </div>
              <div style={{ padding: '10px 14px' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '12.5px', lineHeight: 1.6 }}>
                  中国国债收益率高于美国国债，持有人民币资产有额外的正息差收入。
                </p>
                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>有利于吸引外资流入 A 股与债市</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>对人民币汇率形成支撑</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>反映中国经济增长前景相对乐观</li>
                </ul>
              </div>
            </div>

            {/* 利差倒挂 */}
            <div style={{ borderRadius: '10px', border: `1px solid var(--border-light)`, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
              <div style={{
                padding: '10px 14px', fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '0.04em',
                color: 'var(--accent-gold)', background: 'var(--accent-gold-dim)', borderBottom: `1px solid var(--accent-gold-dim)`,
              }}>
                ⚠️ 利差倒挂（负值区间）
              </div>
              <div style={{ padding: '10px 14px' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '12.5px', lineHeight: 1.6 }}>
                  美国国债收益率高于中国国债，美债的绝对收益更高，可能引发跨境资金流向美元资产。
                </p>
                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>人民币汇率面临贬值压力</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>北向资金流入 A 股的意愿受抑制</li>
                  <li style={{ marginBottom: '3px', fontSize: '12.5px', lineHeight: 1.6 }}>中国央行货币政策空间面临外部约束</li>
                </ul>
              </div>
            </div>

            {/* 深度解读 */}
            <div style={{ gridColumn: 'span 2', borderRadius: '10px', border: `1px solid var(--border-light)`, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
              <div style={{
                padding: '10px 14px', fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '0.04em',
                color: 'var(--accent-cyan)', background: 'var(--accent-cyan-dim)', borderBottom: `1px solid var(--accent-cyan-dim)`,
              }}>
                📊 影响利差的核心因素
              </div>
              <div style={{ padding: '10px 14px' }}>
                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                  <li style={{ marginBottom: '4px', fontSize: '12.5px', lineHeight: 1.6 }}>
                    <strong>货币政策周期</strong>：美联储与中国人民银行的利率决策方向差是利差变化最直接的驱动因素。一方加息、另一方降息时利差急剧变化。
                  </li>
                  <li style={{ marginBottom: '4px', fontSize: '12.5px', lineHeight: 1.6 }}>
                    <strong>通胀预期</strong>：两国通胀水平的差异决定了名义利率的长期走向。高通胀国家通常维持更高的利率水平以压制物价。
                  </li>
                  <li style={{ marginBottom: '4px', fontSize: '12.5px', lineHeight: 1.6 }}>
                    <strong>经济增长预期</strong>：经济增速较快的国家往往利率更高，以反映更高的资本回报率与融资需求。
                  </li>
                  <li style={{ marginBottom: '4px', fontSize: '12.5px', lineHeight: 1.6 }}>
                    <strong>风险情绪</strong>：全球避险情绪升温时资金涌入美债（避险资产），压低美债利率，可能导致利差走阔或倒挂缓解。
                  </li>
                  <li style={{ marginBottom: '4px', fontSize: '12.5px', lineHeight: 1.6 }}>
                    <strong>资本流动</strong>：跨境资金追逐利差的行为本身也会反向影响利差——资金流入压低利率，流出推高利率，形成反馈循环。
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CnUsSpreadDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [flowData, setFlowData] = useState<FlowPoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [spreadRes, flowRes] = await Promise.all([
          fetch('/api/v1/bonds/cn-us-spread.json'),
          fetch('/api/v1/cross-border-flow.json'),
        ])
        if (!spreadRes.ok) throw new Error(`spread HTTP ${spreadRes.status}`)
        const spreadJson = await spreadRes.json()
        if (!spreadJson.success) throw new Error(spreadJson.error || '加载失败')
        if (!cancelled) setData(spreadJson.data)
        if (flowRes.ok) {
          const flowJson = await flowRes.json()
          if (flowJson.success && !cancelled) setFlowData(flowJson.data.history || [])
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || '网络错误')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <LoadingSkeleton type="card" height={120} />
        <LoadingSkeleton type="chart" height={380} />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        padding: '14px 18px', borderRadius: '12px',
        background: 'var(--red-bg)', color: 'var(--red)', fontSize: '13px',
        border: `1px solid var(--red-bg)`,
      }}>
        ⚠️ {error}
      </div>
    )
  }

  if (!data) return null

  const spreadBp = data.latest.spread != null ? data.latest.spread * 100 : null
  const isWarning = spreadBp != null && spreadBp < 0
  const isCritical = spreadBp != null && spreadBp <= -100
  const timeRange = data.history?.length > 1
    ? `${data.history[0].date} ~ ${data.history[data.history.length - 1].date}`
    : ''

  return (
    <div className="spread-dashboard" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Hero + 关键数字 */}
      <MacroCard title="中美 10 年期国债利差" variant="elevated">
        <div className="g-grid-hero-4" style={{ display: 'grid', gap: '12px', alignItems: 'stretch' }}>
          {/* 主利差卡 */}
          <div style={{
            padding: '14px 16px',
            background: isCritical
              ? 'var(--red-bg)'
              : isWarning
              ? 'var(--accent-gold-dim)'
              : 'var(--green-bg)',
            borderRadius: '10px',
            border: `1px solid ${
              isCritical ? 'var(--red-bg)' : isWarning ? 'var(--accent-gold-dim)' : 'var(--green-bg)'
            }`,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              最新利差 ({data.latestDate || '--'})
            </div>
            <div style={{
              fontSize: '36px', fontWeight: 700, fontFamily: 'var(--font-mono)', lineHeight: 1.1,
              color: isCritical ? 'var(--red)' : isWarning ? 'var(--accent-gold)' : 'var(--green)',
            }}>
              {spreadBp == null ? '--' : `${spreadBp > 0 ? '+' : ''}${spreadBp.toFixed(1)}`}<span style={{ fontSize: '16px', marginLeft: '4px' }}>bp</span>
            </div>
            <div style={{
              fontSize: '12px', color: isCritical ? 'var(--red)' : isWarning ? 'var(--accent-gold)' : 'var(--green)', fontWeight: 600,
            }}>
              {isCritical ? '⚠ 深度倒挂' : isWarning ? '⚠ 利差倒挂' : '正常区间'} ·
              中国10Y {data.latest.cn10y?.toFixed(3) ?? '--'}% − 美国10Y {data.latest.us10y?.toFixed(3) ?? '--'}%
            </div>
            {data.latest.change != null && (
              <div style={{
                fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono)',
                color: data.latest.change >= 0 ? 'var(--green)' : 'var(--red)',
              }}>
                日变动 {data.latest.change >= 0 ? '↑' : '↓'} {Math.abs(data.latest.change * 100).toFixed(1)}bp
              </div>
            )}
          </div>

          <HeroNumber label="1 年分位" value={data.percentile1y} suffix="%" />
          <HeroNumber label="5 年分位" value={data.percentile5y} suffix="%" />
          <HeroNumber label="历史倒挂次数" value={data.inversionCount} />
        </div>
      </MacroCard>

      {/* 利差走势图 */}
      <MacroCard title={`中美利差时间序列 (${timeRange || '近 1 年'})`} variant="elevated">
        <SpreadChart history={data.history} warningLines={data.warningLines} />
        <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--text-muted)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <span>● 金色：中美 10Y 利差 (bp，左轴)</span>
          <span>● 红色：中国 10Y 国债收益率 (右轴)</span>
          <span>● 蓝色：美国 10Y 国债收益率 (右轴)</span>
          <span>● 红色虚线：警戒线</span>
        </div>
      </MacroCard>

      {/* 解读 */}
      <MacroCard title="投研解读" variant="elevated">
        <div style={{ fontSize: '13px', lineHeight: 1.7 }}>
          {/* 状态横幅 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderRadius: '10px', marginBottom: '16px',
            background: isCritical
              ? 'var(--red-bg)'
              : isWarning
              ? 'var(--accent-gold-dim)'
              : 'var(--green-bg)',
            border: `1px solid ${
              isCritical ? 'var(--red-bg)' : isWarning ? 'var(--accent-gold-dim)' : 'var(--green-bg)'
            }`,
          }}>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>
                当前状态
              </div>
              <span style={{
                fontSize: '15px', fontWeight: 700,
                color: isCritical ? 'var(--red)' : isWarning ? 'var(--accent-gold)' : 'var(--green)',
              }}>
                {isCritical ? '深度倒挂' : isWarning ? '利差倒挂' : '正常区间'}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>
                中美 10Y 利差
              </div>
              <span style={{
                fontSize: '22px', fontWeight: 800, fontFamily: 'var(--font-mono)',
                color: isCritical ? 'var(--red)' : isWarning ? 'var(--accent-gold)' : 'var(--green)',
              }}>
                {spreadBp == null ? '--' : `${spreadBp > 0 ? '+' : ''}${spreadBp.toFixed(1)}`}
                <span style={{ fontSize: '12px', marginLeft: '2px' }}>bp</span>
              </span>
            </div>
          </div>

          {/* 数据明细表格 */}
          <div className="g-grid-2" style={{ display: 'grid', gap: '10px 24px' }}>
            <DataRow label="中国 10Y 收益率" value={data.latest.cn10y != null ? `${data.latest.cn10y.toFixed(3)}%` : '--'} />
            <DataRow label="美国 10Y 收益率" value={data.latest.us10y != null ? `${data.latest.us10y.toFixed(3)}%` : '--'} />
            <DataRow
              label="日变动"
              value={data.latest.change != null
                ? `${data.latest.change >= 0 ? '↑' : '↓'} ${Math.abs(data.latest.change * 100).toFixed(1)}bp`
                : '--'}
              valueColor={data.latest.change != null ? (data.latest.change >= 0 ? 'var(--green)' : 'var(--red)') : undefined}
            />
            <DataRow label="近 1 年分位" value={data.percentile1y != null ? `${data.percentile1y.toFixed(1)}%` : '--'} />
            <DataRow label="近 5 年分位" value={data.percentile5y != null ? `${data.percentile5y.toFixed(1)}%` : '--'} />
            <DataRow label="历史倒挂时段" value={data.inversionCount != null ? `共 ${data.inversionCount} 次` : '--'} />
          </div>

          {/* 警戒线状态 */}
          {data.warningLines.length > 0 && (
            <div style={{ marginTop: '14px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {data.warningLines.map((w) => {
                const isBreached = spreadBp != null && spreadBp <= w.valueBp
                return (
                  <div key={w.label} style={{
                    padding: '6px 12px', borderRadius: '6px', fontSize: '11px',
                    background: isBreached ? 'var(--red-bg)' : 'var(--bg-elevated)',
                    border: `1px solid ${isBreached ? 'var(--red-bg)' : 'var(--border-light)'}`,
                    color: isBreached ? 'var(--red)' : 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)', fontWeight: 600,
                  }}>
                    {isBreached ? '⚠' : ''} {w.label} ({w.valueBp}bp)
                    {isBreached && ' - 已触及'}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </MacroCard>

      {/* ===== 利差与跨境资金联动 ===== */}
      {flowData.length > 0 && (
        <MacroCard title="利差与跨境资金联动" variant="elevated">
          <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            利差变动与跨境资金流动存在双向反馈——利差倒挂时北向资金倾向于流出，而人民币汇率也面临压力。下方图表直观展示三者联动关系。2024-08-19起，北向资金买入/卖出/净买入额不再公布。
          </div>
          <FlowCorrelationChart flowHistory={flowData} />
        </MacroCard>
      )}

      {/* ===== 利差科普 ===== */}
      <SpreadEducation />
    </div>
  )
}

function FlowCorrelationChart({ flowHistory }: { flowHistory: FlowPoint[] }) {
  const chartTheme = useChartTheme()
  const { ref: refFlow } = useChart(
    useMemo(() => {
      if (!flowHistory || flowHistory.length === 0) return null
      const dates = flowHistory.map((p) => p.date)
      const northVals = flowHistory.map((p) => (p.northbound != null ? +(p.northbound / 100).toFixed(2) : null))
      const southVals = flowHistory.map((p) => (p.southbound != null ? +(p.southbound / 100).toFixed(2) : null))
      const spreadVals = flowHistory.map((p) => (p.spread != null ? +(p.spread * 100).toFixed(2) : null))
      return {
        tooltip: {
          trigger: 'axis', backgroundColor: chartTheme.bgCard, borderColor: chartTheme.borderLight, borderWidth: 1,
          textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
        },
        legend: {
          data: ['北向净流入(亿元)', '南向净流入(亿元)', '中美利差(bp)'],
          textStyle: { color: chartTheme.textSecondary, fontSize: 11 }, top: 0,
        },
        grid: { left: 70, right: 70, top: 40, bottom: 40 },
        xAxis: { type: 'category', data: dates, axisLabel: { color: chartTheme.textMuted, fontSize: 10 }, axisLine: { lineStyle: { color: chartTheme.borderColor } } },
        yAxis: [
          { type: 'value', name: '净流入(亿元)', nameTextStyle: { color: chartTheme.textMuted, fontSize: 10 }, axisLabel: { color: chartTheme.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } } },
          { type: 'value', name: '利差(bp)', nameTextStyle: { color: chartTheme.textMuted, fontSize: 10 }, position: 'right', axisLabel: { color: chartTheme.textMuted, fontSize: 10 }, splitLine: { show: false } },
        ],
        dataZoom: [{ type: 'slider', start: 60, end: 100, height: 14, bottom: 6, borderColor: chartTheme.borderColor, backgroundColor: chartTheme.bgCard, fillerColor: chartTheme.goldDim, handleIcon: 'path://M0,0 v9h9v-9H0z M-11,-1 h22v11 h-22 Z M-11,10 h22v11 h-22 Z', handleSize: '80%', handleStyle: { color: chartTheme.gold, borderColor: chartTheme.gold } }],
        series: [
          { type: 'bar', name: '北向净流入(亿元)', data: northVals, yAxisIndex: 0, itemStyle: { color: chartTheme.red } },
          { type: 'bar', name: '南向净流入(亿元)', data: southVals, yAxisIndex: 0, itemStyle: { color: chartTheme.blue } },
          { type: 'line', name: '中美利差(bp)', data: spreadVals, yAxisIndex: 1, smooth: true, showSymbol: false, itemStyle: { color: chartTheme.gold }, lineStyle: { width: 2, color: chartTheme.gold } },
        ],
      } as any
    }, [flowHistory, chartTheme]),
    [flowHistory, chartTheme],
  )

  const { ref: refFx } = useChart(
    useMemo(() => {
      if (!flowHistory || flowHistory.length === 0) return null
      const dates = flowHistory.map((p) => p.date)
      const fxVals = flowHistory.map((p) => p.usdcnh)
      const spreadVals = flowHistory.map((p) => (p.spread != null ? +(p.spread * 100).toFixed(2) : null))
      return {
        tooltip: {
          trigger: 'axis', backgroundColor: chartTheme.bgCard, borderColor: chartTheme.borderLight, borderWidth: 1,
          textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
        },
        legend: {
          data: ['USDCNY(在岸)', '中美利差(bp)'],
          textStyle: { color: chartTheme.textSecondary, fontSize: 11 }, top: 0,
        },
        grid: { left: 70, right: 70, top: 40, bottom: 40 },
        xAxis: { type: 'category', data: dates, axisLabel: { color: chartTheme.textMuted, fontSize: 10 }, axisLine: { lineStyle: { color: chartTheme.borderColor } } },
        yAxis: [
          { type: 'value', name: 'USDCNH', nameTextStyle: { color: chartTheme.textMuted, fontSize: 10 }, axisLabel: { color: chartTheme.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } } },
          { type: 'value', name: '利差(bp)', nameTextStyle: { color: chartTheme.textMuted, fontSize: 10 }, position: 'right', axisLabel: { color: chartTheme.textMuted, fontSize: 10 }, splitLine: { show: false } },
        ],
        dataZoom: [{ type: 'slider', start: 60, end: 100, height: 14, bottom: 6, borderColor: chartTheme.borderColor, backgroundColor: chartTheme.bgCard, fillerColor: chartTheme.goldDim, handleIcon: 'path://M0,0 v9h9v-9H0z M-11,-1 h22v11 h-22 Z M-11,10 h22v11 h-22 Z', handleSize: '80%', handleStyle: { color: chartTheme.gold, borderColor: chartTheme.gold } }],
        series: [
          { type: 'line', name: 'USDCNY(在岸)', data: fxVals, smooth: true, showSymbol: false, lineStyle: { width: 2, color: chartTheme.cyan }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: chartTheme.cyanDim }, { offset: 1, color: 'transparent' }] } } },
          { type: 'line', name: '中美利差(bp)', data: spreadVals, yAxisIndex: 1, smooth: true, showSymbol: false, itemStyle: { color: chartTheme.gold }, lineStyle: { width: 2, color: chartTheme.gold } },
        ],
      } as any
    }, [flowHistory, chartTheme]),
    [flowHistory, chartTheme],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0' }}>
        <div ref={refFlow} style={{ width: '100%', height: '340px' }} />
      </div>
      <div style={{ width: '100%', background: 'var(--bg-card)', borderRadius: '12px', padding: '12px 0' }}>
        <div ref={refFx} style={{ width: '100%', height: '340px' }} />
      </div>
    </div>
  )
}

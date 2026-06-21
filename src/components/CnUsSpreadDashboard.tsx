import { useEffect, useMemo, useState } from 'react'
import { MacroCard } from './ui/MacroCard'
import { THEME } from './ui/theme'
import { LoadingSkeleton } from './ui/LoadingSkeleton'
import { useChart } from './charts/useChart'

interface SpreadPoint {
  date: string
  cn10y: number | null
  us10y: number | null
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
      background: THEME.bgCard,
      borderRadius: '10px',
      border: `1px solid ${THEME.borderLight}`,
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    }}>
      <div style={{ fontSize: '10px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary }}>
        {value == null ? '--' : `${value.toFixed(3)}${suffix}`}
      </div>
      {change != null && (
        <div style={{
          fontSize: '11px',
          fontWeight: 700,
          fontFamily: THEME.fontMono,
          color: change >= 0 ? THEME.green : THEME.red,
        }}>
          {change >= 0 ? '↑' : '↓'} {Math.abs(change * 100).toFixed(1)}bp
        </div>
      )}
    </div>
  )
}

function SpreadChart({ history, warningLines }: { history: SpreadPoint[]; warningLines: { label: string; valueBp: number }[] }) {
  const { ref } = useChart(
    useMemo(() => {
      if (!history || history.length === 0) return null
      // 取最近 750 个交易日（约 3 年）
      const slice = history.slice(-750)
      const dates = slice.map((p) => p.date)
      const spreads = slice.map((p) => (p.spread != null ? +(p.spread * 100).toFixed(2) : null))
      const cnVals = slice.map((p) => p.cn10y)
      const usVals = slice.map((p) => p.us10y)

      const markLines = warningLines.map((w) => ({
        yAxis: w.valueBp,
        name: w.label,
        label: { formatter: w.label, color: THEME.red, fontSize: 10 },
        lineStyle: { color: THEME.red, type: 'dashed', width: 1, opacity: 0.5 },
      }))

      return {
        tooltip: {
          trigger: 'axis',
          backgroundColor: THEME.bgCard,
          borderColor: THEME.borderLight,
          borderWidth: 1,
          textStyle: { color: THEME.textPrimary, fontSize: 12 },
          valueFormatter: (v: any, idx: number) => {
            if (v == null) return '--'
            // 第一条（spread）显示 bp，其余显示 %
            return idx === 0 ? `${Number(v).toFixed(1)}bp` : `${Number(v).toFixed(3)}%`
          },
        },
        legend: {
          data: ['中美利差 (bp)', '中国10Y %', '美国10Y %'],
          textStyle: { color: THEME.textSecondary, fontSize: 11 },
          top: 0,
        },
        grid: { left: 60, right: 60, top: 40, bottom: 30 },
        xAxis: {
          type: 'category',
          data: dates,
          axisLabel: { color: THEME.textMuted, fontSize: 10 },
          axisLine: { lineStyle: { color: THEME.borderColor } },
          splitLine: { show: false },
        },
        yAxis: [
          {
            type: 'value',
            name: '利差(bp)',
            nameTextStyle: { color: THEME.textMuted, fontSize: 10 },
            position: 'left',
            axisLabel: { color: THEME.textMuted, fontSize: 10, formatter: '{value}' },
            splitLine: { lineStyle: { color: THEME.borderColor, type: 'dashed' } },
          },
          {
            type: 'value',
            name: '收益率(%)',
            nameTextStyle: { color: THEME.textMuted, fontSize: 10 },
            position: 'right',
            axisLabel: { color: THEME.textMuted, fontSize: 10, formatter: '{value}%' },
            splitLine: { show: false },
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
            lineStyle: { width: 2, color: THEME.gold },
            areaStyle: {
              color: {
                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(245,158,11,0.25)' },
                  { offset: 1, color: 'rgba(245,158,11,0.02)' },
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
            lineStyle: { width: 1.5, color: THEME.red, opacity: 0.8 },
          },
          {
            type: 'line',
            name: '美国10Y %',
            data: usVals,
            smooth: true,
            showSymbol: false,
            yAxisIndex: 1,
            lineStyle: { width: 1.5, color: THEME.blue, opacity: 0.8 },
          },
        ],
      } as any
    }, [history, warningLines]),
    [history, warningLines],
  )

  if (!history || history.length === 0)
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: THEME.textMuted, fontSize: '13px' }}>
        NO DATA
      </div>
    )

  return (
    <div style={{ width: '100%', background: THEME.bgCard, borderRadius: '12px', padding: '12px 0' }}>
      <div ref={ref} style={{ width: '100%', height: '380px' }} />
    </div>
  )
}

export default function CnUsSpreadDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/v1/bonds/cn-us-spread.json')
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
        background: THEME.redBg, color: THEME.red, fontSize: '13px',
        border: `1px solid rgba(242,54,69,0.2)`,
      }}>
        ⚠️ {error}
      </div>
    )
  }

  if (!data) return null

  const spreadBp = data.latest.spread != null ? data.latest.spread * 100 : null
  const isWarning = spreadBp != null && spreadBp < 0
  const isCritical = spreadBp != null && spreadBp <= -100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Hero + 关键数字 */}
      <MacroCard title="中美 10 年期国债利差" variant="elevated">
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: '12px', alignItems: 'stretch' }}>
          {/* 主利差卡 */}
          <div style={{
            padding: '14px 16px',
            background: isCritical
              ? 'rgba(242,54,69,0.12)'
              : isWarning
              ? 'rgba(245,158,11,0.10)'
              : 'rgba(8,153,129,0.08)',
            borderRadius: '10px',
            border: `1px solid ${
              isCritical ? 'rgba(242,54,69,0.4)' : isWarning ? 'rgba(245,158,11,0.35)' : 'rgba(8,153,129,0.3)'
            }`,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}>
            <div style={{ fontSize: '10px', color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              最新利差 ({data.latestDate || '--'})
            </div>
            <div style={{
              fontSize: '36px', fontWeight: 700, fontFamily: THEME.fontMono, lineHeight: 1.1,
              color: isCritical ? THEME.red : isWarning ? THEME.gold : THEME.green,
            }}>
              {spreadBp == null ? '--' : `${spreadBp > 0 ? '+' : ''}${spreadBp.toFixed(1)}`}<span style={{ fontSize: '16px', marginLeft: '4px' }}>bp</span>
            </div>
            <div style={{
              fontSize: '12px', color: isCritical ? THEME.red : isWarning ? THEME.gold : THEME.green, fontWeight: 600,
            }}>
              {isCritical ? '⚠ 深度倒挂' : isWarning ? '⚠ 利差倒挂' : '正常区间'} ·
              中国10Y {data.latest.cn10y?.toFixed(3) ?? '--'}% − 美国10Y {data.latest.us10y?.toFixed(3) ?? '--'}%
            </div>
            {data.latest.change != null && (
              <div style={{
                fontSize: '11px', fontWeight: 700, fontFamily: THEME.fontMono,
                color: data.latest.change >= 0 ? THEME.green : THEME.red,
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
      <MacroCard title="中美利差时间序列 (近 3 年)" variant="elevated">
        <SpreadChart history={data.history} warningLines={data.warningLines} />
        <div style={{ marginTop: '10px', fontSize: '11px', color: THEME.textMuted, display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <span>● 金色：中美 10Y 利差 (bp，左轴)</span>
          <span>● 红色：中国 10Y 国债收益率 (右轴)</span>
          <span>● 蓝色：美国 10Y 国债收益率 (右轴)</span>
          <span>● 红色虚线：警戒线</span>
        </div>
      </MacroCard>

      {/* 解读 */}
      <MacroCard title="投研解读" variant="elevated">
        <div style={{ fontSize: '13px', color: THEME.textSecondary, lineHeight: 1.7 }}>
          {isCritical ? (
            <p>
              <strong style={{ color: THEME.red }}>深度倒挂警告</strong>：中美 10Y 利差已突破 -100bp 警戒线。
              历史经验表明，利差深度倒挂往往伴随<strong>人民币贬值压力加大</strong>与<strong>北向资金流出 A 股</strong>，
              需重点关注央行汇率工具与资本流动管理政策。
            </p>
          ) : isWarning ? (
            <p>
              <strong style={{ color: THEME.gold }}>利差倒挂</strong>：中美 10Y 利差为负，
              美国 10Y 收益率高于中国，<strong>美债相对吸引力上升</strong>。
              历史上持续倒挂 5 个交易日以上共出现 {data.inversionCount} 次，
              通常对应美联储加息周期或中国宽松周期。
            </p>
          ) : (
            <p>
              <strong style={{ color: THEME.green }}>正常区间</strong>：中美 10Y 利差为正，
              中国国债相对美债有正息差，<strong>有利于人民币资产吸引力与北向资金流入</strong>。
              当前 1 年分位 {data.percentile1y?.toFixed(1) ?? '--'}%，
              5 年分位 {data.percentile5y?.toFixed(1) ?? '--'}%。
            </p>
          )}
        </div>
      </MacroCard>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useChart } from './charts/useChart'
import { useChartTheme } from './ui/theme'
import { LoadingSkeleton } from './ui/LoadingSkeleton'
import type { EChartsOption } from 'echarts'

interface PmiSeries {
  name_zh: string
  region: string
  source: string
  latest: { date: string; value: number } | null
  change: number | null
  history: { date: string; value: number }[]
}

interface PmiData {
  US_ISM_PMI: PmiSeries
  CN_CAIXIN_PMI: PmiSeries
  CN_NON_MANU_PMI: PmiSeries
}

const PMI_DISPLAY: Record<string, { label: string; color: string }> = {
  US_ISM_PMI:      { label: '美国ISM制造业PMI', color: '#4FC3F7' },
  CN_CAIXIN_PMI:   { label: '中国财新制造业PMI', color: '#FFB74D' },
  CN_NON_MANU_PMI: { label: '中国非制造业PMI', color: '#81C784' },
}

function HeroCard({ title, latest, change, color, borderColor }: {
  title: string
  latest: { date: string; value: number } | null
  change: number | null
  color: string
  borderColor: string
}) {
  const isAbove50 = latest != null && latest.value > 50
  const isUp = change != null && change >= 0
  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 'var(--radius-xl)',
      border: `1px solid ${borderColor}`, padding: '16px 18px',
    }}>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: '6px' }}>
        {title}
      </div>
      {latest ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '30px', fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>
              {latest.value.toFixed(1)}
            </span>
            <span style={{
              fontSize: '12px', fontFamily: 'var(--font-mono)', fontWeight: 600,
              color: isUp ? 'var(--green)' : 'var(--red)',
            }}>
              {change != null ? `${isUp ? '+' : ''}${change.toFixed(1)}` : '--'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '11px', color: 'var(--text-secondary)' }}>
            <span style={{
              display: 'inline-block', padding: '1px 8px', borderRadius: '8px',
              background: isAbove50 ? 'var(--green-bg)' : 'var(--red-bg)',
              color: isAbove50 ? 'var(--green)' : 'var(--red)',
              fontWeight: 600, fontSize: '10px',
            }}>
              {isAbove50 ? '扩张' : '收缩'}
            </span>
            <span>{latest.date}</span>
          </div>
        </>
      ) : (
        <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>--</div>
      )}
    </div>
  )
}

function PmiChart({ data }: { data: PmiData }) {
  const chartTheme = useChartTheme()

  const seriesDefs = [
    { code: 'US_ISM_PMI', color: '#4FC3F7' },
    { code: 'CN_CAIXIN_PMI', color: '#FFB74D' },
    { code: 'CN_NON_MANU_PMI', color: '#81C784' },
  ]

  const option = useMemo<EChartsOption | null>(() => {
    const allDates = new Set<string>()
    const series: Record<string, Map<string, number>> = {}

    for (const def of seriesDefs) {
      const s = data[def.code as keyof PmiData]
      if (!s || !s.history.length) continue
      const map = new Map<string, number>()
      for (const p of s.history) {
        const d = p.date.slice(0, 7)
        map.set(d, p.value)
        allDates.add(d)
      }
      series[def.code] = map
    }

    if (allDates.size === 0) return null

    const sortedDates = Array.from(allDates).sort()
      const chartSeries = seriesDefs.map((def, i) => {
      const map = series[def.code]
      const dataArr = sortedDates.map(d => map?.get(d) ?? null)
      const s = {
        type: 'line', name: PMI_DISPLAY[def.code]?.label || def.code,
        data: dataArr, smooth: true, showSymbol: dataArr.length < 60,
        symbol: 'circle', symbolSize: 3,
        lineStyle: { width: 2, color: def.color },
        itemStyle: { color: def.color },
      } as any
      if (i === 0) {
        s.markLine = {
          symbol: ['none', 'none'], animation: false,
          data: [{ yAxis: 50 }],
          lineStyle: { color: chartTheme.red, width: 1.5, type: 'dashed' },
          label: { show: true, position: 'insideEndTop', formatter: '50 荣枯线', color: chartTheme.red, fontSize: 10, fontWeight: 600 },
        }
      }
      return s
    })

    return {
      tooltip: {
        trigger: 'axis', backgroundColor: chartTheme.bgElevated,
        borderColor: chartTheme.borderColor, borderWidth: 1,
        textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
        formatter: (params: any) => {
          if (!Array.isArray(params)) return ''
          const date = params[0]?.axisValue || ''
          let html = `<div style="font-size:11px;color:${chartTheme.textSecondary};margin-bottom:4px">${date}</div>`
          for (const p of params) {
            if (p.value == null) continue
            const color = p.color || '#999'
            const v = Number(p.value).toFixed(1)
            html += `<div style="display:flex;justify-content:space-between;gap:20px"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle"></span>${p.seriesName}</span><span style="font-weight:600;color:${color}">${v}</span></div>`
          }
          return html
        },
      },
      legend: {
        data: seriesDefs.map(d => ({ name: PMI_DISPLAY[d.code]?.label || d.code, textStyle: { color: chartTheme.textSecondary, fontSize: 11 } })),
        top: 0, itemWidth: 10, itemHeight: 10,
      },
      grid: { left: 52, right: 20, top: 40, bottom: 50 },
      xAxis: {
        type: 'category', data: sortedDates,
        axisLabel: { color: chartTheme.textMuted, fontSize: 9, showMaxLabel: true },
        axisLine: { lineStyle: { color: chartTheme.borderLight } }, axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 35, max: 65,
        axisLabel: { color: chartTheme.textMuted, fontSize: 10, formatter: '{value}' },
        splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } },
        axisLine: { show: false },
      },
      dataZoom: [{
        type: 'slider', start: 0, end: 100, height: 16, bottom: 4,
        borderColor: chartTheme.borderLight, backgroundColor: chartTheme.bgCard,
        fillerColor: chartTheme.cyanDim,
        textStyle: { color: chartTheme.textMuted },
      }],
      series: chartSeries,
    }
  }, [data, chartTheme])

  const { ref } = useChart(option, [option])

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--border-color)', padding: '18px 16px 10px' }}>
      <div ref={ref} style={{ width: '100%', height: 420 }} />
    </div>
  )
}

function DataTable({ data }: { data: PmiData }) {
  const seriesDefs = [
    { code: 'US_ISM_PMI', label: '美国ISM制造业PMI' },
    { code: 'CN_CAIXIN_PMI', label: '中国财新制造业PMI' },
    { code: 'CN_NON_MANU_PMI', label: '中国非制造业PMI' },
  ]

  const tableData = useMemo(() => {
    const dateMap = new Map<string, Record<string, number | null>>()
    for (const def of seriesDefs) {
      const s = data[def.code as keyof PmiData]
      if (!s) continue
      for (const p of s.history) {
        const d = p.date.slice(0, 7)
        if (!dateMap.has(d)) dateMap.set(d, {})
        dateMap.get(d)![def.code] = p.value
      }
    }
    return Array.from(dateMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 24)
  }, [data])

  const TD = { padding: '6px 12px', fontSize: '11px', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border-color)' }
  const TH = { ...TD, fontWeight: 600, color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={TH}>月份</th>
            {seriesDefs.map(d => <th key={d.code} style={{ ...TH, textAlign: 'right' }}>{d.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {tableData.map(([date, vals]) => (
            <tr key={date}>
              <td style={{ ...TD, color: 'var(--text-secondary)' }}>{date}</td>
              {seriesDefs.map(def => {
                const v = vals[def.code]
                const above50 = v != null && v > 50
                return (
                  <td key={def.code} style={{ ...TD, textAlign: 'right', color: v != null ? (above50 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' }}>
                    {v != null ? v.toFixed(1) : '--'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function PmiDashboard() {
  const [data, setData] = useState<PmiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/v1/pmi.json', { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(json => {
        if (!cancelled) {
          if (json.success && json.data) {
            setData(json.data)
          } else {
            setError(json.error || '加载失败')
          }
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) { setError(e.message); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [])

  if (loading) return <LoadingSkeleton type="chart" height={600} />
  if (error) return <div className="error-box">{error}</div>
  if (!data) return <div className="error-box">暂无数据（请确认 PMI 同步任务已执行）</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        {(Object.entries(PMI_DISPLAY) as [string, { label: string; color: string }][]).map(([code, def]) => {
          const s = data[code as keyof PmiData]
          return (
            <HeroCard
              key={code}
              title={def.label}
              latest={s?.latest ?? null}
              change={s?.change ?? null}
              color={def.color}
              borderColor={def.color + '33'}
            />
          )
        })}
      </div>
      <PmiChart data={data} />
      <div>
        <div style={{ marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>历史数据</div>
        <DataTable data={data} />
      </div>
    </div>
  )
}

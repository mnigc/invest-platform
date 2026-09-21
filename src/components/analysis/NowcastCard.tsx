import { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import type { NowcastResponse } from '../../lib/core'
import { ResponsiveChartBox } from '../charts/ChartBox'
import { useChartTheme } from '../ui/theme'
import { MacroCard } from '../ui/MacroCard'
import { StatTile } from '../ui/StatTile'
import {
  categoryAxis, chartAnimation, chartGrid, chartLegend,
  chartTooltip, lineSeries, valueAxis,
} from '../../lib/chartOptions'

/**
 * GDP 现在预测卡：亚特兰大 Fed GDPNow 与圣路易斯联储 ENI 双源对照。
 * 数据不可用时整卡隐藏（不打扰主流程）。
 */
export function NowcastCard() {
  const [data, setData] = useState<NowcastResponse | null>(null)
  const t = useChartTheme()

  useEffect(() => {
    let alive = true
    fetch('/api/v1/nowcast.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j?.success) return
        const d = j.data as NowcastResponse
        if (d.gdpNow.length || d.nyFed.length) setData(d)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const lastOf = (rows: { date: string; value: number | null }[]) =>
    [...rows].reverse().find((p) => p.value != null) ?? null

  const option = useMemo<EChartsOption | null>(() => {
    if (!data) return null
    const dates = Array.from(
      new Set([...data.gdpNow.map((p) => p.date), ...data.nyFed.map((p) => p.date)]),
    ).sort()
    if (dates.length === 0) return null
    const cut = Math.max(0, dates.length - 260)
    const shown = dates.slice(cut)
    const pick = (rows: { date: string; value: number | null }[]) => {
      const m = new Map(rows.map((p) => [p.date, p.value]))
      return shown.map((d) => m.get(d) ?? null)
    }
    return {
      ...chartAnimation,
      tooltip: chartTooltip(t, { valueFormatter: (v: any) => (v == null ? '--' : `${Number(v).toFixed(2)}%`) }),
      legend: chartLegend(t, ['GDPNow', 'ENI 对照']),
      grid: chartGrid({ top: 30, bottom: 24 }),
      xAxis: categoryAxis(t, shown),
      yAxis: valueAxis(t, {
        name: '当季 GDP 年化 %',
        nameTextStyle: { color: t.text3, fontSize: 10 },
        axisLabel: { color: t.text3, fontSize: 10, formatter: '{value}%' },
      }),
      series: [
        lineSeries('GDPNow', pick(data.gdpNow), t.series[0], { lineStyle: { width: 1.4 }, connectNulls: true }),
        lineSeries('ENI 对照', pick(data.nyFed), t.series[1], { lineStyle: { width: 1.2 }, connectNulls: true }),
      ],
    } as EChartsOption
  }, [data, t])

  if (!data) return null
  const gdp = lastOf(data.gdpNow)
  const eni = lastOf(data.nyFed)

  return (
    <MacroCard title="GDP 现在预测（GDPNow / ENI）" padding="sm">
      <div className="grid grid-cols-2 gap-4 mb-3">
        <StatTile
          label="亚特兰大 GDPNow"
          value={gdp ? `${gdp.value!.toFixed(2)}%` : '--'}
          sub={gdp ? `快照 ${gdp.date}` : undefined}
          tone="info"
        />
        <StatTile
          label="圣路易斯 ENI 对照"
          value={eni ? `${eni.value!.toFixed(2)}%` : '--'}
          sub={eni ? `快照 ${eni.date}` : undefined}
          tone="accent"
        />
      </div>
      {option && <ResponsiveChartBox option={option} deps={[option]} />}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        两者同属「用月度高频数据实时预测当季 GDP」方法论：GDPNow 随数据发布滚动修正，ENI 为独立第二源。
        与实际 GDP 的关系是预测对照，不是官方数字。
      </p>
    </MacroCard>
  )
}

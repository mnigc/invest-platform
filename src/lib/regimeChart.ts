import type { EChartsOption } from 'echarts'
import type { ChartTheme } from '../components/ui/theme'
import type { BacktestSnapshot } from './core'
import { REGIME_BG, REGIME_LABELS } from './regimeMeta'
import {
  categoryAxis, chartAnimation, chartDataZoom, chartGrid, chartTooltip, valueAxis,
} from './chartOptions'

export interface RegimeSegment {
  from: string
  to: string
  regime: string
  label: string
}

/** 将月度快照按连续相同体制分组，返回 [体制开始, 体制结束] 分段 */
export function regimeSegments(snapshots: BacktestSnapshot[] | null): RegimeSegment[] {
  if (!snapshots || snapshots.length < 2) return []
  const segments: RegimeSegment[] = []
  let segStart = snapshots[0].date
  let segRegime = snapshots[0].regime
  let segLabel = snapshots[0].label
  for (let i = 1; i < snapshots.length; i++) {
    if (snapshots[i].regime !== segRegime) {
      segments.push({ from: segStart, to: snapshots[i].date, regime: segRegime, label: segLabel })
      segStart = snapshots[i].date
      segRegime = snapshots[i].regime
      segLabel = snapshots[i].label
    }
  }
  const last = snapshots[snapshots.length - 1]
  segments.push({ from: segStart, to: last.date, regime: segRegime, label: segLabel })
  return segments
}

/**
 * S&P500 走势 + 宏观体制背景色带图表配置（首页与详情页共用）。
 * priceOverride：多指数对比时传入（symbol 序列对齐快照日期），折线显示该指数价格，
 * markArea/markLine 仍来自月度体制分段（体制判定与指数无关）。
 * 无有效数据时返回 null。
 */
export function buildSp500RegimeOption(
  t: ChartTheme,
  snapshots: BacktestSnapshot[] | null,
  segments: RegimeSegment[],
  priceOverride?: { name: string; data: (number | null)[] } | null,
): EChartsOption | null {
  if (!snapshots || snapshots.length < 2) return null
  const valid = snapshots.filter((s) => s.sp500Price > 0)
  if (valid.length < 2) return null
  const dates = valid.map((s) => s.date)
  const snapIdx = new Map(snapshots.map((s, i) => [s.date, i] as const))
  const prices = valid.map((s) => {
    if (priceOverride) {
      const i = snapIdx.get(s.date)
      return i != null ? (priceOverride.data[i] ?? null) : null
    }
    return s.sp500Price
  })
  const snapByDate = new Map(valid.map((s) => [s.date, s] as const))
  const seriesName = priceOverride?.name || 'S&P500'
  const total = dates.length
  const defaultStart = Math.max(0, Math.floor((total - 1300) / total * 100))
  return {
    ...chartAnimation,
    tooltip: chartTooltip(t, {
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params
        if (!p || p.axisValue == null) return ''
        const date = p.axisValue as string
        const price = p.value == null ? '--' : `$${Number(p.value).toFixed(2)}`
        const snap = snapByDate.get(date)
        const regimeRow = snap
          ? `
            <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
              <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${REGIME_BG[snap.regime] || 'transparent'};"></span>
              <span>${REGIME_LABELS[snap.regime] || snap.regime}（${snap.regime}）</span>
            </div>`
          : ''
        return `
          <div style="font-size:12px;">
            <div style="color:${t.text2};">${date}</div>
            <div style="margin-top:2px;">${seriesName}: <span style="font-weight:600;">${price}</span></div>
            ${regimeRow}
          </div>`
      },
    }),
    grid: chartGrid({ top: 14, bottom: 32 }),
    xAxis: categoryAxis(t, dates),
    yAxis: valueAxis(t, { name: seriesName, nameTextStyle: { color: t.text3, fontSize: 10 } }),
    dataZoom: [chartDataZoom(t, { start: defaultStart, end: 100 })],
    series: [
      {
        name: seriesName,
        type: 'line',
        data: prices,
        smooth: 0.25,
        lineStyle: { width: 1.3, color: t.series[2] },
        itemStyle: { color: t.series[2] },
        showSymbol: false,
        emphasis: { focus: 'series', lineStyle: { width: 1.9 } },
        markArea: {
          silent: true,
          data: segments.map((seg) => [
            {
              xAxis: seg.from,
              itemStyle: { color: REGIME_BG[seg.regime] || 'transparent' },
              label: { show: false },
            },
            { xAxis: seg.to },
          ]),
        },
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          animation: false,
          data: segments.slice(1).map((seg) => ({
            xAxis: seg.from,
            lineStyle: { color: t.border, type: 'dashed', width: 1 },
            label: { show: false },
          })),
        },
      },
    ],
  } as EChartsOption
}

import type { ChartTheme } from '../components/ui/theme'

/* =============================================================================
 * ECharts 公共配置构造器
 *
 * 三个仪表盘原先各自重复声明 tooltip / 坐标轴 / legend / dataZoom 样式，
 * 且色值来自各组件手写。这里统一从 ChartTheme（= CSS 变量运行时值）取，
 * 保证图表与 DOM 同源。
 *
 * 返回类型放宽为 any：ECharts 的按需引入类型在组合 option 时非常啰嗦，
 * 调用方最终都会 as EChartsOption / as any。
 * ============================================================================= */

type Plain = Record<string, unknown>

/** 轴触发的 tooltip；可选 valueFormatter 用于统一数值精度 */
export function chartTooltip(
  t: ChartTheme,
  opts: Plain = {},
): any {
  return {
    trigger: 'axis',
    backgroundColor: t.surface3,
    borderColor: t.border,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: t.text, fontSize: 12, fontFamily: t.fontSans },
    extraCssText: 'box-shadow: 0 8px 24px rgba(0,0,0,0.35); border-radius: 5px;',
    axisPointer: {
      lineStyle: { color: t.border, width: 1 },
      crossStyle: { color: t.border },
    },
    ...opts,
  }
}

export function chartLegend(
  t: ChartTheme,
  data: string[],
  opts: Plain = {},
): any {
  return {
    data,
    top: 0,
    right: 0,
    itemWidth: 12,
    itemHeight: 8,
    itemGap: 14,
    icon: 'roundRect',
    textStyle: { color: t.text2, fontSize: 11, fontFamily: t.fontSans },
    ...opts,
  }
}

export function chartGrid(opts: Plain = {}): any {
  return {
    left: 8,
    right: 12,
    top: 32,
    bottom: 8,
    containLabel: true,
    ...opts,
  }
}

/** 类目轴（X） */
export function categoryAxis(
  t: ChartTheme,
  data: string[],
  opts: Plain = {},
): any {
  return {
    type: 'category',
    data,
    boundaryGap: false,
    axisLine: { lineStyle: { color: t.border } },
    axisTick: { show: false },
    axisLabel: {
      color: t.text3,
      fontSize: 10,
      fontFamily: t.fontMono,
      hideOverlap: true,
    },
    ...opts,
  }
}

/** 数值轴（Y） */
export function valueAxis(t: ChartTheme, opts: Plain = {}): any {
  return {
    type: 'value',
    scale: true,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: t.text3,
      fontSize: 10,
      fontFamily: t.fontMono,
    },
    splitLine: { lineStyle: { color: t.borderSoft, type: 'dashed' } },
    ...opts,
  }
}

/** 双 Y 轴时的右侧轴：隐藏分割线避免网格打架 */
export function rightValueAxis(t: ChartTheme, opts: Plain = {}): any {
  return valueAxis(t, { splitLine: { show: false }, ...opts })
}

export function chartDataZoom(t: ChartTheme, opts: Plain = {}): any {
  return {
    type: 'slider',
    height: 16,
    bottom: 0,
    borderColor: t.border,
    backgroundColor: 'transparent',
    fillerColor: t.accentSoft,
    handleStyle: { color: t.accent, borderColor: t.accent },
    moveHandleStyle: { color: t.border },
    dataBackground: {
      lineStyle: { color: t.border },
      areaStyle: { color: t.borderSoft },
    },
    selectedDataBackground: {
      lineStyle: { color: t.accent },
      areaStyle: { color: t.accentSoft },
    },
    textStyle: { color: t.text3, fontSize: 10 },
    ...opts,
  }
}

/** 折线系列 */
export function lineSeries(
  name: string,
  data: (number | null)[],
  color: string,
  opts: Plain = {},
): any {
  return {
    name,
    type: 'line',
    data,
    smooth: 0.25,
    showSymbol: false,
    connectNulls: false,
    lineStyle: { width: 1.8, color },
    itemStyle: { color },
    emphasis: { focus: 'series', lineStyle: { width: 2.6 } },
    ...opts,
  }
}

/** 柱状系列 */
export function barSeries(
  name: string,
  data: unknown[],
  color: string,
  opts: Plain = {},
): any {
  return {
    name,
    type: 'bar',
    data,
    itemStyle: { color, borderRadius: [2, 2, 0, 0] },
    emphasis: { focus: 'series' },
    ...opts,
  }
}

/** 阈值参考线（±2σ 之类） */
export function thresholdLine(
  value: number,
  color: string,
  label?: string,
): any {
  return {
    yAxis: value,
    lineStyle: { color, type: 'dashed', width: 1 },
    symbol: ['none', 'none'],
    animation: false,
    label: label
      ? {
          show: true,
          position: 'insideEndTop',
          formatter: label,
          color,
          fontSize: 10,
          fontFamily: 'monospace',
        }
      : { show: false },
  }
}

export function markLine(lines: unknown[], opts: Plain = {}): any {
  return {
    silent: true,
    symbol: ['none', 'none'],
    animation: false,
    data: lines,
    ...opts,
  }
}

/** 信号事件竖线（类目轴上画一条虚线），用于在图上标注信号发生时点 */
export function eventLine(date: string, color: string, label?: string): any {
  return {
    xAxis: date,
    lineStyle: { color, type: 'dashed', width: 1 },
    symbol: ['none', 'none'],
    label: label
      ? { show: true, position: 'top', formatter: label, color, fontSize: 9, fontFamily: 'monospace' }
      : { show: false },
  }
}

/** 统一动画节奏：入场不要太慢，更新不要太跳 */
export const chartAnimation = {
  animationDuration: 420,
  animationEasing: 'cubicOut' as const,
  animationDurationUpdate: 320,
  animationEasingUpdate: 'cubicOut' as const,
}

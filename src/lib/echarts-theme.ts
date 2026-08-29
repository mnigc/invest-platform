import type { ChartThemeValues } from '../components/ui/theme'

/**
 * 统一 ECharts 主题配置
 * 提供标准化的 tooltip、坐标轴、legend 样式
 */

export function getTooltipStyle(theme: ChartThemeValues) {
  return {
    backgroundColor: theme.bgElevated,
    borderColor: theme.borderColor,
    borderWidth: 1,
    borderRadius: 4,
    padding: [8, 12],
    textStyle: {
      color: theme.textPrimary,
      fontSize: 12,
      fontFamily: theme.fontBody,
    },
    extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.4); backdrop-filter: blur(8px);',
  }
}

export function getAxisStyle(theme: ChartThemeValues) {
  return {
    axisLabel: {
      color: theme.textMuted,
      fontSize: 11,
      fontFamily: theme.fontMono,
    },
    axisLine: {
      lineStyle: { color: theme.borderColor },
    },
    axisTick: {
      lineStyle: { color: theme.borderColor },
    },
    splitLine: {
      lineStyle: { color: theme.borderLight, type: 'dashed' as const },
    },
  }
}

export function getLegendStyle(theme: ChartThemeValues) {
  return {
    bottom: 0,
    itemWidth: 12,
    itemHeight: 8,
    itemGap: 16,
    icon: 'roundRect',
    textStyle: {
      color: theme.textSecondary,
      fontSize: 11,
      fontFamily: theme.fontBody,
    },
  }
}

export function getDataZoomStyle(theme: ChartThemeValues) {
  return {
    type: 'slider' as const,
    start: 70,
    end: 100,
    height: 20,
    bottom: 28,
    borderColor: theme.borderColor,
    backgroundColor: theme.bgCard,
    fillerColor: theme.blueDim,
    handleStyle: { color: theme.blue },
    dataBackground: {
      lineStyle: { color: theme.borderColor },
      areaStyle: { color: theme.borderLight },
    },
    textStyle: { color: theme.textMuted, fontSize: 10 },
  }
}

export function getGridStyle(padding: { left?: number; right?: number; top?: number; bottom?: number } = {}) {
  return {
    left: padding.left ?? 12,
    right: padding.right ?? 16,
    top: padding.top ?? 16,
    bottom: padding.bottom ?? 50,
    containLabel: true,
  }
}

export function getMarkLineStyle(color: string, label?: string) {
  return {
    silent: true,
    symbol: 'none' as const,
    lineStyle: { color, type: 'dashed' as const, width: 1 },
    label: label ? { formatter: label, position: 'insideEndTop', fontSize: 10, color } : undefined,
  }
}

/**
 * 常用图表 annotation 配置
 */
export const commonAnnotations = {
  medianLine: (color = '#6B7280') => ({
    silent: true,
    symbol: 'none' as const,
    lineStyle: { color, type: 'dashed' as const, width: 1, opacity: 0.6 },
    label: { show: false },
  }),
  warningLine: (color = '#FF3B30') => ({
    silent: true,
    symbol: 'none' as const,
    lineStyle: { color, type: 'dashed' as const, width: 1.5, opacity: 0.8 },
    label: { position: 'insideEndTop', fontSize: 10, color },
  }),
}

/**
 * 图表容器样式 — 用于包裹 ECharts 组件的 div
 */
export const chartContainerStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-card)',
  borderRadius: 'var(--radius-lg)',
  padding: '12px 0',
  border: '1px solid var(--border-subtle)',
}

/**
 * 图表容器内部 div 样式
 */
export const chartInnerStyle: React.CSSProperties = {
  width: '100%',
}

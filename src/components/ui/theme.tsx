import { useEffect, useMemo, useState } from 'react'

// =============================================================================
// 主题系统（精简版）
// - 主题切换由 global.css 的 [data-theme] 选择器 + CSS 变量驱动
// - React 组件直接使用 'var(--xxx)' 字符串，无需 useTheme()
// - ECharts 不支持 CSS 变量，因此保留 useChartTheme() 提供实际颜色值
// =============================================================================

export type ThemeMode = 'dark' | 'light'

// useChartTheme 的返回值类型（供外部组件使用）
type ChartThemeValues = {
  mode: ThemeMode
  bgCard: string
  bgElevated: string
  bgCardHover: string
  bgPrimary: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  borderColor: string
  borderLight: string
  blue: string
  blueDim: string
  blueArea: string
  cyan: string
  cyanDim: string
  gold: string
  goldDim: string
  red: string
  redBg: string
  green: string
  greenBg: string
  purple: string
  orange: string
  pink: string
  fontMono: string
  fontDisplay: string
  fontBody: string
}
export type { ChartThemeValues }

// =============================================================================
// useChartTheme — 供 ECharts 使用的实际颜色值（CSS 变量不适用于 ECharts option）
// 监听 data-theme 变化自动切换
// =============================================================================

export function useChartTheme() {
  const [mode, setMode] = useState<ThemeMode>('dark')

  useEffect(() => {
    const attr = document.documentElement.dataset.theme
    if (attr === 'dark' || attr === 'light') setMode(attr)

    const handler = () => {
      const attr = document.documentElement.dataset.theme
      if (attr === 'dark' || attr === 'light') setMode(attr)
    }
    // MutationObserver 监听 html[data-theme] 属性变化
    const observer = new MutationObserver(handler)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return useMemo(() => {
    if (mode === 'light') {
      return {
        mode: 'light' as const,
        bgCard: '#ffffff',
        bgElevated: '#f8f9fb',
        bgCardHover: '#f0f2f5',
        bgPrimary: '#f5f7fa',
        textPrimary: '#1a1a2e',
        textSecondary: '#5a6a7a',
        textMuted: '#8a9aa9',
        borderColor: '#dde1e6',
        borderLight: 'rgba(0, 0, 0, 0.08)',
        blue: '#0055FF',
        blueDim: 'rgba(0, 85, 255, 0.10)',
        blueArea: 'rgba(0, 85, 255, 0.06)',
        cyan: '#0089A7',
        cyanDim: 'rgba(0, 137, 167, 0.10)',
        gold: '#D97706',
        goldDim: 'rgba(217, 119, 6, 0.10)',
        red: '#E53935',
        redBg: 'rgba(229, 57, 53, 0.10)',
        green: '#388E3C',
        greenBg: 'rgba(56, 142, 60, 0.10)',
        purple: '#8B5CF6',
        orange: '#F97316',
        pink: '#EC4899',
        fontMono: 'var(--font-mono)',
        fontDisplay: 'var(--font-display)',
        fontBody: 'var(--font-body)',
      }
    }
    return {
      mode: 'dark' as const,
      bgCard: '#131722',
      bgElevated: '#1C2128',
      bgCardHover: '#1C2128',
      bgPrimary: '#0D1117',
      textPrimary: '#FFFFFF',
      textSecondary: '#9CA3AF',
      textMuted: '#6B7280',
      borderColor: '#2A2E39',
      borderLight: 'rgba(42, 46, 57, 0.35)',
      blue: '#3B82F6',
      blueDim: 'rgba(59, 130, 246, 0.12)',
      blueArea: 'rgba(59, 130, 246, 0.08)',
      cyan: '#06B6D4',
      cyanDim: 'rgba(6, 182, 212, 0.12)',
      gold: '#F59E0B',
      goldDim: 'rgba(245, 158, 11, 0.12)',
      red: '#F23645',
      redBg: 'rgba(242, 54, 69, 0.15)',
      green: '#089981',
      greenBg: 'rgba(8, 153, 129, 0.15)',
      purple: '#A855F7',
      orange: '#F97316',
      pink: '#EC4899',
      fontMono: 'var(--font-mono)',
      fontDisplay: 'var(--font-display)',
      fontBody: 'var(--font-body)',
    }
  }, [mode])
}

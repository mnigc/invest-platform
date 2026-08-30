import { useEffect, useMemo, useState } from 'react'

/* =============================================================================
 * 主题系统
 *
 * 唯一色值来源是 tokens.css 里的 --c-* CSS 变量：
 *   - DOM 侧由 Tailwind 通过 rgb(var(--c-xxx) / <alpha-value>) 消费；
 *   - ECharts 不认 CSS 变量，所以这里在运行时用 getComputedStyle 读取已解析值。
 *
 * 由此 DOM 与图表永远同源，不可能再出现「样式改了图表没改」的漂移。
 * 本文件不再包含任何硬编码色值（SSR 种子除外，见下）。
 * ============================================================================= */

export type ThemeMode = 'dark' | 'light'

/** 需要读取的 CSS 变量名（去掉 --c- 前缀）→ 内部键名 */
const TRIPLET_MAP = {
  bg: 'bg',
  surface: 'surface',
  surface2: 'surface-2',
  surface3: 'surface-3',
  border: 'border',
  borderStrong: 'border-strong',
  text: 'text',
  text2: 'text-2',
  text3: 'text-3',
  up: 'up',
  down: 'down',
  accent: 'accent',
  accentHover: 'accent-hover',
  warn: 'warn',
  info: 'info',
} as const

type TripletKey = keyof typeof TRIPLET_MAP
type Triplets = Record<TripletKey, string> & { series: string[] }

/**
 * SSR 种子值。
 * Astro 会在服务端渲染 client:load 组件，那时 document 不存在。
 * 因为这组值只用于「首帧 SSR HTML」，而 ECharts 一律在 useEffect 里才初始化，
 * 所以图表实际取到的永远是挂载后读取的真实值。
 * 若修改了 tokens.css 的 dark 主题，请同步这里。
 */
/** SSR 阶段的字体兜底（与 tokens.css 的 --font-* 保持一致） */
const SSR_FONTS = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
}

const SSR_SEED: Triplets = {
  bg: '8 11 16',
  surface: '14 18 24',
  surface2: '19 24 32',
  surface3: '26 32 41',
  border: '30 37 48',
  borderStrong: '44 54 68',
  text: '232 237 243',
  text2: '154 165 180',
  text3: '122 134 150',
  up: '0 200 83',
  down: '255 59 48',
  accent: '59 130 246',
  accentHover: '96 165 250',
  warn: '245 158 11',
  info: '6 182 212',
  series: ['59 130 246', '6 182 212', '245 158 11', '167 139 250', '236 72 153', '249 115 22'],
}

/** "8 11 16" → "rgb(8, 11, 16)" / "rgba(8, 11, 16, 0.12)"（逗号语法，canvas 兼容性最好） */
function rgb(triplet: string, alpha = 1): string {
  const parts = triplet.split(/[\s,]+/).filter(Boolean)
  if (parts.length < 3) return 'transparent'
  const [r, g, b] = parts
  return alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function readTriplets(): Triplets {
  const cs = getComputedStyle(document.documentElement)
  const out = {} as Triplets
  for (const key of Object.keys(TRIPLET_MAP) as TripletKey[]) {
    out[key] = cs.getPropertyValue(`--c-${TRIPLET_MAP[key]}`).trim()
  }
  out.series = [1, 2, 3, 4, 5, 6].map((i) =>
    cs.getPropertyValue(`--c-chart-${i}`).trim(),
  )
  return out
}

/**
 * 读取字体族的真实值。
 * ECharts 把文字画在 canvas 上，ctx.font 不解析 CSS 变量，
 * 所以必须取计算后的字族字符串，不能直接传 'var(--font-mono)'。
 */
function readFonts(): { sans: string; mono: string } {
  const cs = getComputedStyle(document.documentElement)
  return {
    sans: cs.getPropertyValue('--font-sans').trim(),
    mono: cs.getPropertyValue('--font-mono').trim(),
  }
}

/** 当前主题模式，随 html[data-theme] 变化自动更新 */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>('dark')

  useEffect(() => {
    const read = () => {
      const attr = document.documentElement.dataset.theme
      setMode(attr === 'light' ? 'light' : 'dark')
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return mode
}

export type ChartTheme = {
  mode: ThemeMode
  /* 表面 */
  bg: string
  surface: string
  surface2: string
  surface3: string
  border: string
  borderSoft: string
  /* 文本 */
  text: string
  text2: string
  text3: string
  /* 语义：涨/跌 */
  up: string
  down: string
  upBg: string
  downBg: string
  /** 半透明版，用于柱状图填充等需要弱化的场景 */
  upSoft: string
  downSoft: string
  /* 功能色 */
  accent: string
  accentHover: string
  accentSoft: string
  info: string
  warn: string
  /* 多序列图表按顺序取用 */
  series: string[]
  /* 字体 */
  fontSans: string
  fontMono: string
}

/** ECharts 用的已解析色值。主题切换时自动重读。 */
export function useChartTheme(): ChartTheme {
  const mode = useThemeMode()
  const [t, setT] = useState<Triplets>(SSR_SEED)
  const [fonts, setFonts] = useState(SSR_FONTS)

  useEffect(() => {
    setT(readTriplets())
    setFonts(readFonts())
  }, [mode])

  return useMemo<ChartTheme>(
    () => ({
      mode,
      bg: rgb(t.bg),
      surface: rgb(t.surface),
      surface2: rgb(t.surface2),
      surface3: rgb(t.surface3),
      border: rgb(t.border),
      borderSoft: rgb(t.border, 0.55),
      text: rgb(t.text),
      text2: rgb(t.text2),
      text3: rgb(t.text3),
      up: rgb(t.up),
      down: rgb(t.down),
      upBg: rgb(t.up, 0.15),
      downBg: rgb(t.down, 0.15),
      upSoft: rgb(t.up, 0.5),
      downSoft: rgb(t.down, 0.5),
      accent: rgb(t.accent),
      accentHover: rgb(t.accentHover),
      accentSoft: rgb(t.accent, 0.12),
      info: rgb(t.info),
      warn: rgb(t.warn),
      series: t.series.map((s) => rgb(s)),
      fontSans: fonts.sans,
      fontMono: fonts.mono,
    }),
    [mode, t, fonts],
  )
}

export type { ChartTheme as ChartThemeValues }

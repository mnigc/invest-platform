/* =============================================================================
 * 主题偏好管理
 *
 * 明暗由 tokens.css 的 --c-* 变量承载，这里只负责：
 *   1. 解析用户偏好（dark / light / auto）
 *   2. 把结果写到 html[data-theme]
 *   3. 持久化偏好 + 同步 <meta name="theme-color">
 *
 * 注意：这里绝不写 CSS 变量或内联 background-color —— 那会压过样式表规则。
 * 首帧底色由 Layout.astro 的 <style is:inline> 承担（规则级，可被正常覆盖）。
 * ============================================================================= */

export type ThemePref = 'dark' | 'light' | 'auto'
export type ThemeMode = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'theme'

/** 必须与 tokens.css 的 --c-bg 保持一致（仅用于 <meta name="theme-color">） */
const THEME_COLOR: Record<ThemeMode, string> = {
  dark: '#080B10',
  light: '#F2F4F7',
}

export function getPref(): ThemePref {
  const attr = document.documentElement.dataset.themePref
  if (attr === 'dark' || attr === 'light' || attr === 'auto') return attr
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'auto') return stored
  } catch {
    /* localStorage 不可用（隐私模式）时退回 auto */
  }
  return 'auto'
}

export function resolveTheme(pref: ThemePref): ThemeMode {
  if (pref === 'dark' || pref === 'light') return pref
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(pref: ThemePref): ThemeMode {
  const doc = document.documentElement
  const theme = resolveTheme(pref)

  doc.dataset.theme = theme
  doc.dataset.themePref = pref

  // 切换瞬间才挂过渡类，避免全局常驻 transition 拖累性能
  doc.classList.add('theme-transitioning')
  window.setTimeout(() => doc.classList.remove('theme-transitioning'), 400)

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[theme])

  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    /* 忽略写入失败 */
  }

  return theme
}

/** dark → light → auto → dark */
export function nextPref(pref: ThemePref): ThemePref {
  return pref === 'dark' ? 'light' : pref === 'light' ? 'auto' : 'dark'
}

/** 监听系统主题变化（仅 auto 模式需要响应） */
export function watchSystemTheme(onChange: (mode: ThemeMode) => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: light)')
  const handler = (e: MediaQueryListEvent) => onChange(e.matches ? 'light' : 'dark')
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}

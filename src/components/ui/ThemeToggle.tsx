import { useEffect, useState } from 'react'
import {
  applyTheme,
  getPref,
  nextPref,
  resolveTheme,
  watchSystemTheme,
  type ThemeMode,
  type ThemePref,
} from '../../lib/theme'

const LABEL: Record<ThemePref, string> = {
  dark: '深色模式',
  light: '浅色模式',
  auto: '跟随系统',
}

const HINT: Record<ThemePref, string> = {
  dark: '点击切换为浅色',
  light: '点击切换为跟随系统',
  auto: '点击切换为深色',
}

function Icon({ pref }: { pref: ThemePref }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (pref === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    )
  }
  if (pref === 'dark') {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>('auto')
  const [mode, setMode] = useState<ThemeMode>('dark')

  useEffect(() => {
    const p = getPref()
    setPref(p)
    setMode(resolveTheme(p))
    return watchSystemTheme((m) => {
      if (getPref() === 'auto') {
        applyTheme('auto')
        setMode(m)
      }
    })
  }, [])

  return (
    <button
      type="button"
      onClick={() => {
        const p = nextPref(pref)
        setPref(p)
        setMode(applyTheme(p))
      }}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-ink-3 transition-colors duration-1 ease-terminal hover:border-line-strong hover:bg-surface-2 hover:text-ink"
      title={`${LABEL[pref]}（${HINT[pref]}）`}
      aria-label={`主题：${LABEL[pref]}，${HINT[pref]}`}
    >
      <Icon pref={pref} />
      <span className="sr-only" data-mode={mode} />
    </button>
  )
}

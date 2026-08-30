import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom'
  className?: string
}

/**
 * Portal 提示气泡。
 *
 * 取代原先的 CSS-only [data-tooltip]：那种实现是伪元素，会被祖先的
 * overflow:hidden 直接裁掉（信号卡的证据标签正是受害者），且触屏不可用。
 * 这里渲染到 document.body，不受任何祖先裁剪，并同时支持悬停 / 键盘 / 点击。
 */
export function Tooltip({ content, children, side = 'top', className }: Props) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const show = () => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // 贴边时把气泡拉回视口内，避免被截断
    const half = 140
    const left = Math.min(Math.max(r.left + r.width / 2, half), window.innerWidth - half)
    setCoords({
      top: side === 'top' ? r.top - 6 : r.bottom + 6,
      left,
    })
  }

  const hide = () => setCoords(null)

  useEffect(() => {
    if (!coords) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    const reposition = () => hide()
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [coords])

  return (
    <>
      <span
        ref={triggerRef}
        className={`inline-flex ${className ?? ''}`}
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => (coords ? hide() : show())}
      >
        {children}
      </span>

      {mounted &&
        coords &&
        createPortal(
          <div
            role="tooltip"
            className={[
              'pointer-events-none fixed z-tooltip max-w-[17rem] rounded-md border border-line bg-surface-3 px-2 py-1.5 text-xs leading-relaxed text-ink shadow-lg',
              side === 'top' ? '-translate-x-1/2 -translate-y-full' : '-translate-x-1/2',
            ].join(' ')}
            style={{ top: coords.top, left: coords.left }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  )
}

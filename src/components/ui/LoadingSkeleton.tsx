interface Props {
  rows?: number
  type?: 'card' | 'table' | 'chart' | 'number'
  height?: number
  label?: string
}

/** 确定性宽度序列 —— 不能用 Math.random()：
 *  Astro 的 client:load 会先 SSR 再 hydrate，随机会导致两端 HTML 不一致。 */
const ROW_WIDTHS = ['100%', '94%', '82%', '88%', '70%', '90%']

export function LoadingSkeleton({
  rows = 3,
  type = 'card',
  height,
  label = '加载中',
}: Props) {
  const skeleton = (w: string, h: number, extra = '') => (
    <div
      className={`skeleton rounded-md ${extra}`}
      style={{ width: w, height: `${h}px` }}
    />
  )

  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>

      {type === 'chart' &&
        skeleton('100%', height ?? 320, 'rounded-lg border border-line')}

      {type === 'number' && skeleton('80px', 32)}

      {type === 'table' && (
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="h-8 border-b border-line bg-surface-2" />
          <div className="flex flex-col">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-line px-3 py-2">
                {skeleton(ROW_WIDTHS[i % ROW_WIDTHS.length], 14)}
              </div>
            ))}
          </div>
        </div>
      )}

      {type === 'card' && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-3.5">
          {skeleton('40%', 14)}
          {Array.from({ length: rows }).map((_, i) =>
            skeleton(ROW_WIDTHS[(i + 1) % ROW_WIDTHS.length], 12),
          )}
          {height ? skeleton('100%', height, 'mt-1') : null}
        </div>
      )}
    </div>
  )
}

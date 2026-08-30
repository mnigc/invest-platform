import { useEffect, useMemo, useState } from 'react'

interface SyncRow {
  sync_type: string
  status: string
  records_count: number | null
  finished_at: string | null
}

interface StatusPayload {
  sync: SyncRow[]
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '--'
  const minutes = Math.round((Date.now() - then) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

function absoluteTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}

type Health = 'ok' | 'warn' | 'down' | 'unknown'

const HEALTH_DOT: Record<Health, string> = {
  ok: 'bg-up',
  warn: 'bg-warn',
  down: 'bg-down',
  unknown: 'bg-ink-3',
}

const HEALTH_TEXT: Record<Health, string> = {
  ok: 'text-ink-2',
  warn: 'text-warn',
  down: 'text-down',
  unknown: 'text-ink-3',
}

const SOURCES = 'FRED · Yahoo Finance · akshare'

/**
 * 顶栏数据新鲜度指示。
 * 读取 /api/v1/status.json 的真实同步完成时间 —— 取代原先显示当前时钟的错误实现。
 */
export function DataFreshness() {
  const [rows, setRows] = useState<SyncRow[]>([])
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/v1/status.json')
      .then((r) => r.json())
      .then((j: { success?: boolean; data?: StatusPayload }) => {
        if (!alive) return
        if (j?.success && Array.isArray(j.data?.sync)) setRows(j.data!.sync)
        else setFailed(true)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  const latest = useMemo(() => {
    const withTime = rows.filter((r) => r.finished_at)
    if (!withTime.length) return null
    return withTime.reduce((a, b) =>
      String(b.finished_at) > String(a.finished_at) ? b : a,
    )
  }, [rows])

  const health: Health = useMemo(() => {
    if (failed || !latest) return 'unknown'
    if (latest.status === 'failed') return 'down'
    if (latest.status !== 'success') return 'warn'
    const ageHours = (Date.now() - new Date(String(latest.finished_at)).getTime()) / 3_600_000
    return ageHours > 48 ? 'warn' : 'ok'
  }, [failed, latest])

  const label = failed
    ? '数据状态未知'
    : latest?.finished_at
      ? `同步 ${relativeTime(String(latest.finished_at))}`
      : '暂无同步记录'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        className={`inline-flex h-8 items-center gap-2 rounded-md border border-line px-2 text-2xs transition-colors duration-1 ease-terminal hover:border-line-strong hover:bg-surface-2 ${HEALTH_TEXT[health]}`}
        aria-label={`数据新鲜度：${label}`}
        aria-expanded={open}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${HEALTH_DOT[health]}`} />
        <span className="num whitespace-nowrap">{label}</span>
      </button>

      {open && (
        <div
          role="tooltip"
          className="absolute right-0 top-[calc(100%+6px)] z-tooltip w-64 rounded-md border border-line bg-surface-3 p-2.5 text-2xs shadow-lg"
        >
          <div className="mb-1.5 flex items-center justify-between text-ink-3">
            <span>数据源</span>
            <span className="num">{SOURCES}</span>
          </div>
          <div className="mb-1.5 border-t border-line pt-1.5 text-ink-3">
            最近 5 次同步
          </div>
          {rows.length === 0 && <div className="text-ink-3">暂无记录</div>}
          <ul className="space-y-1">
            {rows.slice(0, 5).map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-ink-2">{r.sync_type}</span>
                <span
                  className={`num shrink-0 ${
                    r.status === 'success'
                      ? 'text-up'
                      : r.status === 'failed'
                        ? 'text-down'
                        : 'text-warn'
                  }`}
                >
                  {r.status}
                </span>
                <span className="num shrink-0 text-ink-3">
                  {r.finished_at ? absoluteTime(String(r.finished_at)).slice(5) : '--'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

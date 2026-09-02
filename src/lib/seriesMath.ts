/* =============================================================================
 * 指标序列的纯计算工具（无副作用、不依赖数据库）
 *
 * **刻意与 series.ts 分开**：series.ts 里的 loadSeries 会引入 lib/db
 * （@neondatabase/serverless），而这里的函数要被 React 客户端组件直接复用。
 * 若从 series.ts 导入，打包器会把数据库驱动一并打进浏览器包 —— 不仅体积暴涨，
 * db.ts 里的 import.meta.env 在客户端也可能取不到值。
 *
 * 规则：本文件只允许纯函数，永远不要 import 任何服务端模块。
 * ========================================================================== */

export interface Point {
  date: string
  value: number
}

/**
 * 「截至某日」查值：返回 date 当天、或其之前最近一次有值的观测。
 *
 * 用于把低频序列对齐到高频主轴（例如把周频数据对齐到日频主轴）。
 * 直接按日期取 key 会大量落空，必须做 as-of 查找，否则派生序列全是断点。
 * points 必须按日期升序。
 */
export function asOfLookup(points: Point[], date: string): number | null {
  let lo = 0
  let hi = points.length - 1
  let found: number | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].date <= date) {
      found = points[mid].value
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/** 两个日期之间相差的月数（a - b），只比较到「月」这一级 */
function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (ay - by) * 12 + (am - bm)
}

/**
 * 计算同比（%），输入按日期升序。
 *
 * 基准点取「12 个自然月前的那个月里最后一个有值的点」：
 *   - 月频序列 → 正好是 12 期前那个点；
 *   - 日频序列 → 是 12 个月前那个月的最后一个交易日。
 * 这样既不会因节假日缺漏而取到 13 个月前（那会算出假拐点），
 * 也不需要为日频/月频分别写一套逻辑。
 */
export function yoySeries(points: Point[]): { date: string; value: number | null }[] {
  return points.map((p, i) => {
    for (let j = i - 1; j >= 0; j--) {
      const gap = monthsBetween(p.date, points[j].date)
      if (gap === 12) {
        const base = points[j].value
        if (!base) return { date: p.date, value: null }
        return { date: p.date, value: +(((p.value - base) / base) * 100).toFixed(2) }
      }
      if (gap > 12) break
    }
    return { date: p.date, value: null }
  })
}

/**
 * 按精确日期把两组「日期 → 值」合并，只保留双方都有值的交点。
 * 刻意不做 ffill —— 造出并不存在的交点会误导判读。
 */
export function mergeByDate(
  a: { date: string; value: number | null }[],
  b: { date: string; value: number | null }[],
): { date: string; a: number; b: number }[] {
  const bMap = new Map(
    b.filter((p) => p.value != null).map((p) => [p.date, p.value as number]),
  )
  const out: { date: string; a: number; b: number }[] = []
  for (const p of a) {
    if (p.value == null) continue
    const bv = bMap.get(p.date)
    if (bv == null) continue
    out.push({ date: p.date, a: p.value, b: bv })
  }
  return out
}

/**
 * 取序列最后一个非空值。
 * 日频序列尾部常有缺失（FRED 用 "." 表示），直接取末位元素容易拿到 null。
 */
export function lastValue(points: { value: number | null }[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const v = points[i].value
    if (v != null && Number.isFinite(v)) return v
  }
  return null
}

/**
 * Sahm Rule：失业率 3 个月移动平均 − 过去 12 个月该均线的最低值。
 *
 * 阈值 0.5 —— 历史上该规则触发时，经济几乎都已在衰退中（NBER 事后确认）。
 * 只需要失业率一条序列，无需额外数据源，是性价比极高的衍生指标。
 */
export function sahmRule(points: Point[]): { date: string; value: number | null }[] {
  // 第一步：3 个月移动平均
  const mma3: (number | null)[] = points.map((_, i) => {
    if (i < 2) return null
    const win = points.slice(i - 2, i + 1)
    if (win.some((p) => !Number.isFinite(p.value))) return null
    return +(win.reduce((s, p) => s + p.value, 0) / win.length).toFixed(4)
  })

  // 第二步：当前 3MMA − 过去 12 个月（含当前）3MMA 的最低值
  return points.map((p, i) => {
    const cur = mma3[i]
    if (cur == null) return { date: p.date, value: null }
    let low: number | null = null
    for (let j = Math.max(0, i - 11); j <= i; j++) {
      const v = mma3[j]
      if (v == null) continue
      if (low == null || v < low) low = v
    }
    if (low == null) return { date: p.date, value: null }
    return { date: p.date, value: +(cur - low).toFixed(3) }
  })
}

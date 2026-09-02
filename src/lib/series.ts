import { query } from './db'
import { toDateStr } from './date'
import type { Point } from './seriesMath'

/* =============================================================================
 * 指标序列取数（服务端专用）
 *
 * 只放需要连数据库的 loadSeries。纯计算函数（asOfLookup / yoySeries /
 * mergeByDate / sahmRule）都在 seriesMath.ts —— 客户端组件要复用它们，
 * 从那里导入才不会把 lib/db 打进浏览器包。
 * ========================================================================== */

/**
 * 拉取单条指标序列，返回按日期**升序**排列的点。
 * 与 Python 侧 indicators.py 的增量同步共用同一张 indicator_data 表。
 */
export async function loadSeries(code: string, limitDays = 1825): Promise<Point[]> {
  const rows = await query<any>(
    `SELECT d.period_date, d.value
     FROM indicator_data d
     JOIN indicators i ON i.id = d.indicator_id
     WHERE i.code = ? AND d.value IS NOT NULL
     ORDER BY d.period_date DESC LIMIT ?`,
    [code, limitDays],
  )
  return rows
    .map((r: any) => ({ date: toDateStr(r.period_date), value: Number(r.value) }))
    .reverse()
}

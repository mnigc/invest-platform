import { Pool } from '@neondatabase/serverless'

// 运行时 env 注入点：由 src/middleware.ts 在每个请求开始时注入，
// 来源是 cloudflare:workers 的 env（secret 用 `wrangler secret put` 配置）。
// 拿不到注入时回退到 Vite 的 import.meta.env（本地 .env），否则本地开发会连不上库。
let _runtimeEnv: Record<string, string | undefined> | null = null
let _pool: Pool | null = null

export function setRuntimeEnv(env: Record<string, string | undefined> | null): void {
  _runtimeEnv = env
  _pool = null
}

/**
 * 返回当前生效的 DATABASE_URL，供调用方判断「连接串是否真的变了」。
 * 用于避免中间件每请求都重建 Pool —— 那会让 10 路并发变成 10 次 WebSocket 握手，
 * 冷启动时直接拖垮首屏最重的几个分析接口。
 */
export function getRuntimeDatabaseUrl(): string | undefined {
  return (_runtimeEnv ?? resolveEnv()).DATABASE_URL
}

function resolveEnv(): Record<string, string | undefined> {
  if (_runtimeEnv) return _runtimeEnv
  return import.meta.env as unknown as Record<string, string | undefined>
}

function getPool(): Pool {
  if (!_pool) {
    const env = resolveEnv()
    if (!env.DATABASE_URL) {
      throw new Error('Database not configured: set DATABASE_URL (local .env or Cloudflare secret)')
    }
    _pool = new Pool({ connectionString: env.DATABASE_URL })
  }
  return _pool
}

function prepareSql(sqlStr: string): string {
  // 逐段扫描：把 SQL 拆成「字符串字面量」与「代码」两类片段，先完成
  // ? → $n / 反引号 → " 的改写，再只对代码片段做 MySQL 函数改写——
  // 否则字符串字面量里的 CURDATE()/NOW() 等字样会被误替换。
  const parts: { str: boolean; text: string }[] = []
  let inStr = false
  let idx = 1
  let buf = ''
  const push = (str: boolean) => {
    if (buf) parts.push({ str, text: buf })
    buf = ''
  }
  for (let i = 0; i < sqlStr.length; i++) {
    const c = sqlStr[i]
    if (c === "'") {
      if (inStr && sqlStr[i + 1] === "'") {
        // PG 语义：'' 是字符串内的转义引号（不按 MySQL 的 \' 处理，
        // standard_conforming_strings=on 下 \' 是字面反斜杠+结束符）
        buf += "''"
        i++
        continue
      }
      push(inStr)
      inStr = !inStr
      buf = "'"
      continue
    }
    if (!inStr && c === '?') {
      // 占位符本身就是代码片段，直接并入当前 code 缓冲
      // （不要单独分段，否则 INTERVAL ? DAY 这类跨词改写会匹配不到）
      buf += `$${idx++}`
      continue
    }
    if (!inStr && c === '`') {
      buf += '"'
      continue
    }
    buf += c
  }
  push(inStr)

  return parts
    .map(({ str, text }) => {
      if (str) return text
      let s = text
      s = s.replace(/DATE_SUB\(\s*CURDATE\(\)\s*,\s*INTERVAL\s+(\d+)\s+(YEAR|MONTH|DAY)s?\s*\)/gi, `CURRENT_DATE - INTERVAL '$1 $2'`)
      s = s.replace(/CURDATE\(\)\s*-\s*INTERVAL\s+(\d+)\s+(YEAR|MONTH|DAY)s?/gi, `CURRENT_DATE - INTERVAL '$1 $2'`)
      s = s.replace(/\bCURDATE\(\)/gi, 'CURRENT_DATE')
      s = s.replace(/\bNOW\(\)/gi, 'now()')
      // 占位符形式的 INTERVAL ? DAY 会先被转成 INTERVAL $n DAY（非法 PG 语法），
      // 这里改写为 ($n * INTERVAL '1 UNIT')
      s = s.replace(/INTERVAL\s+(\$\d+)\s+(YEAR|MONTH|DAY|HOUR|MINUTE|SECOND)s?\b/gi, "($1 * INTERVAL '1 $2')")
      return s
    })
    .join('')
}

export async function query<T = any>(sqlStr: string, values?: any[]): Promise<T[]> {
  const pool = getPool()
  const prepared = prepareSql(sqlStr)
  const result = await pool.query(prepared, values ?? [])
  return result.rows as T[]
}

export async function queryOne<T = any>(sqlStr: string, values?: any[]): Promise<T | null> {
  const rows = await query<T>(sqlStr, values)
  return rows.length > 0 ? rows[0] : null
}

export async function execute(sqlStr: string, values?: any[]): Promise<{ rowCount: number }> {
  const pool = getPool()
  const prepared = prepareSql(sqlStr)
  const result = await pool.query(prepared, values ?? [])
  return { rowCount: result.rowCount ?? 0 }
}

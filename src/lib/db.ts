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
  let out = ''
  let idx = 1
  let inStr = false
  for (let i = 0; i < sqlStr.length; i++) {
    const c = sqlStr[i]
    if (c === "'" && sqlStr[i - 1] !== '\\') {
      if (inStr && sqlStr[i + 1] === "'") {
        out += "''"
        i++
        continue
      }
      inStr = !inStr
      out += c
      continue
    }
    if (!inStr && c === '?') {
      out += `$${idx++}`
      continue
    }
    if (!inStr && c === '`') {
      out += '"'
      continue
    }
    out += c
  }

  out = out.replace(/DATE_SUB\(\s*CURDATE\(\)\s*,\s*INTERVAL\s+(\d+)\s+(YEAR|MONTH|DAY)s?\s*\)/gi, `CURRENT_DATE - INTERVAL '$1 $2'`)
  out = out.replace(/CURDATE\(\)\s*-\s*INTERVAL\s+(\d+)\s+(YEAR|MONTH|DAY)s?/gi, `CURRENT_DATE - INTERVAL '$1 $2'`)
  out = out.replace(/\bCURDATE\(\)/gi, 'CURRENT_DATE')
  if (!inStr) out = out.replace(/\bNOW\(\)/gi, 'now()')
  return out
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

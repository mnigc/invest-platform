import { Pool } from '@neondatabase/serverless'

const env = import.meta.env

if (!env.DATABASE_URL) {
  console.warn('[DB] Missing DATABASE_URL env var. Set it in .env or via `wrangler secret put DATABASE_URL`')
}

let _pool: Pool | null = null

function getPool(): Pool {
  if (!_pool) {
    if (!env.DATABASE_URL) {
      throw new Error('Database not configured: set DATABASE_URL env var')
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

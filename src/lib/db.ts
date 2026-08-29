import pg from 'pg'

const env = import.meta.env

if (!env.DATABASE_URL) {
  console.warn('[DB] Missing DATABASE_URL env var. Set it in .env (Supabase direct or pooler connection string)')
}

const DB_CONFIG = {
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  ssl: { rejectUnauthorized: false },
}

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) {
    if (!DB_CONFIG.connectionString) {
      throw new Error('Database not configured: set DATABASE_URL env var')
    }
    pool = new pg.Pool(DB_CONFIG)
  }
  return pool
}

// ── MySQL → PostgreSQL 兼容层 ──
// 1) '?' 占位符 → $1..$n（跳过单引号字符串内）
// 2) DATE_SUB(CURDATE(), INTERVAL n UNIT) / CURDATE() - INTERVAL n UNIT → CURRENT_DATE - INTERVAL 'n UNIT'
// 3) 反引号标识符 → 双引号
function prepareSql(sql: string): string {
  let out = ''
  let idx = 1
  let inStr = false
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (c === "'" && sql[i - 1] !== '\\') {
      if (inStr && sql[i + 1] === "'") {
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

export async function query<T = any>(sql: string, values?: any[]): Promise<T[]> {
  const p = getPool()
  const res = await p.query(prepareSql(sql), values)
  return res.rows as T[]
}

export async function queryOne<T = any>(sql: string, values?: any[]): Promise<T | null> {
  const rows = await query<T>(sql, values)
  return rows.length > 0 ? rows[0] : null
}

export async function execute(sql: string, values?: any[]): Promise<{ rowCount: number }> {
  const p = getPool()
  const res = await p.query(prepareSql(sql), values)
  return { rowCount: res.rowCount ?? 0 }
}

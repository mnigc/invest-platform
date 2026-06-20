import mysql from 'mysql2/promise'

const env = import.meta.env

if (!env.DB_HOST || !env.DB_USER || !env.DB_PASSWORD) {
  console.warn('[DB] Missing DB_HOST, DB_USER, or DB_PASSWORD env vars. Set them in .env')
}

const DB_CONFIG = {
  host: env.DB_HOST,
  port: Number(env.DB_PORT) || 3306,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME || 'invest_platform',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
  dateStrings: true,
}

let pool: mysql.Pool | null = null

export function getPool(): mysql.Pool {
  if (!pool) {
    if (!DB_CONFIG.host || !DB_CONFIG.user || !DB_CONFIG.password) {
      throw new Error('Database not configured: set DB_HOST, DB_USER, DB_PASSWORD env vars')
    }
    pool = mysql.createPool(DB_CONFIG)
  }
  return pool
}

export async function query<T = any>(sql: string, values?: any[]): Promise<T[]> {
  const p = getPool()
  const [rows] = await p.execute(sql, values)
  return rows as T[]
}

export async function queryOne<T = any>(sql: string, values?: any[]): Promise<T | null> {
  const rows = await query<T>(sql, values)
  return rows.length > 0 ? rows[0] : null
}

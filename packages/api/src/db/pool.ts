import mysql from 'mysql2/promise'
import type { Pool } from 'mysql2/promise'

let pool: Pool | null = null

function getPool(): Pool {
  if (pool) return pool

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME = 'invest_platform' } = process.env as Record<string, string>

  if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
    throw new Error('Database not configured: Missing DB_HOST, DB_USER, or DB_PASSWORD')
  }

  pool = mysql.createPool({
    host: DB_HOST,
    port: Number(DB_PORT) || 3306,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  })

  return pool
}

export async function query<T = any>(sql: string, values?: any[]): Promise<T[]> {
  const [rows] = await getPool().execute(sql, values)
  return rows as T[]
}

export async function queryOne<T = any>(sql: string, values?: any[]): Promise<T | null> {
  const [rows] = await getPool().execute(sql, values)
  const arr = rows as T[]
  return arr.length > 0 ? arr[0] : null
}

import mysql from 'mysql2/promise';

const env = import.meta.env;

const DB_CONFIG = {
  host: env.DB_HOST || '204.44.121.43',
  port: Number(env.DB_PORT) || 3306,
  user: env.DB_USER || 'mnigc',
  password: env.DB_PASSWORD || 'woaiyinyue.4',
  database: env.DB_NAME || 'invest_platform',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool(DB_CONFIG);
  }
  return pool;
}

export async function query<T = any>(sql: string, values?: any[]): Promise<T[]> {
  const p = getPool();
  const [rows] = await p.execute(sql, values);
  return rows as T[];
}

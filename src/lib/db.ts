import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.DB_HOST || '204.44.121.43',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'mnigc',
  password: process.env.DB_PASSWORD || 'woaiyinyue.4',
  database: process.env.DB_NAME || 'invest_platform',
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

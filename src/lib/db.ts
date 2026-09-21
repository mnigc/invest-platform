import { AsyncLocalStorage } from 'node:async_hooks'
import { Pool } from '@neondatabase/serverless'

// 运行时 env 注入点：由 src/middleware.ts 在每个请求开始时注入，
// 来源是 cloudflare:workers 的 env（secret 用 `wrangler secret put` 配置）。
// 拿不到注入时回退到 Vite 的 import.meta.env（本地 .env），否则本地开发会连不上库。
// env 优先放在请求作用域（ALS）里，避免 isolate 级模块变量被并发请求互相覆盖。
let _fallbackEnv: Record<string, string | undefined> | null = null

export function setRuntimeEnv(env: Record<string, string | undefined> | null): void {
  const scope = requestDb.getStore()
  if (scope) scope.env = env ?? undefined
  else _fallbackEnv = env
}

export function getRuntimeDatabaseUrl(): string | undefined {
  return resolveEnv().DATABASE_URL
}

function resolveEnv(): Record<string, string | undefined> {
  const scope = requestDb.getStore()
  // 只认「真正带 DATABASE_URL 的那一层」：workerd 的 env 对象在本地开发时
  // 非空但缺 DATABASE_URL（只有系统环境变量透传），若按 truthy 短路就会
  // 把后面的回退层全部遮住，本地永远报 Database not configured。
  if (scope?.env?.DATABASE_URL) return scope.env
  if (_fallbackEnv?.DATABASE_URL) return _fallbackEnv
  return import.meta.env as unknown as Record<string, string | undefined>
}

/**
 * 连接必须「在单个请求内创建、使用、关闭」：
 * @neondatabase/serverless 官方明确 WebSocket 连接 cannot outlive a single request
 * （workerd 按请求隔离 I/O 上下文，跨请求复用已打开的 WebSocket 会触发
 * "Cannot perform I/O on behalf of a different request"，isolate 级硬杀请求，
 * 表现为随机 Cloudflare 1101 且请求内 try/catch / 全局监听都抓不到异常）。
 * 这里用 AsyncLocalStorage 做请求作用域：同一请求内的多条查询共用一条连接，
 * 并发请求各自独立，请求结束（含抛错）时统一 end() 回收。
 * 代价是每次请求多一次 WebSocket 握手（约 1.2s），换取接口不再随机 1101。
 */
interface RequestDb {
  pool?: Pool
  env?: Record<string, string | undefined>
}

const requestDb = new AsyncLocalStorage<RequestDb>()

export function withRequestDb<T>(fn: () => Promise<T>): Promise<T> {
  const scope: RequestDb = {}
  return requestDb.run(scope, async () => {
    try {
      return await fn()
    } finally {
      const pool = scope.pool
      scope.pool = undefined
      if (pool) {
        // end() 失败不影响响应，只需保证连接不越过请求作用域存活；
        // 加超时兜底，避免端点无响应时把整个请求挂死。
        await Promise.race([
          pool.end().catch(() => {}),
          new Promise((res) => setTimeout(res, 1500)),
        ])
      }
    }
  })
}

function getPool(): Pool {
  const scope = requestDb.getStore()
  // 作用域外建池 = 该 WebSocket 永远不会被 end() 回收，
  // 正是请求作用域改造要消灭的对象；宁可显式失败也不静默泄漏。
  if (!scope) {
    throw new Error('[db] 查询必须在请求作用域（withRequestDb）内执行，作用域外拒绝创建连接池')
  }
  if (!scope.pool) scope.pool = makePool()
  return scope.pool
}

function makePool(): Pool {
  const env = resolveEnv()
  if (!env.DATABASE_URL) {
    throw new Error('Database not configured: set DATABASE_URL (local .env or Cloudflare secret)')
  }
  const pool = new Pool({ connectionString: env.DATABASE_URL })
  // 服务端（Supavisor）主动关闭空闲连接时 Pool 会 emit 'error'；不挂监听器会让该事件
  // 升级为未捕获异常并打崩 isolate（表现为 Cloudflare 1101）。
  pool.on('error', (err: Error) => {
    console.error('[db] connection error:', err?.message ?? err)
  })
  return pool
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

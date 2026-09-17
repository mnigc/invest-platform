import type { MiddlewareHandler } from 'astro'
import { setRuntimeEnv, getRuntimeDatabaseUrl } from './lib/db'
import { env } from 'cloudflare:workers'

/**
 * 运行时 env 注入点：把 Cloudflare 的 secret/vars 交给 db 模块，
 * 使 db.ts 能在 Workers 运行时读到 DATABASE_URL，而不是构建期就被静态替换掉的值。
 *
 * @astrojs/cloudflare v13 起移除了 Astro.locals.runtime，统一走 cloudflare:workers 的 env。
 * 生产环境：`npx wrangler secret put DATABASE_URL`
 * 本地开发：项目根目录的 .dev.vars（astro dev 现在跑在 workerd 里，读得到）
 */
export const onRequest: MiddlewareHandler = (_context, next) => {
  const runtimeEnv = env as Record<string, string | undefined>
  // 仅当连接串确实变化时才重建 Pool。
  // 若无条件 setRuntimeEnv → _pool = null，同一 isolate 内每个请求都会新建
  // Neon Pool（重新 WebSocket 握手），首页 10 路并发在冷启动时必然超时。
  if (runtimeEnv?.DATABASE_URL && runtimeEnv.DATABASE_URL !== getRuntimeDatabaseUrl()) {
    setRuntimeEnv(runtimeEnv)
  }
  return next()
}

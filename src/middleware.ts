import type { MiddlewareHandler } from 'astro'
import { setRuntimeEnv, withRequestDb } from './lib/db'
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
  // 把整个请求放进「请求作用域」：数据库连接在本请求内创建并关闭，
  // 不越出请求作用域存活（workerd 禁止跨请求复用 WebSocket，见 db.ts 说明）。
  // env 注入放进作用域内，并发请求各读各的，不会互相覆盖。
  return withRequestDb(() => {
    setRuntimeEnv(runtimeEnv)
    return next()
  })
}

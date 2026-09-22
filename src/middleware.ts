import type { MiddlewareHandler } from 'astro'
import { setRuntimeEnv, withRequestDb } from './lib/db'
import { isEdgeCacheable, matchEdgeCache, storeEdgeCache } from './lib/edgeCache'
import { env } from 'cloudflare:workers'

/**
 * 运行时 env 注入点：把 Cloudflare 的 secret/vars 交给 db 模块，
 * 使 db.ts 能在 Workers 运行时读到 DATABASE_URL，而不是构建期就被静态替换掉的值。
 *
 * @astrojs/cloudflare v13 起移除了 Astro.locals.runtime，统一走 cloudflare:workers 的 env。
 * 生产环境：`npx wrangler secret put DATABASE_URL`
 * 本地开发：项目根目录的 .dev.vars（astro dev 现在跑在 workerd 里，读得到）
 */
export const onRequest: MiddlewareHandler = async (context, next) => {
  const url = new URL(context.request.url)

  // 边缘缓存命中：直接在 colo 返回，不进入请求作用域、不建数据库连接。
  // 必须放在 withRequestDb 之外——命中路径的收益就是把 1.2s 的 WS 握手也省掉。
  if (isEdgeCacheable(url)) {
    const cached = await matchEdgeCache(context.request)
    if (cached) return cached
  }

  const runtimeEnv = env as Record<string, string | undefined>
  // 把整个请求放进「请求作用域」：数据库连接在本请求内创建并关闭，
  // 不越出请求作用域存活（workerd 禁止跨请求复用 WebSocket，见 db.ts 说明）。
  // env 注入放进作用域内，并发请求各读各的，不会互相覆盖。
  const res = await withRequestDb(() => {
    setRuntimeEnv(runtimeEnv)
    return next()
  })

  // 写缓存要在响应返回前 await：Astro 中间件拿不到 waitUntil，
  // 不等的话 isolate 可能在 put 完成前被回收。代价只由「每个缓存窗口的第一个
  // 访客」承担一次（本地 put 约几十 ms），后续命中全部免费。
  if (isEdgeCacheable(url)) {
    await storeEdgeCache(context.request, res)
  }
  return res
}

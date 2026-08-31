import type { MiddlewareHandler } from 'astro'
import { setRuntimeEnv } from './lib/db'

// Cloudflare Workers 把 secret/vars 通过 Astro.locals.runtime.env 暴露给每个请求。
// 在请求开始时把它注入到 db 模块，使 db.ts 能在 Workers 运行时读到 DATABASE_URL
// （而非构建期被静态替换的 import.meta.env.DATABASE_URL）。
// 本地 astro dev 没有 locals.runtime（或其 env 为空），db.ts 会回退到 .env。
export const onRequest: MiddlewareHandler = (context, next) => {
  const env = (context.locals as any)?.runtime?.env as
    | Record<string, string | undefined>
    | undefined
  if (env && env.DATABASE_URL) {
    setRuntimeEnv(env)
  }
  return next()
}

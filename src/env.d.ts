/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

/**
 * `cloudflare:workers` 的类型声明。
 *
 * @astrojs/cloudflare v13 起移除了 Astro.locals.runtime，运行时 env 统一从这个模块取。
 * 官方做法是 `wrangler types` 生成 worker-configuration.d.ts，但那份文件会把全局
 * runtime 类型整体替换成 Workers 版本，连带把 Response.json() 的返回类型从 any
 * 变成 unknown，导致所有 fetch 回调都要改类型。本项目只用 DATABASE_URL 这一个
 * 绑定，因此只补最小的模块声明，保持 DOM 类型不变。
 *
 * 若以后要用 KV / R2 / D1 等绑定，再跑 `npx wrangler types` 并把生成的 Env 接口接进来。
 */
declare module 'cloudflare:workers' {
  export const env: Record<string, string | undefined>
}

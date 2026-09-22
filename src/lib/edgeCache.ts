/**
 * 边缘缓存：用 Cloudflare Cache API（caches.default）缓存 SSR 页面与 DB 接口。
 *
 * 背景：请求作用域 DB 改造（见 db.ts）后，每个 SSR 请求都要新建一条到 Supabase 的
 * WebSocket 连接（握手约 1.2s），叠加每条查询的跨区 RTT，动态页实测 2~6s。而本项目
 * 的数据由 Python 同步侧每晚刷新一次，分钟级缓存的 staleness 代价几乎为零。
 *
 * - 命中：直接在 colo 返回，不进入请求作用域、不建数据库连接（见 middleware.ts）。
 * - 未命中：照常渲染；200 响应写入边缘缓存（edge TTL 30 分钟），返回给浏览器的
 *   副本压到 5 分钟 + stale-while-revalidate，国际链路抖动时重复访问可完全不过网络。
 * - 只缓存 GET 的 200 且无 Set-Cookie 的响应；写入失败静默忽略，不影响主响应。
 * - 仅生产启用（import.meta.env.PROD）：本地 dev/preview 改代码即生效，
 *   不受旧缓存干扰。
 */

const EDGE_TTL_SECONDS = 1800
const BROWSER_TTL_SECONDS = 300
const BROWSER_SWR_SECONDS = 600

/** /weekly 是唯一的 DB 查询 SSR 页；/api/v1/* 全部查库。首页只是 302，无需缓存。 */
export function isEdgeCacheable(url: URL): boolean {
  return (
    url.pathname === '/weekly' ||
    url.pathname === '/weekly/' ||
    url.pathname.startsWith('/api/v1/')
  )
}

interface WorkersCache {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

// workerd 的全局 caches.default（Cloudflare 专属 API，DOM lib 类型里没有 default）。
// 拿不到时退化为不缓存，缓存属于加速路径，绝不能因它挂掉主请求。
function edgeCache(): WorkersCache | null {
  try {
    const c = (globalThis as unknown as { caches?: { default?: WorkersCache } }).caches
    return c?.default ?? null
  } catch {
    return null
  }
}

/** 本地 dev 不启用：改代码即时生效，不受旧缓存干扰；生产（含 preview 构建产物）启用 */
const EDGE_CACHE_ENABLED = import.meta.env.PROD

export async function matchEdgeCache(request: Request): Promise<Response | null> {
  if (!EDGE_CACHE_ENABLED) return null
  if (request.method !== 'GET') return null
  const cache = edgeCache()
  if (!cache) return null
  let hit: Response | undefined
  try {
    hit = await cache.match(request)
  } catch {
    return null
  }
  if (!hit) return null
  // cache.match() 返回的 Response 不可改写 headers，重建一份再打上命中标记
  const headers = new Headers(hit.headers)
  headers.set('X-Edge-Cache', 'HIT')
  headers.set(
    'Cache-Control',
    `public, max-age=${BROWSER_TTL_SECONDS}, stale-while-revalidate=${BROWSER_SWR_SECONDS}`,
  )
  return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers })
}

export async function storeEdgeCache(request: Request, res: Response): Promise<void> {
  if (!EDGE_CACHE_ENABLED) return
  if (request.method !== 'GET') return
  if (res.status !== 200 || res.headers.has('set-cookie')) return
  // 降级页面（如 weekly 查库失败渲染的空状态，见 weekly.astro）返回的也是 200，
  // 不能把它们钉在边缘 30 分钟
  if (res.headers.has('x-db-failed')) return
  const cache = edgeCache()
  if (!cache) return
  try {
    // 边缘副本与浏览器副本 TTL 分离：边缘存 30 分钟，回给浏览器的那份压到 5 分钟。
    // CDN-Cache-Control 删掉：withCache 给 API 设过它，留着会跟这里定下的边缘 TTL 打架
    const headers = new Headers(res.headers)
    headers.set('Cache-Control', `public, max-age=${EDGE_TTL_SECONDS}`)
    headers.delete('CDN-Cache-Control')
    const stored = new Response(res.clone().body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    })
    await cache.put(request, stored)
    res.headers.set(
      'Cache-Control',
      `public, max-age=${BROWSER_TTL_SECONDS}, stale-while-revalidate=${BROWSER_SWR_SECONDS}`,
    )
    res.headers.set('X-Edge-Cache', 'MISS')
  } catch {
    // 写缓存失败不影响主响应
  }
}

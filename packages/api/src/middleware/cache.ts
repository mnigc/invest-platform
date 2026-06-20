import { createClient } from 'redis'
import type { Context, Next } from 'hono'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

let client: ReturnType<typeof createClient> | null = null
let clientReady = false

async function getClient() {
  if (!client) {
    client = createClient({ url: REDIS_URL })
    client.on('error', () => { clientReady = false })
    try {
      await client.connect()
      clientReady = true
    } catch {
      clientReady = false
    }
  }
  return clientReady ? client : null
}

export async function cacheGet(key: string): Promise<string | null> {
  try {
    const c = await getClient()
    if (!c) return null
    return await c.get(key)
  } catch {
    return null
  }
}

export async function cacheSet(key: string, value: string, ttl: number): Promise<void> {
  try {
    const c = await getClient()
    if (!c) return
    await c.setEx(key, ttl, value)
  } catch {
    // silently degrade
  }
}

export function cacheMiddleware(ttlSeconds: number) {
  return async (c: Context, next: Next) => {
    const key = `api:${c.req.path}?${c.req.queries().toString()}`
    const cached = await cacheGet(key)
    if (cached) {
      c.header('X-Cache', 'HIT')
      return c.json(JSON.parse(cached))
    }
    await next()
    if (c.res.status === 200) {
      const body = await c.res.clone().text()
      await cacheSet(key, body, ttlSeconds)
    }
  }
}

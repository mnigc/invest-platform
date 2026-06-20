import type { Context, Next } from 'hono'

export async function errorHandler(c: Context, next: Next) {
  try {
    await next()
  } catch (err: any) {
    console.error(`[API Error] ${c.req.path}:`, err.message)
    c.status(500)
    return c.json({ success: false, error: err.message || 'Internal server error' })
  }
}

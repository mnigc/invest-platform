import { Hono } from 'hono'
import { cacheMiddleware } from '../../middleware/cache.js'
import { detectRegime } from './regime-engine.js'
import type { RegimeResponse } from '@invest/core'

const router = new Hono()

router.get('/', cacheMiddleware(600), async (c) => {
  try {
    const result = await detectRegime()
    return c.json({
      success: true,
      data: { ...result, updatedAt: new Date().toISOString().slice(0, 10) } satisfies RegimeResponse,
    })
  } catch (err: any) {
    console.error('[Regime]', err.message)
    c.status(500)
    return c.json({ success: false, error: err.message })
  }
})

export default router

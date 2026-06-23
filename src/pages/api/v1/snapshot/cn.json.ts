export const prerender = false

import type { APIRoute } from 'astro'
import { withCache } from '../../../../lib/cache'
import { getCnSnapshot } from '../../../../lib/snapshot'

export const GET = withCache(async () => {
  try {
    const data = await getCnSnapshot()
    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}, 300)

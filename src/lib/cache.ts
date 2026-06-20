const store = new Map<string, { value: string; expiresAt: number }>()

export function withCache(handler: (context: any) => Promise<Response>, ttlSeconds: number) {
  return async (context: any) => {
    const url = new URL(context.request.url)
    const key = `${url.pathname}?${url.searchParams.toString()}`
    const now = Date.now()
    const cached = store.get(key)
    if (cached && cached.expiresAt > now) {
      return new Response(cached.value, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      })
    }
    const response = await handler(context)
    if (response.status === 200) {
      const body = await response.clone().text()
      store.set(key, { value: body, expiresAt: now + ttlSeconds * 1000 })
    }
    return response
  }
}

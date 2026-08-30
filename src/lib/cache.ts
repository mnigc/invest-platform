interface CacheEntry {
  value: string;
  expiresAt: number;
}

interface CacheEnv {
  API_CACHE?: KVNamespace;
}

const localStore = new Map<string, CacheEntry>();

function getCacheKey(url: URL): string {
  return `${url.pathname}?${url.searchParams.toString()}`;
}

export function withCache(
  handler: (context: any) => Promise<Response>,
  ttlSeconds: number = 300
) {
  return async (context: any) => {
    const env = (context?.platform?.env || {}) as CacheEnv;
    const kv = env?.API_CACHE;
    const request = context.request;
    const url = new URL(request.url);
    const key = getCacheKey(url);
    const now = Date.now();

    // Try KV cache (Cloudflare production)
    if (kv) {
      try {
        const cached = await kv.get<CacheEntry>(key, { type: 'json' });
        if (cached && cached.expiresAt > now) {
          return new Response(cached.value, {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
          });
        }
      } catch {
        // KV read failed, proceed to handler
      }
    } else {
      // Fallback: in-memory cache for local development
      const cached = localStore.get(key);
      if (cached && cached.expiresAt > now) {
        return new Response(cached.value, {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
        });
      }
    }

    const response = await handler(context);

    if (response.status === 200) {
      const body = await response.clone().text();
      const entry: CacheEntry = {
        value: body,
        expiresAt: now + ttlSeconds * 1000,
      };

      if (kv) {
        try {
          await kv.put(key, JSON.stringify(entry), {
            expirationTtl: Math.min(ttlSeconds, 5184000),
          });
        } catch {
          // KV write failed, ignore
        }
      } else {
        localStore.set(key, entry);
      }
    }

    return response;
  };
}

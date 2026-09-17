export function withCache(
  handler: (context: any) => Promise<Response>,
  ttlSeconds: number = 300
) {
  return async (context: any) => {
    let response: Response;
    try {
      response = await handler(context);
    } catch (err: any) {
      // 兜底：业务层 try/catch 接不住的逃逸异常也返回 JSON，而不是让 Astro /
      // Cloudflare 回 HTML 错误页——前端 r.json() 解析 HTML 会报
      // "Unexpected token '<'"，且该响应会被当作接口失败而非可重试错误。
      console.error('[withCache]', err?.message ?? err);
      response = new Response(
        JSON.stringify({ success: false, error: 'Internal error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const headers = new Headers(response.headers);
    if (response.status === 200) {
      if (import.meta.env?.PROD) {
        // stale-while-revalidate：TTL 过期后先回旧内容、后台刷新，
        // 避免到期瞬间所有请求同时冷查询打库
        headers.set(
          'Cache-Control',
          `public, max-age=${ttlSeconds}, stale-while-revalidate=${ttlSeconds}`
        );
      } else {
        headers.set('Cache-Control', 'no-cache');
      }
      headers.set('CDN-Cache-Control', `max-age=${ttlSeconds}`);
    } else {
      // 错误/降级响应禁止缓存，避免 5xx 被 CDN 或浏览器钉住
      headers.set('Cache-Control', 'no-store');
      headers.set('CDN-Cache-Control', 'no-store');
    }
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  };
}

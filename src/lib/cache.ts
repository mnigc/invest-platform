export function withCache(
  handler: (context: any) => Promise<Response>,
  ttlSeconds: number = 300
) {
  return async (context: any) => {
    const response = await handler(context);
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

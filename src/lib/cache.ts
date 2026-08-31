export function withCache(
  handler: (context: any) => Promise<Response>,
  ttlSeconds: number = 300
) {
  return async (context: any) => {
    const response = await handler(context);
    if (response.status === 200) {
      const headers = new Headers(response.headers);
      if (import.meta.env?.PROD) {
        headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
      } else {
        headers.set('Cache-Control', 'no-cache');
      }
      headers.set('CDN-Cache-Control', `max-age=${ttlSeconds}`);
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }
    return response;
  };
}

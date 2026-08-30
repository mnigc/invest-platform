export function withCache(
  handler: (context: any) => Promise<Response>,
  ttlSeconds: number = 300
) {
  return async (context: any) => {
    const response = await handler(context);
    if (response.status === 200) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
      headers.set('CDN-Cache-Control', `max-age=${ttlSeconds}`);
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }
    return response;
  };
}

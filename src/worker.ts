interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle API routes
    if (url.pathname.startsWith('/api/')) {
      const response = await env.ASSETS.fetch(request);
      if (response.status !== 404) return response;
    }

    // Serve static assets
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;

    // SPA fallback for client-side routing
    const indexResponse = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
    if (indexResponse.status !== 404) return indexResponse;

    return new Response('Not Found', { status: 404 });
  },
};
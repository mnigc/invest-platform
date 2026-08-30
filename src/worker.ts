interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;

    return new Response('Not Found', { status: 404 });
  },
};

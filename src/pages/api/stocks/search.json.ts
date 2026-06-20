export const prerender = false;

import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';

export const GET: APIRoute = async ({ params, request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  
  if (!q) {
    return new Response(JSON.stringify({ success: false, error: 'Missing search query' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 搜索股票代码或名称
    const searchTerm = `%${q}%`;
    const stocks = await query(
      `SELECT id, symbol, name_zh, exchange, type, is_active 
       FROM cn_symbols 
       WHERE is_active = TRUE 
       AND (symbol LIKE ? OR name_zh LIKE ?)
       ORDER BY 
         CASE WHEN symbol = ? THEN 1 
              WHEN symbol LIKE ? THEN 2 
              ELSE 3 END,
         symbol
       LIMIT 20`,
      [searchTerm, searchTerm, q, `${q}%`]
    );

    return new Response(
      JSON.stringify({ success: true, stocks }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
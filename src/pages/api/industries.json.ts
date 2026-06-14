import type { APIRoute } from 'astro';
import { query } from '../../lib/db';

export const GET: APIRoute = async () => {
  try {
    const industries = await query(`
      SELECT id, code, name_zh, name_en, description, node_count, company_count, link_count
      FROM industries
      WHERE is_active = TRUE
      ORDER BY id
    `);

    return new Response(JSON.stringify({ success: true, data: industries }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

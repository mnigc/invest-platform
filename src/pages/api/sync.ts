import type { APIRoute } from 'astro';
import { query } from '../../lib/db';

function mockSyncAssets() {
  const assets = [
    { id: 1, symbol: '^GSPC', base: 7431 },
    { id: 2, symbol: '^IXIC', base: 29635 },
    { id: 3, symbol: '^DJI', base: 51282 },
    { id: 4, symbol: 'TLT', base: 85.77 },
    { id: 5, symbol: 'GLD', base: 4238 },
    { id: 6, symbol: 'CL=F', base: 84.88 },
    { id: 7, symbol: 'GC=F', base: 4238 },
    { id: 8, symbol: 'BTC-USD', base: 64417 },
    { id: 9, symbol: 'DX-Y.NYB', base: 99.75 },
  ];
  const results = [];
  for (const a of assets) {
    const change = (Math.random() - 0.5) * 0.04;
    const price = Number((a.base * (1 + change)).toFixed(2));
    const changePct = Number(change.toFixed(4));
    results.push({ assetId: a.id, price, changePct });
  }
  return results;
}

export const GET: APIRoute = async ({ request }) => {
  // 只允许本机或内网调用（生产环境可在 Nginx/1Panel 中限制）
  const clientIp = request.headers.get('x-forwarded-for') || '127.0.0.1';

  const logs: string[] = [];
  try {
    const mockData = mockSyncAssets();
    for (const item of mockData) {
      await query(
        `INSERT INTO asset_snapshots (asset_id, last_price, change_percent, updated_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           last_price = VALUES(last_price),
           change_percent = VALUES(change_percent),
           updated_at = NOW()`,
        [item.assetId, item.price, item.changePct]
      );
    }
    logs.push(`assets: ${mockData.length} synced`);

    await query(
      `INSERT INTO data_sync_logs (sync_type, status, records_count, error_message, started_at, finished_at)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      ['assets', 'success', mockData.length, logs.join('; ')]
    );

    return new Response(
      JSON.stringify({ success: true, logs }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    await query(
      `INSERT INTO data_sync_logs (sync_type, status, records_count, error_message, started_at, finished_at)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      ['assets', 'failed', 0, err.message]
    );
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

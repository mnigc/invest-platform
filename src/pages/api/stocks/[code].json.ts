export const prerender = false;

import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';

const PERIOD_MAP: Record<string, number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '5Y': 1825,
  '10Y': 3650,
};

export const GET: APIRoute = async ({ params, request }) => {
  const { code } = params;
  if (!code) {
    return new Response(JSON.stringify({ success: false, error: 'Missing code' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 获取股票基本信息
    const stock = await query(
      `SELECT s.id, s.symbol, s.name_zh, s.type, s.exchange, 
              a.last_price, a.change_percent, a.pe_ratio, a.pb_ratio,
              p.trade_date as latest_date
       FROM cn_symbols s
       LEFT JOIN asset_snapshots a ON s.id = a.asset_id
       LEFT JOIN cn_daily_prices p ON s.id = p.symbol_id
       WHERE s.symbol = ? AND s.is_active = TRUE
       ORDER BY p.trade_date DESC
       LIMIT 1`,
      [code]
    );

    if (stock.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Stock not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const stockInfo = stock[0];
    
    // 获取最近5个季度的财务数据
    const financials = await query(
      `SELECT report_date, report_type, revenue, net_profit, roe, 
              debt_to_asset, oper_cash_flow, dividend_yield,
              pe_ttm, pb, ps, peg
       FROM cn_financials
       WHERE symbol_id = ?
       ORDER BY report_date DESC
       LIMIT 5`,
      [stockInfo.id]
    );

    // 获取日线数据用于技术指标计算
    const url = new URL(request.url);
    const period = url.searchParams.get('period') || '60D';
    const days = period === 'MAX' ? 3650 : parseInt(period) || 60;

    let pricesSql: string;
    let pricesParams: any[];

    if (period === 'MAX') {
      pricesSql = `SELECT trade_date, close FROM cn_daily_prices 
                   WHERE symbol_id = ? AND close IS NOT NULL 
                   ORDER BY trade_date ASC`;
      pricesParams = [stockInfo.id];
    } else {
      pricesSql = `SELECT trade_date, close FROM cn_daily_prices 
                   WHERE symbol_id = ? AND close IS NOT NULL 
                   AND trade_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                   ORDER BY trade_date ASC`;
      pricesParams = [stockInfo.id, days];
    }

    const prices = await query(pricesSql, pricesParams);

    // 获取最近30天的日线数据用于低吸策略计算
    const lowAbsorbPrices = await query(
      `SELECT trade_date, close FROM cn_daily_prices 
       WHERE symbol_id = ? AND close IS NOT NULL 
       AND trade_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       ORDER BY trade_date ASC`,
      [stockInfo.id]
    );

    return new Response(
      JSON.stringify({
        success: true,
        stock: stockInfo,
        financials,
        prices,
        lowAbsorbPrices,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
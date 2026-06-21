export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';

interface AssetDef {
  code: string
  label: string
  category: string
  source: 'asset_prices' | 'indicator' | 'index_daily'
  symbol?: string
  region?: string
}

interface ZScoreEntry {
  code: string
  label: string
  category: string
  currentValue: number | null
  zScores: Record<string, number | null>
  means: Record<string, number | null>
  stds: Record<string, number | null>
  dataPoints: number
  frequency: string
}

const LOOKBACKS = { '1Y': 252, '3Y': 756, '5Y': 1260, '10Y': 2520 };

const US_ASSETS: AssetDef[] = [
  { code: 'DGS10', label: '10Y收益率', category: 'bond', source: 'indicator', region: 'US' },
  { code: 'DGS2', label: '2Y收益率', category: 'bond', source: 'indicator', region: 'US' },
  { code: 'DGS5', label: '5Y收益率', category: 'bond', source: 'indicator', region: 'US' },
  { code: 'DGS30', label: '30Y收益率', category: 'bond', source: 'indicator', region: 'US' },
  { code: 'DGS1MO', label: '1M收益率', category: 'bond', source: 'indicator', region: 'US' },
  { code: 'FEDFUNDS', label: '联邦基金利率', category: 'rate', source: 'indicator', region: 'US' },
  { code: 'VIXCLS', label: 'VIX', category: 'volatility', source: 'indicator', region: 'US' },
  { code: 'DEXUSEU', label: '美元指数', category: 'fx', source: 'indicator', region: 'US' },
  { code: '^GSPC', label: 'SPX', category: 'equity', source: 'asset_prices', symbol: '^GSPC' },
  { code: '^IXIC', label: 'NASDAQ', category: 'equity', source: 'asset_prices', symbol: '^IXIC' },
  { code: 'TLT', label: 'TLT', category: 'equity', source: 'asset_prices', symbol: 'TLT' },
  { code: 'GLD', label: 'GLD', category: 'commodity', source: 'asset_prices', symbol: 'GLD' },
  { code: 'CL=F', label: '原油', category: 'commodity', source: 'asset_prices', symbol: 'CL=F' },
  { code: 'DX-Y.NYB', label: 'DXY', category: 'fx', source: 'asset_prices', symbol: 'DX-Y.NYB' },
];

const CN_ASSETS: AssetDef[] = [
  { code: 'CPI', label: 'CPI', category: 'macro', source: 'indicator', region: 'CN' },
  { code: 'PPI', label: 'PPI', category: 'macro', source: 'indicator', region: 'CN' },
  { code: 'PMI', label: 'PMI', category: 'macro', source: 'indicator', region: 'CN' },
  { code: 'RETAIL', label: '社消零售', category: 'macro', source: 'indicator', region: 'CN' },
  { code: 'CN_TREASURY_10Y', label: '10Y国债', category: 'bond', source: 'indicator', region: 'CN' },
  { code: '000300', label: '沪深300', category: 'equity', source: 'index_daily' },
  { code: '000016', label: '上证50', category: 'equity', source: 'index_daily' },
  { code: '000852', label: '中证1000', category: 'equity', source: 'index_daily' },
];

function computeZScores(values: number[]): { zScores: Record<string, number | null>; means: Record<string, number | null>; stds: Record<string, number | null> } {
  const zScores: Record<string, number | null> = {};
  const means: Record<string, number | null> = {};
  const stds: Record<string, number | null> = {};
  for (const [key, lookback] of Object.entries(LOOKBACKS)) {
    const window = values.slice(-lookback);
    if (window.length < 3) {
      zScores[key] = null; means[key] = null; stds[key] = null;
      continue;
    }
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
    const std = Math.sqrt(variance);
    means[key] = +mean.toFixed(4);
    stds[key] = +std.toFixed(4);
    if (std === 0) { zScores[key] = 0; continue; }
    const current = window[window.length - 1];
    zScores[key] = +((current - mean) / std).toFixed(2);
  }
  return { zScores, means, stds };
}

async function loadFromIndicator(code: string, region: string): Promise<ZScoreEntry | null> {
  const rows = await query<any>(
    `SELECT d.period_date, d.value
     FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id
     WHERE i.code = ? AND i.region = ? AND d.value IS NOT NULL
     ORDER BY d.period_date`,
    [code, region]
  );
  if (rows.length < 3) return null;
  const values = rows.map((r: any) => Number(r.value));
  const currentValue = values[values.length - 1];
  const { zScores, means, stds } = computeZScores(values);
  const def = [...US_ASSETS, ...CN_ASSETS].find(a => a.code === code);
  return {
    code, label: def?.label ?? code, category: def?.category ?? 'other',
    currentValue, zScores, means, stds, dataPoints: values.length,
    frequency: region === 'CN' ? 'monthly' : 'daily',
  };
}

async function loadFromAssetPrices(symbol: string): Promise<ZScoreEntry | null> {
  const rows = await query<any>(
    `SELECT p.trade_date, p.close_price
     FROM asset_prices p JOIN assets a ON a.id = p.asset_id
     WHERE a.symbol = ? AND p.close_price IS NOT NULL
     ORDER BY p.trade_date`,
    [symbol]
  );
  if (rows.length < 10) return null;
  const values = rows.map((r: any) => Number(r.close_price));
  const currentValue = values[values.length - 1];
  const { zScores, means, stds } = computeZScores(values);
  const def = [...US_ASSETS, ...CN_ASSETS].find(a => a.symbol === symbol);
  return {
    code: symbol, label: def?.label ?? symbol, category: def?.category ?? 'other',
    currentValue, zScores, means, stds, dataPoints: values.length, frequency: 'daily',
  };
}

async function loadFromIndexDaily(code: string): Promise<ZScoreEntry | null> {
  const rows = await query<any>(
    `SELECT trade_date, close_price
     FROM index_daily
     WHERE index_code = ? AND close_price IS NOT NULL
     ORDER BY trade_date`,
    [code]
  );
  if (rows.length < 10) return null;
  const values = rows.map((r: any) => Number(r.close_price));
  const currentValue = values[values.length - 1];
  const { zScores, means, stds } = computeZScores(values);
  const def = [...US_ASSETS, ...CN_ASSETS].find(a => a.code === code);
  return {
    code, label: def?.label ?? code, category: def?.category ?? 'other',
    currentValue, zScores, means, stds, dataPoints: values.length, frequency: 'daily',
  };
}

async function loadPanel(assets: AssetDef[]): Promise<ZScoreEntry[]> {
  const results: ZScoreEntry[] = [];
  for (const def of assets) {
    try {
      let entry: ZScoreEntry | null = null;
      if (def.source === 'indicator') {
        entry = await loadFromIndicator(def.code, def.region || 'US');
      } else if (def.source === 'asset_prices') {
        entry = await loadFromAssetPrices(def.symbol || def.code);
      } else if (def.source === 'index_daily') {
        entry = await loadFromIndexDaily(def.code);
      }
      if (entry) results.push(entry);
    } catch {
      // skip failed assets silently
    }
  }
  return results;
}

export const GET = withCache(async () => {
  try {
    const [us, cn] = await Promise.all([
      loadPanel(US_ASSETS),
      loadPanel(CN_ASSETS),
    ]);
    return new Response(JSON.stringify({
      success: true,
      data: { us, cn },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e.message || '查询失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}, 300);

export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';

// DXY 成分货币权重（ICE 美元指数构成）
// weight: 该货币在 DXY 中的权重百分比
// isInverse: 货币对报价方向 - EUR/USD 等美元在分母的货币对与 DXY 负相关
const DXY_COMPONENTS: Record<string, { weight: number; name: string; isInverse: boolean }> = {
  'EURUSD=X': { weight: 57.6, name: '欧元', isInverse: true },
  'USDJPY=X': { weight: 13.6, name: '日元', isInverse: false },
  'GBPUSD=X': { weight: 11.9, name: '英镑', isInverse: true },
  'USDCAD=X': { weight: 9.1, name: '加元', isInverse: false },
  'USDCHF=X': { weight: 3.6, name: '瑞郎', isInverse: false },
};

function computeStats(values: number[]) {
  const windows: Record<string, number> = { '20Y': 5040, '10Y': 2520, '5Y': 1260, '3Y': 756, '1Y': 252 };
  const stats: Record<string, any> = {};
  for (const [key, lookback] of Object.entries(windows)) {
    const window = values.slice(-lookback);
    if (window.length < 20) continue;
    const sorted = [...window].sort((a, b) => a - b);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
    const std = Math.sqrt(variance);
    const current = window[window.length - 1];
    const zScore = std > 0 ? (current - mean) / std : 0;
    const rank = sorted.indexOf(current) >= 0 ? sorted.indexOf(current) : sorted.length - 1;
    const percentile = (rank / (sorted.length - 1)) * 100;
    stats[key] = {
      zScore: +zScore.toFixed(2),
      percentile: +percentile.toFixed(1),
      mean: +mean.toFixed(2),
      std: +std.toFixed(2),
      min: +sorted[0].toFixed(2),
      max: +sorted[sorted.length - 1].toFixed(2),
      dataPoints: window.length,
    };
  }
  return stats;
}

function corr(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 10) return 0;
  const va = a.slice(-n), vb = b.slice(-n);
  const ma = va.reduce((s, v) => s + v, 0) / n;
  const mb = vb.reduce((s, v) => s + v, 0) / n;
  let cov = 0, va2 = 0, vb2 = 0;
  for (let i = 0; i < n; i++) {
    const da = va[i] - ma, db = vb[i] - mb;
    cov += da * db; va2 += da * da; vb2 += db * db;
  }
  if (va2 === 0 || vb2 === 0) return 0;
  return +((cov / n) / Math.sqrt((va2 / n) * (vb2 / n))).toFixed(3);
}

// 按日期对齐两个序列，用于相关性计算
function alignByDate(a: { date: string; value: number }[], b: { date: string; value: number }[]): number[][] {
  const bMap = new Map(b.map((r: any) => [String(r.date).slice(0, 10), Number(r.value)]));
  const aDates = a.map((r: any) => String(r.date).slice(0, 10));
  const values: number[][] = [];
  for (const d of aDates) {
    const bv = bMap.get(d);
    if (bv != null && !isNaN(bv)) {
      const av = a.find((r: any) => String(r.date).slice(0, 10) === d);
      if (av != null && !isNaN(av.value)) values.push([av.value, bv]);
    }
  }
  return values;
}

async function loadAssetPrices(symbol: string): Promise<{ date: string; value: number }[]> {
  const rows = await query<any>(
    `SELECT p.trade_date, p.close_price
     FROM asset_prices p JOIN assets a ON a.id = p.asset_id
     WHERE a.symbol = ? AND p.close_price IS NOT NULL
     ORDER BY p.trade_date`,
    [symbol]
  );
  return rows.map((r: any) => ({
    date: String(r.trade_date).slice(0, 10),
    value: Number(r.close_price),
  }));
}

async function loadAssetSnapshot(symbol: string): Promise<{ price: number; change: number } | null> {
  const rows = await query<any>(
    `SELECT s.last_price, s.change_percent
     FROM asset_snapshots s JOIN assets a ON a.id = s.asset_id
     WHERE a.symbol = ?`,
    [symbol]
  );
  if (!rows.length) return null;
  return {
    price: Number(rows[0].last_price),
    change: Number(rows[0].change_percent || 0),
  };
}

export const GET = withCache(async () => {
  try {
    // 并行加载所有数据
    const forexSymbols = [
      'DX-Y.NYB',
      'EURUSD=X', 'USDJPY=X', 'GBPUSD=X', 'USDCNH=X',
      'USDCHF=X', 'AUDUSD=X', 'USDCAD=X', 'KRW=X',
    ];

    const [priceDataArr, snapshotArr] = await Promise.all([
      Promise.all(forexSymbols.map(s => loadAssetPrices(s))),
      Promise.all(forexSymbols.map(s => loadAssetSnapshot(s))),
    ]);

    // 加载黄金（从 gold_price_history 表）和 SPX（从 asset_prices 表）用于相关性计算
    const [goldRows, spxRows] = await Promise.all([
      query<any>(
        `SELECT price_date, close_price
         FROM gold_price_history
         WHERE source IN ('yfinance', 'gold-api', 'LOCAL-XLSX', 'FRED')
           AND currency = 'USD' AND unit = 'OZ' AND close_price IS NOT NULL
         ORDER BY price_date`
      ),
      query<any>(
        `SELECT p.trade_date, p.close_price
         FROM asset_prices p JOIN assets a ON a.id = p.asset_id
         WHERE a.symbol = '^GSPC' AND p.close_price IS NOT NULL
         ORDER BY p.trade_date`
      ),
    ]);

    const goldData = goldRows.map((r: any) => ({
      date: String(r.price_date).slice(0, 10),
      value: Number(r.close_price),
    }));

    const spxData = spxRows.map((r: any) => ({
      date: String(r.trade_date).slice(0, 10),
      value: Number(r.close_price),
    }));

    const priceMap = new Map<string, { date: string; value: number }[]>();
    const snapshotMap = new Map<string, { price: number; change: number } | null>();
    forexSymbols.forEach((s, i) => {
      priceMap.set(s, priceDataArr[i]);
      snapshotMap.set(s, snapshotArr[i]);
    });

    const dxyData = priceMap.get('DX-Y.NYB') || [];
    const dxySnapshot = snapshotMap.get('DX-Y.NYB');
    const dxyValues = dxyData.map(p => p.value);

    if (dxyValues.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No DXY data' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    // DXY 当前值
    const dxyCurrent = dxyValues[dxyValues.length - 1];
    const dxyPrev = dxyValues.length > 1 ? dxyValues[dxyValues.length - 2] : dxyCurrent;
    const dxyChange = dxyCurrent - dxyPrev;
    const dxyChangePercent = dxyPrev > 0 ? (dxyChange / dxyPrev) * 100 : 0;

    // DXY 统计
    const dxyStats = computeStats(dxyValues);
    const heroStat = dxyStats['5Y'] || dxyStats['10Y'] || dxyStats['3Y'] || null;

    // DXY 7日动量
    const dxy7dAgo = dxyValues.length > 7 ? dxyValues[dxyValues.length - 8] : null;
    const dxyMomentum7d = dxy7dAgo != null ? dxyCurrent - dxy7dAgo : null;
    let dxyMomentumLabel = '--';
    if (dxyMomentum7d != null) {
      if (dxyMomentum7d < -2) dxyMomentumLabel = '快速走弱';
      else if (dxyMomentum7d < -0.5) dxyMomentumLabel = '温和走弱';
      else if (dxyMomentum7d < 0.5) dxyMomentumLabel = '横盘整理';
      else if (dxyMomentum7d < 2) dxyMomentumLabel = '温和走强';
      else dxyMomentumLabel = '快速走强';
    }

    // 30日动量
    const dxy30dAgo = dxyValues.length > 30 ? dxyValues[dxyValues.length - 31] : null;
    const dxyMomentum30d = dxy30dAgo != null ? dxyCurrent - dxy30dAgo : null;

    // 货币对数据
    const pairSymbols = ['EURUSD=X', 'USDJPY=X', 'GBPUSD=X', 'USDCNH=X', 'USDCHF=X', 'AUDUSD=X', 'USDCAD=X', 'KRW=X'];
    const pairs = pairSymbols.map(symbol => {
      const data = priceMap.get(symbol) || [];
      const snapshot = snapshotMap.get(symbol);
      const values = data.map(p => p.value);
      const current = values.length > 0 ? values[values.length - 1] : null;
      const prev = values.length > 1 ? values[values.length - 2] : null;
      const change = current != null && prev != null ? current - prev : null;
      const changePercent = prev != null && prev > 0 && change != null ? (change / prev) * 100 : null;

      return {
        symbol,
        current,
        change: change != null ? +change.toFixed(4) : null,
        changePercent: changePercent != null ? +changePercent.toFixed(2) : null,
        date: data.length > 0 ? data[data.length - 1].date : '',
        history: data.slice(-90), // 最近90天用于 sparkline
      };
    });

    // DXY 成分贡献
    const dxyComponents = Object.entries(DXY_COMPONENTS).map(([symbol, config]) => {
      const pair = pairs.find(p => p.symbol === symbol);
      const rawChange = pair?.changePercent || 0;
      const contribution = config.isInverse ? -rawChange * (config.weight / 100) : rawChange * (config.weight / 100);
      return {
        symbol,
        name: config.name,
        weight: config.weight,
        current: pair?.current || null,
        changePercent: pair?.changePercent || null,
        contribution: +contribution.toFixed(2),
        isInverse: config.isInverse,
      };
    });

    // DXY 与黄金相关性（按日期对齐，取最近60个共同交易日）
    const alignedGold = alignByDate(dxyData, goldData);
    const recentGold = alignedGold.slice(-60);
    const dxyGoldCorr = recentGold.length >= 10 ? corr(recentGold.map(v => v[0]), recentGold.map(v => v[1])) : 0;

    // DXY 与 SPX 相关性（按日期对齐）
    const alignedSpx = alignByDate(dxyData, spxData);
    const recentSpx = alignedSpx.slice(-60);
    const dxySpxCorr = recentSpx.length >= 10 ? corr(recentSpx.map(v => v[0]), recentSpx.map(v => v[1])) : 0;

    const goldValues = goldData.map(p => p.value);
    const spxValues = spxData.map(p => p.value);

    // DXY 历史走势（最近3年用于图表，取每5日一个点以减少数据量）
    const chartLen = Math.min(756, dxyData.length);
    const dxyHistory = dxyData.slice(dxyData.length - chartLen);

    return new Response(JSON.stringify({
      success: true,
      data: {
        dxy: {
          current: +dxyCurrent.toFixed(2),
          change: +dxyChange.toFixed(2),
          changePercent: +dxyChangePercent.toFixed(2),
          date: dxyData[dxyData.length - 1].date,
          percentile: heroStat ? { pct: heroStat.percentile, window: '5Y' } : null,
          momentum7d: dxyMomentum7d != null ? +dxyMomentum7d.toFixed(2) : null,
          momentum30d: dxyMomentum30d != null ? +dxyMomentum30d.toFixed(2) : null,
          momentum7dLabel: dxyMomentumLabel,
          stats: dxyStats,
          history: dxyHistory,
        },
        pairs,
        dxyComponents,
        dxyGoldCorr,
        dxySpxCorr,
        goldPrice: goldValues.length > 0 ? goldValues[goldValues.length - 1] : null,
        spxPrice: spxValues.length > 0 ? spxValues[spxValues.length - 1] : null,
      },
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
}, 600);
export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';

const FEAR_ZONES = [
  { max: 15, label: '极度平静', key: 'calm', color: '#089981' },
  { max: 25, label: '正常波动', key: 'normal', color: '#06b6d4' },
  { max: 35, label: '偏高警戒', key: 'alert', color: '#f59e0b' },
  { max: Infinity, label: '恐慌市场', key: 'panic', color: '#f23645' },
];

function classifyFearZone(v: number): { label: string; key: string; color: string } {
  for (const z of FEAR_ZONES) {
    if (v <= z.max) return { label: z.label, key: z.key, color: z.color };
  }
  return { label: '恐慌市场', key: 'panic', color: '#f23645' };
}

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

export const GET = withCache(async () => {
  try {
    const [vixRows, spxRows] = await Promise.all([
      query<any>(
        `SELECT d.period_date, d.value
         FROM indicator_data d JOIN indicators i ON i.id = d.indicator_id
         WHERE i.code = 'VIXCLS' AND d.value IS NOT NULL
         ORDER BY d.period_date`,
      ),
      query<any>(
        `SELECT p.trade_date, p.close_price
         FROM asset_prices p JOIN assets a ON a.id = p.asset_id
         WHERE a.symbol = '^GSPC' AND p.close_price IS NOT NULL
         ORDER BY p.trade_date`,
      ),
    ]);

    const vixValues = vixRows.map((r: any) => Number(r.value));
    const spxValues = spxRows.map((r: any) => Number(r.close_price));

    if (vixValues.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No VIX data' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    const current = vixValues[vixValues.length - 1];
    const prev = vixValues.length > 1 ? vixValues[vixValues.length - 2] : current;
    const change = current - prev;
    const changePercent = prev > 0 ? (change / prev) * 100 : 0;
    const fearZone = classifyFearZone(current);
    const stats = computeStats(vixValues);
    const spxCurrent = spxValues.length > 0 ? spxValues[spxValues.length - 1] : null;

    // 7-day momentum
    const vix7dAgo = vixValues.length > 7 ? vixValues[vixValues.length - 8] : null;
    const momentum7d = vix7dAgo != null ? current - vix7dAgo : null;
    let momentumLabel = '--';
    if (momentum7d != null) {
      if (momentum7d < -3) momentumLabel = '快速回落';
      else if (momentum7d < -1) momentumLabel = '温和回落';
      else if (momentum7d < 1) momentumLabel = '平稳';
      else if (momentum7d < 3) momentumLabel = '温和攀升';
      else momentumLabel = '快速攀升';
    }

    // Term structure approximation: VIX 1mo mean (22d) vs 3mo mean (63d) ratio
    const vix22dMean = vixValues.length >= 22
      ? vixValues.slice(-22).reduce((a, b) => a + b, 0) / 22 : null;
    const vix63dMean = vixValues.length >= 63
      ? vixValues.slice(-63).reduce((a, b) => a + b, 0) / 63 : null;
    let termRatio: number | null = null;
    let termLabel = '--';
    if (vix22dMean != null && vix63dMean != null && vix63dMean > 0) {
      termRatio = +(vix22dMean / vix63dMean).toFixed(3);
      if (termRatio < 0.95) termLabel = 'Contango (近月<远月)';
      else if (termRatio > 1.05) termLabel = 'Backwardation (近月>远月)';
      else termLabel = '正常 Contango';
    }

    // SPX-VIX correlation
    const vix20d = vixValues.slice(-20);
    const spx20d = spxValues.slice(-20);
    const vix60d = vixValues.slice(-60);
    const spx60d = spxValues.slice(-60);

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

    // Recent VIX history for chart (last 3 years)
    const chartLen = Math.min(756, vixValues.length);
    const vixHistory = vixRows.slice(vixValues.length - chartLen).map((r: any) => ({
      date: String(r.period_date).slice(0, 10),
      value: Number(r.value),
    }));

    // Percentile hero: use 5Y as default
    const heroStat = stats['5Y'] || stats['10Y'] || stats['3Y'] || null;

    return new Response(JSON.stringify({
      success: true,
      data: {
        current: {
          value: current,
          change: +change.toFixed(2),
          changePercent: +changePercent.toFixed(2),
          date: String(vixRows[vixRows.length - 1].period_date).slice(0, 10),
        },
        fearZone,
        percentile: heroStat ? { pct: heroStat.percentile, window: '5Y' } : null,
        momentum: { value7d: momentum7d != null ? +momentum7d.toFixed(2) : null, label: momentumLabel },
        termStructure: { ratio: termRatio, label: termLabel, nearMean: vix22dMean != null ? +vix22dMean.toFixed(2) : null, farMean: vix63dMean != null ? +vix63dMean.toFixed(2) : null },
        spx: spxCurrent,
        correlation: { '20d': corr(vix20d, spx20d), '60d': corr(vix60d, spx60d) },
        stats,
        history: vixHistory,
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
}, 300);

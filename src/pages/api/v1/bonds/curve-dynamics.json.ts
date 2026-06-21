export const prerender = false;

import { query } from '../../../../lib/db';
import { withCache } from '../../../../lib/cache';
import type { CurveDynamicsResponse, NelsonSiegelFactors } from '../../../../lib/core';

// 期限 -> 年化值 τ（用于 Nelson-Siegel 模型）
const TENOR_TAU: Record<string, number> = {
  '1M': 1 / 12,
  '3M': 0.25,
  '6M': 0.5,
  '1Y': 1,
  '2Y': 2,
  '3Y': 3,
  '5Y': 5,
  '7Y': 7,
  '10Y': 10,
  '20Y': 20,
  '30Y': 30,
};

// 衰减参数 λ（年）。常见取值 1.5 / 2.5 / 3。这里取 2.0 让中长端也参与曲率因子。
const LAMBDA = 2.0;

// 美国 / 中国期限代码
const US_TENORS: Record<string, string> = {
  DGS1MO: '1M',
  DGS3MO: '3M',
  DGS6MO: '6M',
  DGS1: '1Y',
  DGS2: '2Y',
  DGS3: '3Y',
  DGS5: '5Y',
  DGS7: '7Y',
  DGS10: '10Y',
  DGS20: '20Y',
  DGS30: '30Y',
};

const CN_TENORS: Record<string, string> = {
  CN_TREASURY_3M: '3M',
  CN_TREASURY_6M: '6M',
  CN_TREASURY_1Y: '1Y',
  CN_TREASURY_2Y: '2Y',
  CN_TREASURY_3Y: '3Y',
  CN_TREASURY_5Y: '5Y',
  CN_TREASURY_7Y: '7Y',
  CN_TREASURY_10Y: '10Y',
  CN_TREASURY_20Y: '20Y',
  CN_TREASURY_30Y: '30Y',
};

// 至少要 N 个期限数据点才做拟合
const MIN_POINTS = 4;
// 历史 250 个交易日
const HISTORY_DAYS = 250;

interface DayCurve {
  date: string;
  points: { tau: number; yield: number }[];
}

async function loadCurveHistory(
  tenorMap: Record<string, string>,
  region: string
): Promise<DayCurve[]> {
  const codes = Object.keys(tenorMap);
  const placeholders = codes.map(() => '?').join(',');
  const rows = await query<any>(
    `SELECT i.code, d.period_date, d.value
     FROM indicators i
     JOIN indicator_data d ON d.indicator_id = i.id
     WHERE i.region = ? AND i.code IN (${placeholders})
       AND d.value IS NOT NULL
     ORDER BY d.period_date DESC
     LIMIT ?`,
    [region, ...codes, HISTORY_DAYS * codes.length]
  );

  // 按日期分组
  const byDate = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const d = String(r.period_date).slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, new Map());
    byDate.get(d)!.set(tenorMap[r.code], Number(r.value));
  }

  const out: DayCurve[] = [];
  for (const [date, m] of byDate) {
    const points: { tau: number; yield: number }[] = [];
    for (const [tenor, y] of m) {
      const tau = TENOR_TAU[tenor];
      if (tau != null && y != null && !Number.isNaN(y)) {
        points.push({ tau, yield: y });
      }
    }
    if (points.length >= MIN_POINTS) {
      out.push({ date, points: points.sort((a, b) => a.tau - b.tau) });
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

// Nelson-Siegel 载荷因子（固定 λ 后，模型对 β 是线性的）
function nsLoadings(tau: number): [number, number, number] {
  // x1 = 1
  // x2 = (1 - exp(-τ/λ)) / (τ/λ)
  // x3 = x2 - exp(-τ/λ)
  const x1 = 1;
  const ratio = tau / LAMBDA;
  const expv = Math.exp(-ratio);
  const x2 = ratio === 0 ? 1 : (1 - expv) / ratio;
  const x3 = x2 - expv;
  return [x1, x2, x3];
}

// 解 3x3 线性最小二乘：β = (XᵀX)⁻¹ Xᵀy
function fitNelsonSiegel(points: { tau: number; yield: number }[]): {
  beta: [number, number, number] | null;
  rmse: number | null;
} {
  if (points.length < MIN_POINTS) return { beta: null, rmse: null };

  // 累计 XᵀX (3x3) 和 Xᵀy (3)
  const XtX = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const Xty = [0, 0, 0];

  for (const p of points) {
    const [x1, x2, x3] = nsLoadings(p.tau);
    const xs = [x1, x2, x3];
    for (let i = 0; i < 3; i++) {
      Xty[i] += xs[i] * p.yield;
      for (let j = 0; j < 3; j++) {
        XtX[i][j] += xs[i] * xs[j];
      }
    }
  }

  const inv = invert3x3(XtX);
  if (!inv) return { beta: null, rmse: null };

  const beta: [number, number, number] = [
    inv[0][0] * Xty[0] + inv[0][1] * Xty[1] + inv[0][2] * Xty[2],
    inv[1][0] * Xty[0] + inv[1][1] * Xty[1] + inv[1][2] * Xty[2],
    inv[2][0] * Xty[0] + inv[2][1] * Xty[1] + inv[2][2] * Xty[2],
  ];

  // 计算 RMSE
  let sse = 0;
  for (const p of points) {
    const [x1, x2, x3] = nsLoadings(p.tau);
    const yhat = beta[0] * x1 + beta[1] * x2 + beta[2] * x3;
    sse += (p.yield - yhat) ** 2;
  }
  const rmse = Math.sqrt(sse / points.length);

  return { beta, rmse };
}

function invert3x3(m: number[][]): number[][] | null {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];

  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1 / det;
  return [
    [(e * i - f * h) * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet],
    [(f * g - d * i) * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet],
    [(d * h - e * g) * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet],
  ];
}

function percentile(sortedAsc: number[], value: number): number | null {
  if (sortedAsc.length === 0) return null;
  let lessEq = 0;
  for (const v of sortedAsc) {
    if (v <= value) lessEq++;
    else break;
  }
  return (lessEq / sortedAsc.length) * 100;
}

export const GET = withCache(async ({ request }) => {
  try {
    const url = new URL(request.url);
    const region = (url.searchParams.get('region') || 'US').toUpperCase() as 'US' | 'CN';

    const tenorMap = region === 'CN' ? CN_TENORS : US_TENORS;
    const curveHistory = await loadCurveHistory(tenorMap, region);

    const history: NelsonSiegelFactors[] = [];
    let latestRmse: number | null = null;

    for (const day of curveHistory) {
      const { beta, rmse } = fitNelsonSiegel(day.points);
      if (beta) {
        history.push({
          date: day.date,
          level: +beta[0].toFixed(4),
          slope: +beta[1].toFixed(4),
          curvature: +beta[2].toFixed(4),
        });
        latestRmse = rmse != null ? +rmse.toFixed(4) : null;
      }
    }

    if (history.length === 0) {
      const empty: CurveDynamicsResponse = {
        country: region,
        lambda: LAMBDA,
        history: [],
        latest: null,
        percentiles: { level: null, slope: null, curvature: null },
        latestRmse: null,
      };
      return new Response(JSON.stringify({ success: true, data: empty }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const latest = history[history.length - 1];
    const levels = history.map((h) => h.level!).filter((v) => v != null);
    const slopes = history.map((h) => h.slope!).filter((v) => v != null);
    const curvatures = history.map((h) => h.curvature!).filter((v) => v != null);

    const result: CurveDynamicsResponse = {
      country: region,
      lambda: LAMBDA,
      history,
      latest,
      percentiles: {
        level: +percentile([...levels].sort((a, b) => a - b), latest.level!)!.toFixed(1),
        slope: +percentile([...slopes].sort((a, b) => a - b), latest.slope!)!.toFixed(1),
        curvature: +percentile([...curvatures].sort((a, b) => a - b), latest.curvature!)!.toFixed(1),
      },
      latestRmse,
    };

    return new Response(JSON.stringify({ success: true, data: result }), {
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

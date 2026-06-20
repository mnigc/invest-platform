const fs = require('fs');

function check(file, search, replace) {
  let c = fs.readFileSync(file, 'utf8');
  const hasCRLF = c.includes('\r\n');
  let s = search.replace(/\r\n/g, '\n').replace(/\n/g, hasCRLF ? '\r\n' : '\n');
  let r = replace.replace(/\r\n/g, '\n').replace(/\n/g, hasCRLF ? '\r\n' : '\n');
  if (c.includes(s)) {
    c = c.replace(s, r);
    fs.writeFileSync(file, c);
    return 'OK';
  }
  return 'NOT FOUND';
}

// Mod 1: DailySnapshot.astro
const r1 = check(
  'd:\\project\\invest-platform\\src\\components\\DailySnapshot.astro',
  '        <CnValuation data={cnData?.valuation} client:load />\n        <CnPolicyRisk client:load />\n      </div>\n      <div class="panels-grid">\n        <CnOutlook data={cnData?.summary} client:load class="full-span" />\n      </div>\n    </div>',
  '        <CnValuation data={cnData?.valuation} client:load />\n        <CnPolicyRisk client:load />\n        <CnOutlook data={cnData?.summary} client:load />\n      </div>\n    </div>'
);
console.log('DailySnapshot:', r1);

// Mod 2: UsHeroPanel.tsx - extend FALLBACK_INDICES
let f2 = 'd:\\project\\invest-platform\\src\\components\\regime\\UsHeroPanel.tsx';
let c2 = fs.readFileSync(f2, 'utf8');

const oldIndicesOld = `const FALLBACK_INDICES: CoreIndex[] = [
  { name: 'S&P 500', code: 'SPX', value: 5487.03, change: 0.25 },
  { name: 'NASDAQ 100', code: 'NDX', value: 19685.42, change: 0.68 },
  { name: 'Dow Jones', code: 'DJI', value: 38920.35, change: -0.12 },
  { name: 'Russell 2000', code: 'RUT', value: 2042.18, change: -0.45 },
]`;

const newIndices = `const FALLBACK_INDICES: CoreIndex[] = [
  { name: 'S&P 500', code: 'SPX', value: 5487.03, change: 0.25 },
  { name: 'NASDAQ 100', code: 'NDX', value: 19685.42, change: 0.68 },
  { name: 'Dow Jones', code: 'DJI', value: 38920.35, change: -0.12 },
  { name: 'Russell 2000', code: 'RUT', value: 2042.18, change: -0.45 },
  { name: '费城半导体', code: 'SOX', value: 4320.85, change: 1.85 },
  { name: '纳指100 ETF', code: 'QQQ', value: 478.32, change: 0.72 },
  { name: '恐慌指数', code: 'VIX', value: 14.28, change: -3.15 },
  { name: '黄金', code: 'GOLD', value: 2385.40, change: 0.48 },
]`;

// detect line endings
const hasCRLF2 = c2.includes('\r\n');
const nl = hasCRLF2 ? '\r\n' : '\n';

function withNL(s) { return s.replace(/\r\n/g, '\n').replace(/\n/g, nl); }

if (c2.includes(withNL(oldIndicesOld))) {
  c2 = c2.replace(withNL(oldIndicesOld), withNL(newIndices));
  console.log('UsHeroPanel: indices expanded');
} else {
  console.log('UsHeroPanel: indices NOT FOUND');
}

// Mod 2b: update finalIndices logic
const oldLogicOld = `  const finalIndices = indices && indices.length > 0
    ? indices.map((d: any) => ({ name: d.name, code: d.symbol?.replace('^', '') || '', value: d.price, change: d.change }))
    : FALLBACK_INDICES`;

const newLogic = `  const finalIndices = (indices && indices.length > 0)
    ? [...indices.map((d: any) => ({ name: d.name, code: d.symbol?.replace('^', '') || '', value: d.price, change: d.change })),
       ...FALLBACK_INDICES.slice(4)]
    : FALLBACK_INDICES`
const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: '204.44.121.43',
    port: 3306,
    user: 'mnigc',
    password: 'woaiyinyue.4',
    database: 'invest_platform',
  });

  const symbols = ['DX-Y.NYB', 'EURUSD=X', 'USDJPY=X', 'GBPUSD=X', 'USDCNH=X', 'USDCHF=X', 'AUDUSD=X', 'USDCAD=X', 'NZDUSD=X'];

  const [assets] = await pool.query('SELECT id, symbol, name_zh FROM assets WHERE symbol IN (?)', [symbols]);
  console.log('--- Assets ---');
  assets.forEach(r => console.log(`  ${r.id} | ${r.symbol} | ${r.name_zh}`));

  const [prices] = await pool.query(
    'SELECT a.symbol, COUNT(*) as cnt, MIN(p.trade_date) as min_dt, MAX(p.trade_date) as max_dt ' +
    'FROM assets a JOIN asset_prices p ON p.asset_id = a.id WHERE a.symbol IN (?) GROUP BY a.symbol',
    [symbols]
  );
  console.log('--- Price counts ---');
  prices.forEach(r => console.log(`  ${r.symbol} | ${r.cnt} rows | ${String(r.min_dt)} to ${String(r.max_dt)}`));

  // 检查 asset_categories 中的 fx 分类
  const [cat] = await pool.query("SELECT * FROM asset_categories WHERE code = 'fx'");
  console.log('--- FX category ---');
  console.log(JSON.stringify(cat));

  // 检查黄金和 SPX 是否有价格数据
  const [goldSpx] = await pool.query(
    "SELECT a.symbol, a.name_zh, COUNT(p.id) as cnt FROM assets a LEFT JOIN asset_prices p ON p.asset_id = a.id WHERE a.symbol IN ('GC=F', '^GSPC') GROUP BY a.symbol, a.name_zh"
  );
  console.log('--- Gold & SPX ---');
  goldSpx.forEach(r => console.log(`  ${r.symbol} | ${r.name_zh} | ${r.cnt} rows`));

  pool.end();
})().catch(e => { console.error(e); process.exit(1); });

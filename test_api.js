const http = require('http');
function test(path) {
  return new Promise((resolve) => {
    http.get(`http://localhost:4322${path}`, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve({ path, status: j.success, hasData: !!j.data });
        } catch (e) { resolve({ path, err: d.slice(0, 300) }); }
      });
    }).on('error', (e) => resolve({ path, netErr: e.message }));
  });
}
async function main() {
  const results = await Promise.all([
    test('/api/v1/indicators/US/GDP.json?period=10Y&yearly=true'),
    test('/api/v1/indicators/US/PCE.json?period=10Y&yearly=true'),
    test('/api/v1/snapshot/us.json'),
    test('/api/v1/snapshot/cn.json'),
    test('/api/v1/regime.json'),
  ]);
  console.log(JSON.stringify(results, null, 2));
}
main();

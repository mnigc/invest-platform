import type { APIRoute } from 'astro';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../../..');

const SCRIPTS: Record<string, { path: string; args: string[] }> = {
  assets:       { path: 'doc/sync_data.py',             args: ['assets'] },
  indicators:   { path: 'doc/sync_data.py',             args: ['indicators'] },
  cn:           { path: 'doc/sync_data_cn.py',          args: [] },
  cn_stocks:    { path: 'doc/sync_data_cn_stocks.py',   args: ['--quick', '--daily'] },
};

function runScript(script: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const scriptPath = resolve(projectRoot, script);
    const child = execFile('python', [scriptPath, ...args], {
      cwd: projectRoot,
      timeout: 300_000, // 5 min
    });
    let output = '';
    child.stdout?.on('data', (chunk: string) => { output += chunk; });
    child.stderr?.on('data', (chunk: string) => { output += chunk; });
    child.on('close', (code) => {
      if (code === 0) resolvePromise(output);
      else reject(new Error(`exit code ${code}\n${output}`));
    });
    child.on('error', reject);
  });
}

export const GET: APIRoute = async ({ url }) => {
  const type = url.searchParams.get('type') || 'all';

  const tasks: string[] = type === 'all'
    ? ['assets', 'indicators', 'cn', 'cn_stocks']
    : [type];

  const results: { task: string; success: boolean; output?: string; error?: string }[] = [];

  for (const task of tasks) {
    const cfg = SCRIPTS[task];
    if (!cfg) {
      results.push({ task, success: false, error: `unknown sync type: ${task}` });
      continue;
    }
    try {
      const output = await runScript(cfg.path, cfg.args);
      results.push({ task, success: true, output: output.trim() });
    } catch (err: any) {
      results.push({ task, success: false, error: err.message });
    }
  }

  const allOk = results.every(r => r.success);
  return new Response(JSON.stringify({ success: allOk, results }, null, 2), {
    status: allOk ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
};

import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
// 从项目根目录加载 .env
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') })

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { errorHandler } from './middleware/error.js'
import indicatorsRouter from './routes/v1/indicators.js'
import snapshotRouter from './routes/v1/snapshot.js'
import statusRouter from './routes/v1/status.js'
import bondRouter from './routes/v1/bond.js'
import regimeRouter from './routes/v1/regime.js'
import regimeBacktestRouter from './routes/v1/regime_backtest.js'
import anomalyRouter from './routes/v1/anomaly.js'

const app = new Hono()

// Global middleware
app.use('*', cors())
app.use('*', errorHandler)

// Health check
app.get('/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }))

// API v1 routes
app.route('/api/v1/indicators', indicatorsRouter)
app.route('/api/v1/snapshot', snapshotRouter)
app.route('/api/v1/status', statusRouter)
app.route('/api/v1/bond', bondRouter)
app.route('/api/v1/regime', regimeRouter)
app.route('/api/v1/regime', regimeBacktestRouter)
app.route('/api/v1/regime', anomalyRouter)

// Start server
const port = Number(process.env.API_PORT) || 3001
console.log(`[API] Starting on port ${port}`)

serve({
  fetch: app.fetch,
  port,
})

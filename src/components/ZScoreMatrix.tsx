import { useEffect, useState } from 'react'
import { MacroCard } from './ui/MacroCard'
import { LoadingSkeleton } from './ui/LoadingSkeleton'

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

interface PanelData {
  us: ZScoreEntry[]
  cn: ZScoreEntry[]
}

const LOOKBACK_KEYS = ['1Y', '3Y', '5Y', '10Y']

const CATEGORY_ORDER: Record<string, number> = { equity: 0, bond: 1, rate: 2, commodity: 3, fx: 4, macro: 5, volatility: 6 }
const CATEGORY_LABELS: Record<string, string> = {
  equity: '权益', bond: '债券', rate: '利率', commodity: '商品',
  fx: '外汇', macro: '宏观', volatility: '波动率',
}

function zColor(z: number): string {
  if (z > 1.5) return 'var(--red)'
  if (z > 1.0) return 'var(--accent-gold)'
  if (z > -1.0) return 'var(--green)'
  if (z > -1.5) return 'var(--accent-gold)'
  return 'var(--accent-blue)'
}

function zBg(z: number): string {
  if (z > 1.5) return 'var(--red-bg)'
  if (z > 1.0) return 'var(--accent-gold-dim)'
  if (z > -1.0) return 'var(--green-bg)'
  if (z > -1.5) return 'var(--accent-gold-dim)'
  return 'var(--accent-blue-dim)'
}

function zLabel(z: number): string {
  if (z > 1.5) return '过热'
  if (z > 1.0) return '偏贵'
  if (z > -1.0) return '正常'
  if (z > -1.5) return '偏便宜'
  return '低迷'
}

function fmtValue(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0)
  if (Math.abs(v) >= 10) return v.toFixed(2)
  if (Math.abs(v) >= 1) return v.toFixed(3)
  return v.toFixed(4)
}

function sortEntries(entries: ZScoreEntry[]): ZScoreEntry[] {
  return [...entries].sort((a, b) => (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99))
}

function MatrixTable({ entries }: { entries: ZScoreEntry[] }) {
  const sorted = sortEntries(entries)

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse', fontSize: '12px',
        fontFamily: 'var(--font-mono)',
      }}>
        <thead>
          <tr>
            <th style={{
              textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600,
              borderBottom: `1px solid var(--border-light)`, position: 'sticky', left: 0,
              background: 'var(--bg-card)', zIndex: 1, minWidth: '140px',
            }}>
              资产
            </th>
            <th style={{
              textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600,
              borderBottom: `1px solid var(--border-light)`, minWidth: '80px',
            }}>
              当前值
            </th>
            {LOOKBACK_KEYS.map(key => (
              <th key={key} style={{
                textAlign: 'center', padding: '8px 6px', color: 'var(--text-muted)',
                fontWeight: 600, borderBottom: `1px solid var(--border-light)`, width: '80px',
              }}>
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry, i) => {
            const showCategory = i === 0 || sorted[i - 1].category !== entry.category
            const categoryLabel = CATEGORY_LABELS[entry.category] || entry.category

            return (
              <tr key={entry.code} style={{ borderBottom: `1px solid var(--border-light)` }}>
                <td style={{
                  padding: '10px 12px', position: 'sticky', left: 0,
                  background: 'var(--bg-card)', zIndex: 0,
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  {showCategory && (
                    <span style={{
                      fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
                      background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)',
                      fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {categoryLabel}
                    </span>
                  )}
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '12px' }}>{entry.label}</span>
                </td>
                <td style={{
                  padding: '10px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap',
                  textAlign: 'right', fontFamily: 'var(--font-mono)',
                }}>
                  {entry.currentValue != null ? fmtValue(entry.currentValue) : '--'}
                </td>
                {LOOKBACK_KEYS.map(key => {
                  const z = entry.zScores[key]
                  if (z == null) {
                    return (
                      <td key={key} style={{
                        padding: '10px 6px', textAlign: 'center', color: 'var(--text-muted)',
                        fontSize: '11px', opacity: 0.5,
                      }}>
                        --
                      </td>
                    )
                  }
                  const mean = entry.means[key]
                  const std = entry.stds[key]
                  const color = zColor(z)
                  const bg = zBg(z)
                  const label = zLabel(z)
                  return (
                    <td
                      key={key}
                      style={{
                        padding: '10px 6px', textAlign: 'center', cursor: 'default',
                        background: bg, borderRadius: '6px',
                      }}
                      title={`${entry.label} ${key}\nZ-Score: ${z.toFixed(2)} (${label})\n当前值: ${entry.currentValue != null ? fmtValue(entry.currentValue) : '--'}\n均值: ${mean?.toFixed(4) ?? '--'}\n标准差: ${std?.toFixed(4) ?? '--'}\n数据量: ${entry.dataPoints}天 · ${entry.frequency}`}
                    >
                      <span style={{ color, fontWeight: 700, fontSize: '13px' }}>{z.toFixed(2)}</span>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EmptyHint({ region }: { region: string }) {
  return (
    <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', lineHeight: 1.8 }}>
      <div style={{ marginBottom: '6px', fontSize: '20px', opacity: 0.4 }}>
        {region === 'us' ? '🇺🇸' : '🇨🇳'}
      </div>
      暂无数据 — 数据同步中
    </div>
  )
}

function LegendBar() {
  return (
    <div style={{
      marginTop: '12px', paddingTop: '10px', borderTop: `1px solid var(--border-light)`,
      display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--text-muted)', flexWrap: 'wrap',
      alignItems: 'center',
    }}>
      <Legend color="var(--red)" label="过热 >1.5σ" />
      <Legend color="var(--accent-gold)" label="偏离 >1σ" />
      <Legend color="var(--green)" label="正常 ±1σ" />
      <Legend color="var(--accent-blue)" label="低迷 <-1.5σ" />
      <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
        Z = (当前值 - 均值) / 标准差
      </span>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

export function ZScoreMatrix() {
  const [data, setData] = useState<PanelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/v1/zscore-matrix.json')
      .then(r => r.json())
      .then(res => {
        if (!res.success) { setError(res.error || '请求失败'); return }
        setData(res.data)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const usEntries = data?.us ?? []
  const cnEntries = data?.cn ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <MacroCard title="🇺🇸 美国资产" badge={`${usEntries.length} 个`}>
        {loading && <LoadingSkeleton type="table" rows={6} />}
        {!loading && error && <div style={{ padding: '16px', textAlign: 'center', color: 'var(--red)', fontSize: '13px' }}>{error}</div>}
        {!loading && !error && usEntries.length === 0 && <EmptyHint region="us" />}
        {!loading && usEntries.length > 0 && <MatrixTable entries={usEntries} />}
        {!loading && usEntries.length > 0 && <LegendBar />}
      </MacroCard>

      <MacroCard title="🇨🇳 中国资产" badge={`${cnEntries.length} 个`}>
        {loading && <LoadingSkeleton type="table" rows={6} />}
        {!loading && error && <div style={{ padding: '16px', textAlign: 'center', color: 'var(--red)', fontSize: '13px' }}>{error}</div>}
        {!loading && !error && cnEntries.length === 0 && <EmptyHint region="cn" />}
        {!loading && cnEntries.length > 0 && <MatrixTable entries={cnEntries} />}
        {!loading && cnEntries.length > 0 && <LegendBar />}
      </MacroCard>
    </div>
  )
}

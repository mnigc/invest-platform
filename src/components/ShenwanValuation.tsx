import { useEffect, useMemo, useState } from 'react'
import { THEME } from './ui/theme'
import { LoadingSkeleton } from './ui/LoadingSkeleton'

interface Industry {
  name: string
  pe: number
  pb: number
  stockCount: number
}

type SortKey = 'name' | 'pe_asc' | 'pe_desc' | 'pb_asc' | 'pb_desc'

const btnBase: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '6px',
  fontSize: '10px',
  fontWeight: 600,
  fontFamily: THEME.fontDisplay,
  letterSpacing: '0.03em',
  border: 'none',
  cursor: 'pointer',
  transition: 'all 0.15s',
}

const cardCss = {
  container: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: '10px',
  } as React.CSSProperties,
  card: {
    background: 'var(--bg-elevated)',
    borderRadius: '10px',
    border: '1px solid var(--border-light)',
    padding: '12px 14px',
    cursor: 'default',
    transition: 'all 0.2s',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  name: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '6px',
  },
  label: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  value: {
    fontSize: '15px',
    fontWeight: 600,
    fontFamily: THEME.fontMono,
  } as React.CSSProperties,
  valueSmall: {
    fontSize: '13px',
    fontWeight: 500,
    fontFamily: THEME.fontMono,
  } as React.CSSProperties,
}

function PctDot({ pct }: { pct: number }) {
  const c = pct >= 80 ? THEME.red : pct >= 60 ? '#f59e0b' : pct >= 40 ? '#94a3b8' : pct >= 20 ? '#22c55e' : THEME.green
  return (
    <span style={{
      display: 'inline-block',
      width: 6, height: 6, borderRadius: '50%',
      background: c,
      flexShrink: 0,
    }} />
  )
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name', label: '默认' },
  { key: 'pe_desc', label: 'PE ↓' },
  { key: 'pe_asc', label: 'PE ↑' },
  { key: 'pb_desc', label: 'PB ↓' },
  { key: 'pb_asc', label: 'PB ↑' },
]

export default function ShenwanValuation() {
  const [industries, setIndustries] = useState<Industry[]>([])
  const [updateDate, setUpdateDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('name')

  useEffect(() => {
    let ok = true
    fetch('/api/v1/cn-valuation.json').then(r => r.json()).then(d => {
      if (ok) {
        setIndustries(d.data || [])
        if (d.date) setUpdateDate(String(d.date).slice(0, 10))
      }
    }).catch(() => {}).finally(() => { if (ok) setLoading(false) })
    return () => { ok = false }
  }, [])

  const sorted = useMemo(() => {
    const list = [...industries]
    if (sortKey === 'pe_desc') list.sort((a, b) => (b.pe || 0) - (a.pe || 0))
    else if (sortKey === 'pe_asc') list.sort((a, b) => (a.pe || 0) - (b.pe || 0))
    else if (sortKey === 'pb_desc') list.sort((a, b) => (b.pb || 0) - (a.pb || 0))
    else if (sortKey === 'pb_asc') list.sort((a, b) => (a.pb || 0) - (b.pb || 0))
    return list
  }, [industries, sortKey])

  if (loading) return <div style={{ height: 200 }}><LoadingSkeleton type="card" height={200} /></div>
  if (!industries.length) return null

  const peList = industries.filter(i => i.pe > 0).map(i => i.pe).sort((a, b) => a - b)
  const pbList = industries.filter(i => i.pb > 0).map(i => i.pb).sort((a, b) => a - b)

  function pct(sorted: number[], val: number) {
    if (!sorted.length || val <= 0) return 50
    const idx = sorted.findIndex(v => v >= val)
    return idx < 0 ? 100 : Math.round((idx / sorted.length) * 100)
  }

  return (
    <div style={{ marginTop: 16, background: 'var(--bg-card)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--border-light)', padding: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        申万一级行业估值扫描
        {updateDate && <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>· {updateDate}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
          {SORT_OPTIONS.map(opt => (
            <button key={opt.key} onClick={() => setSortKey(opt.key)}
              style={{
                ...btnBase,
                background: sortKey === opt.key ? THEME.blue : 'var(--bg-elevated)',
                color: sortKey === opt.key ? THEME.textPrimary : 'var(--text-muted)',
              }}
            >{opt.label}</button>
          ))}
        </div>
      </div>

      <div style={cardCss.container}>
        {sorted.map(ind => {
          const pc = pct(peList, ind.pe)
          const pbc = pct(pbList, ind.pb)
          const peColor = pc >= 80 ? THEME.red : pc >= 60 ? '#f59e0b' : pc >= 40 ? '#94a3b8' : pc >= 20 ? '#22c55e' : THEME.green
          const pbColor = pbc >= 80 ? THEME.red : pbc >= 60 ? '#f59e0b' : pbc >= 40 ? '#94a3b8' : pbc >= 20 ? '#22c55e' : THEME.green
          return (
            <div key={ind.name} style={cardCss.card}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; e.currentTarget.style.background = 'var(--bg-card-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
            >
              <div style={cardCss.name} title={ind.name}>{ind.name}</div>
              <div style={cardCss.row}>
                <span style={cardCss.label}>PE</span>
                <span style={{ ...cardCss.value, color: peColor }}>{ind.pe > 0 ? ind.pe.toFixed(1) : '--'}</span>
              </div>
              <div style={cardCss.row}>
                <span style={cardCss.label}>PB</span>
                <span style={{ ...cardCss.valueSmall, color: pbColor }}>{ind.pb > 0 ? ind.pb.toFixed(2) : '--'}</span>
              </div>
              <div style={{ ...cardCss.row, marginTop: 1 }}>
                <PctDot pct={pc} />
                <PctDot pct={pbc} />
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>{ind.stockCount}只股票</span>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ color: THEME.red }}>● 高估</span>
        <span style={{ color: '#f59e0b' }}>● 偏高</span>
        <span style={{ color: '#94a3b8' }}>● 中等</span>
        <span style={{ color: '#22c55e' }}>● 偏低</span>
        <span style={{ color: THEME.green }}>● 低估</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)' }}>左圆点=PE 右圆点=PB</span>
      </div>
    </div>
  )
}

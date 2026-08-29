import type { KnowledgeNode } from './KnowledgeCanvas'
import { nodeTypeMeta } from './KnowledgeCanvas'

interface Props {
  node: KnowledgeNode | null
}

export function NodeDetail({ node }: Props) {
  if (!node) {
    return (
      <div style={{
        height: '100%', minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', fontSize: 12, padding: 16, textAlign: 'center',
      }}>
        点击图谱节点查看详情<br />拖拽节点可调整布局
      </div>
    )
  }
  const meta = nodeTypeMeta[node.type] || nodeTypeMeta.driver
  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
          color: meta.color, background: meta.bg, letterSpacing: '0.04em' as any,
        }}>
          {meta.label}
        </span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{node.label}</div>
      <div style={{ fontSize: 12, lineHeight: 1.8, color: 'var(--text-secondary)' }}>{node.desc}</div>
    </div>
  )
}

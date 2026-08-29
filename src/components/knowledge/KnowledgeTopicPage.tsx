import { useState } from 'react'
import { KnowledgeCanvas, type KnowledgeNode, type KnowledgeEdge } from './KnowledgeCanvas'
import { NodeDetail } from './NodeDetail'

export interface KnowledgeTopic {
  title: string
  subtitle: string
  intro: string
  conclusion: string
  strategy: string[]
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
}

interface Props {
  topic: KnowledgeTopic
}

export function KnowledgeTopicPage({ topic }: Props) {
  const [selected, setSelected] = useState<KnowledgeNode | null>(null)

  return (
    <div>
      <section style={{
        background: 'linear-gradient(135deg, rgba(59,130,246,0.10), rgba(6,182,212,0.06))',
        border: '1px solid var(--border-light)', borderRadius: 12, padding: '18px 20px', marginBottom: 14,
      }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{topic.title}</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>{topic.subtitle}</p>
        <p style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.8, color: 'var(--text-secondary)' }}>{topic.intro}</p>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 14, alignItems: 'start' }}>
        <KnowledgeCanvas
          nodes={topic.nodes}
          edges={topic.edges}
          selected={selected?.id ?? null}
          onSelect={setSelected}
        />
        <aside style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, minHeight: 200,
        }}>
          <NodeDetail node={selected} />
        </aside>
      </section>

      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 16, marginTop: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-blue)', letterSpacing: '0.06em', marginBottom: 8 }}>核心结论</div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.9, color: 'var(--text-secondary)' }}>{topic.conclusion}</p>
      </section>

      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 16, marginTop: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)', letterSpacing: '0.06em', marginBottom: 8 }}>投研应用</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 2, color: 'var(--text-secondary)' }}>
          {topic.strategy.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      </section>
    </div>
  )
}

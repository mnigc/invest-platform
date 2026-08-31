import { useState } from 'react'
import { KnowledgeCanvas, type KnowledgeNode, type KnowledgeEdge } from './KnowledgeCanvas'
import { NodeDetail } from './NodeDetail'
import { PageHeader } from '../ui/PageHeader'
import { MacroCard } from '../ui/MacroCard'

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
    <div className="flex flex-col gap-4">
      <PageHeader title={topic.title} subtitle={topic.subtitle} />

      {topic.intro && (
        <MacroCard padding="md">
          <p className="text-sm leading-relaxed text-ink-2">{topic.intro}</p>
        </MacroCard>
      )}

      {/* 移动端单列；lg 起画布 + 右栏详情并排 */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <KnowledgeCanvas
          nodes={topic.nodes}
          edges={topic.edges}
          selected={selected?.id ?? null}
          onSelect={setSelected}
        />
        <aside className="min-w-0 rounded-lg border border-line bg-surface">
          <NodeDetail node={selected} />
        </aside>
      </div>

      <MacroCard padding="lg">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-accent">
          核心结论
        </h2>
        <p className="text-sm leading-loose text-ink-2">{topic.conclusion}</p>
      </MacroCard>

      <MacroCard padding="lg">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-info">
          投研应用
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-loose text-ink-2">
          {topic.strategy.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </MacroCard>
    </div>
  )
}

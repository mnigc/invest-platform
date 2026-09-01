import { useState } from 'react'
import { KnowledgeCanvas } from './KnowledgeCanvas'
import { NodeDetail } from './NodeDetail'
import { PageHeader } from '../ui/PageHeader'
import { MacroCard } from '../ui/MacroCard'
import type { KnowledgeNode, KnowledgeTopic } from './graph'

export interface RelatedTopic {
  slug: string
  title: string
  subtitle: string
}

interface Props {
  topic: KnowledgeTopic
  related?: RelatedTopic[]
}

export function KnowledgeTopicPage({ topic, related = [] }: Props) {
  const [selected, setSelected] = useState<KnowledgeNode | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <a
        href="/knowledge"
        aria-label="返回知识图谱"
        className="inline-flex w-fit items-center gap-1.5 text-xs text-ink-3 transition-colors duration-1 ease-terminal hover:text-ink-2"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M19 12H5m6-7-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        返回知识图谱
      </a>

      <PageHeader title={topic.title} subtitle={topic.subtitle} />

      {topic.intro && (
        <MacroCard padding="md" accent="blue">
          <p className="text-sm leading-relaxed text-ink-2">{topic.intro}</p>
        </MacroCard>
      )}

      {/* 移动端单列；lg 起画布 + 右栏详情并排，详情栏吸顶跟随 */}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <KnowledgeCanvas
          nodes={topic.nodes}
          edges={topic.edges}
          selected={selected?.id ?? null}
          onSelect={setSelected}
        />
        <aside className="min-w-0 rounded-lg border border-line bg-surface lg:sticky lg:top-[68px] lg:max-h-[calc(100vh-86px)] lg:overflow-y-auto">
          <NodeDetail
            node={selected}
            nodes={topic.nodes}
            edges={topic.edges}
            onSelect={setSelected}
          />
        </aside>
      </div>

      <MacroCard padding="lg" accent="gold">
        <h2 className="mb-2 text-2xs font-bold uppercase tracking-widest text-warn">核心结论</h2>
        <p className="text-sm leading-loose text-ink-2">{topic.conclusion}</p>
      </MacroCard>

      <MacroCard padding="lg" accent="cyan">
        <h2 className="mb-3 text-2xs font-bold uppercase tracking-widest text-info">投研应用</h2>
        <ul className="space-y-2.5">
          {topic.strategy.map((s, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="num mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line bg-surface-2 text-2xs font-semibold text-ink-3">
                {i + 1}
              </span>
              <p className="text-xs leading-relaxed text-ink-2">{s}</p>
            </li>
          ))}
        </ul>
      </MacroCard>

      {related.length > 0 && (
        <section>
          <h2 className="mb-2 text-2xs font-bold uppercase tracking-widest text-ink-3">
            继续探索其他机制图
          </h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {related.map((r) => (
              <a
                key={r.slug}
                href={`/knowledge/${r.slug}`}
                className="group flex items-center gap-2.5 rounded-lg border border-line bg-surface p-3 transition-colors duration-1 ease-terminal hover:border-accent/60 hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
                  <span className="mt-0.5 block truncate text-2xs text-ink-3">{r.subtitle}</span>
                </span>
                <svg
                  className="h-4 w-4 shrink-0 text-ink-3 transition-transform duration-2 ease-terminal group-hover:translate-x-0.5 group-hover:text-accent"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h14m-6-6 6 6-6 6" />
                </svg>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

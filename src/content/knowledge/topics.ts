import type { KnowledgeTopic } from '../../components/knowledge/graph'
import inflation from './inflation.json'
import deflation from './deflation.json'
import stagflation from './stagflation.json'
import interestRate from './interest-rate.json'
import liquidity from './liquidity.json'
import credit from './credit.json'
import regime from './regime.json'
import gold from './gold.json'
import recession from './recession.json'
import crossAsset from './cross-asset.json'

export interface KnowledgeTopicEntry {
  slug: string
  title: string
  subtitle: string
  intro: string
  counts: { nodes: number; edges: number }
  data: KnowledgeTopic
}

const RAW: { slug: string; data: KnowledgeTopic }[] = [
  { slug: 'inflation', data: inflation as KnowledgeTopic },
  { slug: 'deflation', data: deflation as KnowledgeTopic },
  { slug: 'stagflation', data: stagflation as KnowledgeTopic },
  { slug: 'interest-rate', data: interestRate as KnowledgeTopic },
  { slug: 'liquidity', data: liquidity as KnowledgeTopic },
  { slug: 'credit', data: credit as KnowledgeTopic },
  { slug: 'regime', data: regime as KnowledgeTopic },
  { slug: 'gold', data: gold as KnowledgeTopic },
  { slug: 'recession', data: recession as KnowledgeTopic },
  { slug: 'cross-asset', data: crossAsset as KnowledgeTopic },
]

export const KNOWLEDGE_TOPICS: KnowledgeTopicEntry[] = RAW.map(({ slug, data }) => ({
  slug,
  title: data.title,
  subtitle: data.subtitle,
  intro: data.intro,
  counts: { nodes: data.nodes.length, edges: data.edges.length },
  data,
}))

/** 主题页底部的交叉导航（排除自身） */
export function relatedTopics(excludeSlug: string) {
  return KNOWLEDGE_TOPICS.filter((t) => t.slug !== excludeSlug).map((t) => ({
    slug: t.slug,
    title: t.title,
    subtitle: t.subtitle,
  }))
}

export function findTopic(slug: string) {
  return KNOWLEDGE_TOPICS.find((t) => t.slug === slug)
}

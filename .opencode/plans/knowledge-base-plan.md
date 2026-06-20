# 知识库（Notion 风格）实施计划

## 依赖
```bash
npm install @astrojs/mdx@^3.0.0 --legacy-peer-deps
```

## 文件结构

```
src/
  content/
    config.ts                          -- Collection schema + frontmatter 校验
    library/
      gdp.mdx                          -- GDP 文章
      cpi.mdx                          -- CPI 文章
      dcf-valuation.mdx                -- DCF 估值模型
      ... (用户提供)
  layouts/
    LibraryLayout.astro                -- 知识库专用布局（带 TOC 侧边栏）
    Layout.astro                       -- 已有，不变
  pages/
    library.astro                      -- 画廊首页（new）
    library/[...slug].astro            -- 文章详情页（new）
  components/
    Sidebar.astro                      -- 已有，加「研究库」链接
```

## 步骤

### Step 1: 创建 content collection schema

`src/content/config.ts`:
```ts
import { defineCollection, z } from 'astro:content';

const library = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.string(),
    icon: z.string().emoji().optional(),
    order: z.number().optional().default(99),
    tags: z.array(z.string()).optional().default([]),
  }),
});

export const collections = { library };
```

### Step 2: 示例文章

创建 `src/content/library/gdp.mdx`:
```yaml
---
title: "GDP"
description: "国内生产总值（Gross Domestic Product）"
category: "经济指标"
icon: "📊"
order: 1
---
## 定义
国内生产总值（GDP）...

## 计算方式
- 生产法
- 支出法
- 收入法

## 解读方法
```
```

### Step 3: 画廊首页 — `src/pages/library.astro`

```astro
---
import Layout from '../layouts/Layout.astro';
import { getCollection } from 'astro:content';

const allArticles = await getCollection('library');
allArticles.sort((a, b) => (a.data.order || 99) - (b.data.order || 99));

// 按分类分组
const categories = [...new Set(allArticles.map(a => a.data.category))];
const grouped = categories.map(cat => ({
  category: cat,
  articles: allArticles.filter(a => a.data.category === cat),
}));
---
<Layout title="研究库 - US MACRO">
  <div class="page-header">
    <h1>研究库</h1>
    <p class="subtitle">宏观经济 / 企业财务 / 投资框架 · 知识百科</p>
  </div>

  <!-- 搜索 + 分类筛选 -->
  <div class="filter-bar">
    <input type="text" id="search" placeholder="搜索文章..." />
    <div class="category-chips">
      <button class="chip active" data-cat="">全部</button>
      {categories.map(cat => <button class="chip" data-cat={cat}>{cat}</button>)}
    </div>
  </div>

  <!-- 分类卡片网格 -->
  {grouped.map(({ category, articles }) => (
    <section class="category-section" data-category={category}>
      <h2 class="category-title">{category}</h2>
      <div class="card-grid">
        {articles.map(article => (
          <a href={`/library/${article.id}`} class="article-card">
            <div class="card-icon">{article.data.icon || '📄'}</div>
            <div class="card-body">
              <div class="card-title">{article.data.title}</div>
              <div class="card-desc">{article.data.description}</div>
            </div>
          </a>
        ))}
      </div>
    </section>
  ))}
</Layout>

<style>
  .page-header { margin-bottom: 20px; }
  .page-header h1 { font-size: 22px; font-weight: 600; color: var(--text-primary); }
  .subtitle { font-size: 12px; color: var(--text-muted); margin-top: 4px; }

  .filter-bar {
    display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
    margin-bottom: 24px;
  }
  .filter-bar input {
    padding: 8px 12px; border-radius: 6px; width: 240px; font-size: 13px;
    background: var(--bg-secondary); border: 1px solid var(--border-color);
    color: var(--text-primary); outline: none;
  }
  .category-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip {
    padding: 4px 12px; border-radius: 14px; cursor: pointer; font-size: 12px;
    background: var(--bg-hover); border: 1px solid var(--border-color);
    color: var(--text-secondary); transition: all 0.15s;
  }
  .chip.active { background: var(--accent-blue); color: #fff; border-color: var(--accent-blue); }

  .category-section { margin-bottom: 28px; }
  .category-title {
    font-size: 14px; font-weight: 600; color: var(--text-primary);
    margin-bottom: 12px; padding-bottom: 8px;
    border-bottom: 1px solid var(--border-color);
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  }
  .article-card {
    display: flex; align-items: center; gap: 12px;
    padding: 14px; background: var(--bg-card);
    border: 1px solid var(--border-color); border-radius: 10px;
    transition: all 0.15s; text-decoration: none;
  }
  .article-card:hover {
    border-color: var(--accent-blue); background: var(--bg-hover);
  }
  .card-icon { font-size: 24px; flex-shrink: 0; }
  .card-body { min-width: 0; }
  .card-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .card-desc { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

  /* 搜索过滤 JS */
  /* 客户端脚本将处理分类筛选和搜索 */
</style>

<script>
  const chips = document.querySelectorAll('.chip');
  const sections = document.querySelectorAll('.category-section');
  const searchInput = document.getElementById('search');

  function filter(category, query) {
    sections.forEach(section => {
      const cat = section.dataset.category;
      const catMatch = !category || cat === category;
      section.style.display = catMatch ? '' : 'none';

      if (catMatch && query) {
        const cards = section.querySelectorAll('.article-card');
        let hasVisible = false;
        cards.forEach(card => {
          const text = card.textContent.toLowerCase();
          const match = text.includes(query.toLowerCase());
          card.style.display = match ? '' : 'none';
          if (match) hasVisible = true;
        });
        section.style.display = hasVisible ? '' : 'none';
      }
    });
  }

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filter(chip.dataset.cat, searchInput.value);
    });
  });

  searchInput.addEventListener('input', () => {
    const active = document.querySelector('.chip.active');
    filter(active?.dataset.cat || '', searchInput.value);
  });
</script>
```

### Step 4: 文章详情页 — `src/pages/library/[...slug].astro`

```astro
---
import Layout from '../../layouts/Layout.astro';
import { getCollection, render } from 'astro:content';

export async function getStaticPaths() {
  const articles = await getCollection('library');
  return articles.map(article => ({
    params: { slug: article.id },
    props: { article },
  }));
}

const { article } = Astro.props;
const { Content, headings } = await render(article);
const { title, description, category, icon } = article.data;
---

<Layout title={`${title} - 研究库 - US MACRO`}>
  <article class="article-layout">
    <!-- TOC 侧边栏 -->
    <aside class="toc-sidebar">
      <div class="toc-sticky">
        <div class="toc-title">目录</div>
        <nav class="toc-nav">
          {headings.filter(h => h.depth <= 3).map(h => (
            <a href={`#${h.slug}`} class="toc-link" style={`padding-left: ${(h.depth - 2) * 12}px`}>
              {h.text}
            </a>
          ))}
        </nav>
      </div>
    </aside>

    <!-- 文章内容 -->
    <div class="article-content">
      <header class="article-header">
        <div class="article-meta">
          {icon && <span class="article-icon">{icon}</span>}
          <span class="article-category">{category}</span>
        </div>
        <h1 class="article-title">{title}</h1>
        <p class="article-desc">{description}</p>
      </header>

      <div class="markdown-body">
        <Content />
      </div>
    </div>
  </article>
</Layout>

<style>
  .article-layout {
    display: flex; gap: 32px; max-width: 1100px;
  }

  .toc-sidebar {
    flex-shrink: 0; width: 200px;
  }
  .toc-sticky {
    position: sticky; top: 24px;
  }
  .toc-title {
    font-size: 11px; font-weight: 600; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px;
  }
  .toc-nav {
    display: flex; flex-direction: column; gap: 6px;
  }
  .toc-link {
    font-size: 12px; color: var(--text-muted); line-height: 1.4;
    text-decoration: none; padding: 2px 0; border-left: 2px solid transparent;
    transition: all 0.15s;
  }
  .toc-link:hover { color: var(--text-primary); border-color: var(--accent-blue); }

  .article-content { flex: 1; min-width: 0; }

  .article-header { margin-bottom: 32px; }
  .article-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .article-icon { font-size: 28px; }
  .article-category {
    font-size: 11px; padding: 2px 8px; border-radius: 4px;
    background: rgba(59,130,246,0.15); color: var(--accent-blue);
  }
  .article-title { font-size: 26px; font-weight: 700; color: var(--text-primary); line-height: 1.3; }
  .article-desc { font-size: 13px; color: var(--text-secondary); margin-top: 6px; }

  .markdown-body {
    color: var(--text-primary); font-size: 14px; line-height: 1.8;
  }
  .markdown-body h2 {
    font-size: 18px; font-weight: 600; margin: 28px 0 12px;
    padding-bottom: 6px; border-bottom: 1px solid var(--border-color);
  }
  .markdown-body h3 {
    font-size: 15px; font-weight: 600; margin: 20px 0 8px;
  }
  .markdown-body p { margin-bottom: 14px; color: var(--text-secondary); }
  .markdown-body ul, .markdown-body ol { margin: 8px 0; padding-left: 20px; }
  .markdown-body li { margin-bottom: 4px; color: var(--text-secondary); }
  .markdown-body code {
    font-size: 13px; padding: 2px 6px; border-radius: 4px;
    background: var(--bg-hover); color: var(--accent-yellow);
  }
  .markdown-body pre {
    background: var(--bg-secondary); padding: 16px; border-radius: 8px;
    border: 1px solid var(--border-color); overflow-x: auto; margin: 16px 0;
  }
  .markdown-body pre code {
    background: none; padding: 0; color: var(--text-primary);
  }
  .markdown-body blockquote {
    border-left: 3px solid var(--accent-blue); padding: 8px 16px;
    margin: 16px 0; background: var(--bg-card); border-radius: 0 6px 6px 0;
    color: var(--text-muted);
  }
  .markdown-body table {
    width: 100%; border-collapse: collapse; margin: 16px 0;
  }
  .markdown-body th, .markdown-body td {
    padding: 8px 12px; border: 1px solid var(--border-color);
    text-align: left; font-size: 13px;
  }
  .markdown-body th {
    background: var(--bg-card); font-weight: 600; color: var(--text-primary);
  }
  .markdown-body td { color: var(--text-secondary); }
</style>

<script>
  // 高亮当前可见的 TOC 项
  const links = document.querySelectorAll('.toc-link');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        links.forEach(l => l.style.color = '');
        const id = entry.target.id;
        const link = document.querySelector(`.toc-link[href="#${id}"]`);
        if (link) link.style.color = 'var(--accent-blue)';
      }
    });
  }, { rootMargin: '-80px 0px -80%' });

  document.querySelectorAll('h2, h3').forEach(h => observer.observe(h));
</script>
```

### Step 5: 示例文章文件

`src/content/library/gdp.mdx`:
```md
---
title: "GDP"
description: "国内生产总值（Gross Domestic Product），衡量经济体在一定时期内生产的所有最终商品和服务的市场价值"
category: "经济指标"
icon: "📊"
order: 1
---

## 定义

**国内生产总值（GDP）** 是衡量一个国家或地区经济产出的最核心指标。

### 三种核算方法

- **生产法（Production Approach）**：GDP = 总产值 - 中间投入
- **支出法（Expenditure Approach）**：GDP = C + I + G + (X - M)
- **收入法（Income Approach）**：GDP = 工资 + 利润 + 租金 + 利息 + 折旧 + 间接税

### 名义 vs 实际

- **名义 GDP**：按当期价格计算
- **实际 GDP**：按基期价格计算，剔除通胀影响

### 构成分析

| 组成部分 | 含义 | 占比（美国） |
|---------|------|------------|
| C (消费) | 居民消费支出 | ~68% |
| I (投资) | 固定资本形成 | ~18% |
| G (政府) | 政府消费与投资 | ~17% |
| X-M (净出口) | 出口减进口 | ~-3% |
```

`src/content/library/cpi.mdx`:
```md
---
title: "CPI"
description: "消费者价格指数，衡量一篮子商品和服务的价格水平变化"
category: "经济指标"
icon: "📈"
order: 2
---

## 定义

**消费者价格指数（CPI）** 衡量普通消费者购买的一篮子商品和服务的价格随时间的变化。

### CPI 的构成

1. **食品和饮料**（~14%）
2. **住房**（~42%）— 占比最大
3. **交通运输**（~16%）
4. **医疗保健**（~9%）
5. **教育通信**（~7%）
...

### 核心 CPI vs 整体 CPI

- **整体 CPI**：包含所有项目，包括波动较大的食品和能源
- **核心 CPI**：剔除食品和能源，更能反映潜在通胀趋势

### 解读方法

- CPI 环比（MoM）：月度变化
- CPI 同比（YoY）：年度变化，通常用于判断通胀趋势
```

`src/content/library/dcf-valuation.mdx`:
```md
---
title: "DCF 估值模型"
description: "现金流折现法，通过预测未来自由现金流并折现到现在来估算企业价值"
category: "企业核心指标"
icon: "💰"
order: 1
---

## DCF 模型原理

**现金流折现（DCF）** 是最经典的绝对估值方法。

### 公式

```
企业价值 = Σ FCFt / (1 + r)^t + TV / (1 + r)^n
```

其中：
- FCFt = 第 t 年的自由现金流
- r = 折现率（WACC）
- TV = 终值
- n = 预测期数

### 关键输入

| 参数 | 含义 | 影响 |
|------|------|------|
| FCF | 自由现金流 | 核心驱动 |
| WACC | 加权平均资本成本 | 折现率，越高估值越低 |
| g | 永续增长率 | 终值计算的关键 |
| n | 预测年数 | 通常 5-10 年 |
```

### Step 6: 更新侧边栏

`src/components/Sidebar.astro` 中研究库链接改为使用当前时间友好的图标，保持不变（已存在）。
```


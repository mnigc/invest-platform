import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const SITE_URL = process.env.SITE_URL || 'https://macroedge.example.com';

export default defineConfig({
  site: SITE_URL,
  integrations: [
    react(),
    sitemap({
      changefreq: 'daily',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],
  // 本项目是 SSR：index.astro 与 api/v1/* 路由用 prerender = false 走服务端渲染
  // （首页 302、DB 查询接口），@astrojs/cloudflare 也是 SSR 适配器。
  // 用 output: 'server'，各页面靠 export const prerender = true 静态预渲染。
  output: 'server',
  adapter: cloudflare(),
  // Astro 7 把默认值从 true 改成了 'jsx'，会吃掉行内元素之间跨行书写的空格
  // （面包屑分隔符、相关搜索等处依赖这个空格）。显式设回 true 保持既有排版。
  compressHTML: true,
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT) || 4321,
  },
  vite: {
    plugins: [tailwindcss()],
    // workaround for astro/astro#17868:
    // Astro 7.3 + @astrojs/cloudflare SSR 构建错误：
    // vite-plugin-assets.js 注入的 virtual 模块以 bare 路径 import "astro/_internal/logger"，
    // 但 astro 包 exports 字段不含该子路径，rolldown[vite-resolve] 无法解析 → 构建失败。
    // 将其别名到真实的 dist/core/logger/core.js（导出同名 astroToRuntimeLogger）。
    // 见：astro dist/…/vite-plugin-assets.js:RUNTIME_LOGGER_SETUP。
    resolve: {
      alias: {
        'astro/_internal/logger': fileURLToPath(
          new URL('./node_modules/astro/dist/core/logger/core.js', import.meta.url),
        ),
      },
    },
    // astro dev 跑在 workerd 里，Vite 对 SSR 依赖的“中途自动发现优化”会在请求
    // 进行时清空 .vite/deps_ssr，使 workerd 的模块句柄失效，进而破坏路由注册表
    // （getModuleForRoute / pageMap），导致后面的请求统一报
    // "Unexpectedly unable to find a component instance for route ..."。
    // 关闭 SSR 依赖的自动发现 + 排除框架入口，可稳定本地 dev。
    optimizeDeps: {
      exclude: [
        '@astrojs/cloudflare',
        '@astrojs/react',
        '@astrojs/react/server.js',
        'astro',
        'astro/actions',
        'astro/fetch',
        'astro/app/entrypoint',
      ],
    },
    ssr: {
      optimizeDeps: {
        noDiscovery: true,
        exclude: [
          '@astrojs/cloudflare',
          '@astrojs/react',
          '@astrojs/react/server.js',
          'astro',
          'astro/actions',
          'astro/fetch',
          'astro/app/entrypoint',
        ],
      },
    },
  },
});

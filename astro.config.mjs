import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

const SITE_URL = process.env.SITE_URL || 'https://macroedge.example.com';

export default defineConfig({
  site: SITE_URL,
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
    sitemap({
      changefreq: 'daily',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],
  output: 'static',
  adapter: cloudflare(),
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT) || 4321,
  },
});

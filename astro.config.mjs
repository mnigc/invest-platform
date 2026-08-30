import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  integrations: [react(), tailwind({ applyBaseStyles: false })],
  output: 'server',
  adapter: cloudflare(),
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT) || 4321,
  },
});

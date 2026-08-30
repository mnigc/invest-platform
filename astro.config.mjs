import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  integrations: [react(), tailwind({ applyBaseStyles: false })],
  output: 'hybrid',
  adapter: cloudflare(),
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT) || 4321,
  },
});

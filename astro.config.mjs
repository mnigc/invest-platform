import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  integrations: [react(), mdx()],
  output: 'hybrid',
  adapter: node({ mode: 'standalone' }),
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT) || 4321,
  },
  vite: {
    server: {
      proxy: {
        '/api/v1': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  },
});

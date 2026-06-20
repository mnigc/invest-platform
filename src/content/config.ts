import { defineCollection, z } from 'astro:content';

const library = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.string(),
    icon: z.string().optional(),
    order: z.number().optional().default(99),
  }),
});

export const collections = { library };

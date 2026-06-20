FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/

RUN npm install

COPY packages/core/ packages/core/
COPY packages/api/ packages/api/

RUN npm run build -w @invest/api

FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=builder /app/packages/api/dist ./dist
COPY --from=builder /app/packages/api/package.json ./
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3001
CMD ["node", "dist/index.js"]

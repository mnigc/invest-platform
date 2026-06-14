# 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./
RUN npm install

# 复制源码并构建
COPY . .
RUN npm run build

# 生产阶段
FROM node:20-alpine AS runner

WORKDIR /app

# 只复制构建产物和必要文件
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/ecosystem.config.js ./

# 只安装生产依赖
RUN npm install --production

# 暴露端口
EXPOSE 4321

# 使用 Node.js 直接运行（也可用 PM2）
CMD ["node", "./dist/server/entry.mjs"]

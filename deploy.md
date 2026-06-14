# 部署指南

## 1. 服务器环境要求

- Node.js >= 18
- npm >= 9
- PM2 (可选，用于进程管理)

## 2. 上传代码到服务器

```bash
# 在本地打包
npm run build

# 上传整个 web 目录到服务器，例如 /opt/invest-platform
scp -r ./web root@204.44.121.43:/opt/invest-platform
```

## 3. 服务器上安装依赖并构建

```bash
ssh root@204.44.121.43
cd /opt/invest-platform
npm install --production
npm run build
```

## 4. 环境变量配置

复制 `.env` 到服务器，确保配置正确：

```bash
cp .env.example .env
# 编辑 .env，确认数据库连接信息
```

## 5. 启动服务

### 方式一：Docker（推荐）

```bash
# 构建并启动
docker-compose up -d --build

# 查看日志
docker logs -f invest-platform

# 停止
docker-compose down
```

**1Panel Docker 部署**
1. 上传 `docker-compose.yml` 到服务器
2. 1Panel → 容器 → 编排 → 创建编排
3. 选择 `docker-compose.yml` 文件，点击部署

### 方式二：PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 方式三：直接运行

```bash
node ./dist/server/entry.mjs
```

## 6. Nginx / 1Panel 反向代理

在 1Panel 或 Nginx 中配置反向代理到 `http://127.0.0.1:4321`

## 7. 定时数据同步

在 1Panel 计划任务中添加：

```bash
curl -s "http://127.0.0.1:4321/api/sync"
```

频率：每小时一次

## 8. 本地开发连接生产数据库

本地 `.env` 已配置生产数据库地址，直接运行即可：

```bash
npm run dev
```

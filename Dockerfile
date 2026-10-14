# F-Nav Docker 镜像（多阶段构建）
# 构建：pnpm install + vite build（产出 dist/）
# 运行：零依赖 Node 服务器（server/index.js）托管静态文件 + 复用 functions/api Worker 逻辑
#       KV 存储落在文件系统（/data），挂载 volume 即可持久化

# ---------- 构建阶段 ----------
FROM node:20-alpine AS builder
WORKDIR /app

# npm 依赖镜像源（中国大陆服务器可传 --build-arg NPM_REGISTRY=https://registry.npmmirror.com 加速）
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

# 安装 pnpm（10.x：支持 pnpm-workspace.yaml 的 allowBuilds 语法，且兼容 node 20 运行时）
RUN npm i -g pnpm@10

# 先装依赖（利用 Docker 层缓存）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --registry=${NPM_REGISTRY}

# 构建前端
COPY . .
RUN pnpm build

# ---------- 运行阶段 ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV DATA_DIR=/data
ENV STORAGE_BACKEND=filesystem

# 仅复制运行所需文件（server 零依赖，无需 node_modules）
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/functions ./functions
COPY --from=builder /app/public ./public
COPY server ./server

# 数据卷：书签/分类/配置/图标缓存（挂载宿主机目录实现持久化）
VOLUME ["/data"]

EXPOSE 8080

# 健康检查：首页与 API 各探测一次
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/storage?getConfig=categories >/dev/null 2>&1 || exit 1

# 提示：管理员密码通过环境变量 PASSWORD 注入（未设置时站点无鉴权）
CMD ["node", "server/index.js"]

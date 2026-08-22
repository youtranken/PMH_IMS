# ---- build ----
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
# dist đã kèm migrations/*.sql (nest-cli assets)
COPY --from=builder /app/dist ./dist
# CHỈ script vận hành (seed tài khoản đầu tiên). Script test (reset-e2e-user) KHÔNG
# vào image production; E2E mount nó vào lúc chạy — xem docker-compose.override.e2e.yml.
COPY scripts/seed-sa.mjs ./scripts/
# Thư mục file đính kèm (AD-6) phải TỒN TẠI SẴN trong image và thuộc về user `node` (uid 1000):
# named volume của Docker lấy quyền theo thư mục có sẵn trong image lúc khởi tạo lần đầu.
# Không có dòng này thì volume ra root:root, container chạy uid 1000 và MỌI lần upload
# đều 500 "EACCES" — lỗi chỉ lộ ra khi có người thật bấm đính kèm.
RUN mkdir -p /data/files && chown -R node:node /data
USER node
EXPOSE 3000
# Story 3.5a: service worker dùng cùng image này, override command
CMD ["node", "dist/main.js"]

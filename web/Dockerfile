# ---- build ----
FROM node:24.18.0-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Cờ "Bộ giao diện" (/dev/components) — chỉ override dev/E2E truyền '1'. Production để trống
# nên trang dev không có trong bundle (FE-09, web/src/lib/dev-kit.ts).
ARG VITE_DEV_KIT=
RUN npm run build

# ---- runtime ----
FROM nginx:1.29.8-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY proxy-api-headers.conf /etc/nginx/proxy-api-headers.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80 443

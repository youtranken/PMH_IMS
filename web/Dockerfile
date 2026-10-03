# ---- draw.io: tệp tĩnh ghim phiên bản (AD-17) ----
# Chỉ lấy THƯ MỤC TĨNH của webapp; Tomcat và servlet (/proxy tải hộ URL bất kỳ, /export, /log…)
# không vào image `web`. Ghim tag + digest: tag có thể bị đẩy lại, mà giao thức nhúng đổi theo
# phiên bản. Nâng cấp theo RUNBOOK mục H4.
FROM jgraph/drawio:31.6.1@sha256:54a3a3e6e8f9ff9bf5ee3a722d8ebe3f497da3addbcf14ef62938d07854b2561 AS drawio-src

# Gỡ thứ không được phát: cấu hình/khoá OAuth của servlet (WEB-INF), service worker (đăng ký được
# dưới /drawio/ thì chặn hộ mọi request của đường đó), source map. nginx cũng chặn các tên này —
# gỡ ở đây để chúng không tồn tại thay vì chỉ bị chặn.
FROM nginx:1.29.8-alpine AS drawio-static
COPY --from=drawio-src /usr/local/tomcat/webapps/draw /drawio
RUN rm -rf /drawio/WEB-INF /drawio/META-INF /drawio/service-worker.js* /drawio/workbox-* \
    && find /drawio -name '*.map' -delete

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
COPY drawio-headers.conf /etc/nginx/drawio-headers.conf
COPY --from=drawio-static /drawio /usr/share/nginx/drawio
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80 443

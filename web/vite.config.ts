/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // Đổi thư mục asset build 'assets'→'static' để KHÔNG đụng route SPA '/assets'
    // (nếu để 'assets', nginx serve thẳng dist/assets/ → full-load /assets bị 403).
    assetsDir: 'static',
    rollupOptions: {
      output: {
        // Tách vendor thành chunk cache dài hạn — đổi code app không bắt tải lại thư viện.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@tanstack')) return 'data-vendor';
          if (id.includes('i18next')) return 'i18n-vendor';
          if (
            id.includes('react-router') ||
            id.includes('react-dom') ||
            id.includes('/react/') ||
            id.includes('scheduler')
          )
            return 'react-vendor';
        },
      },
    },
  },
  server: {
    // Dev ngoài Docker: giữ same-origin /api như nginx làm ở production
    // (bắt buộc cho cookie httpOnly SameSite=Strict — story 1.2)
    proxy: {
      '/api': { target: 'https://localhost', changeOrigin: true, secure: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
    restoreMocks: true,
    unstubGlobals: true,
    /**
     * MÚI GIỜ CỦA BÀI KIỂM GHIM CỨNG, KHÔNG LẤY CỦA MÁY (24/09/2026).
     *
     * Mọi tầng SẢN PHẨM đã ghim giờ VN bất kể máy chạy hệ gì: `docker-compose.yml` đặt
     * `TZ: Asia/Ho_Chi_Minh` cho ba dịch vụ, API đọc `app.timezone` qua `isoDateInTz()`,
     * truy vấn nhật ký viết thẳng `AT TIME ZONE 'Asia/Ho_Chi_Minh'`, và trình duyệt của E2E
     * bị ghim bằng `timezoneId`. Chỉ tầng chạy bài kiểm bằng Node là còn lấy giờ của máy.
     *
     * Hậu quả nếu để yên: máy dev ở VN chạy bài theo giờ VN, máy chủ CI Ubuntu mặc định UTC
     * chạy bài theo UTC. Cùng một commit, hai kết quả — và kiểu hỏng tệ hơn là kiểu XANH:
     * `lib/expiry.ts` cố ý tính theo NGÀY ĐỊA PHƯƠNG (`parseDateOnly` có hẳn chú thích "nếu
     * không ngày sẽ lệch 1 ở múi giờ +07"), nên một bộ kiểm chạy ở UTC thôi không còn chạm
     * vào chính cái luật ấy nữa. Nó không đỏ, nó chỉ ngừng canh.
     *
     * Đây là lần thứ BA cùng một bẫy trong repo: `api/src/common/today.spec.ts` ghi lại lần
     * đầu ("lỗi thật E2E story 3.4 bắt được: 6 giờ sáng giờ VN, UTC vẫn là hôm qua"), lần hai
     * là `parseDateOnly` bên web, lần ba là fixture của `expiry-thresholds-live.test.tsx`
     * (đỏ 7 tiếng mỗi ngày, 24/09). Ghim ở đây để không có lần thứ tư.
     */
    env: { TZ: 'Asia/Ho_Chi_Minh' },
  },
})

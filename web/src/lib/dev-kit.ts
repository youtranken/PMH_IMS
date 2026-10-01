/**
 * "Bộ giao diện" (`/dev/components`) là trang nội bộ của đội phát triển, dữ liệu giả — bản
 * production KHÔNG có nó (Q-15, FE-09): không route, và mã của nó không nằm trong bundle. Bản
 * dev/E2E có route nhưng cũng không có mục menu hay dòng trong bảng lệnh (Q-20): vào bằng URL.
 *
 * Bật khi chạy `vite` dev, hoặc build với `VITE_DEV_KIT=1` — `docker-compose.override.e2e.yml`
 * truyền cờ này cho image web của stack dev/E2E, vì nhiều bài E2E đi qua trang đó. Compose gốc
 * (production) không truyền, nên mặc định là TẮT: quên cờ thì mất một trang dev, không phải
 * lộ nó ra prod.
 *
 * Giá trị được Vite thay bằng hằng lúc build, nên nhánh tắt bị bỏ hẳn khỏi bundle.
 */
export const DEV_KIT_ENABLED: boolean =
  import.meta.env.DEV || import.meta.env.VITE_DEV_KIT === '1';

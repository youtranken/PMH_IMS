import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ngữ cảnh của request HTTP đang chạy, đọc được từ BẤT KỲ tầng nào mà không phải luồn tham số.
 *
 * ===== VÌ SAO CÓ FILE NÀY =====
 *
 * Không có nó thì `audit_log.ip` NULL trên 100% số dòng. Cột có sẵn trong
 * `0011_audit_log.sql`; thứ cần là đường đưa IP từ `req` xuống tới `AuditWriterService`.
 *
 * Cách hiển nhiên là thêm tham số `ip` vào chữ ký: `reveal(actor, id, ip)`,
 * `openForDownload(id, actor, ip)`, `killSession(actor, sessionId, ip)`… — khoảng 15 chữ ký và
 * 62 chỗ gọi audit. Tôi KHÔNG chọn cách đó, vì hai lý do:
 *
 *   1. Nó không tự giữ. Chỗ gọi thứ 63 — viết sau, bởi người khác — sẽ quên, và hậu quả là IM
 *      LẶNG: một dòng nhật ký thiếu "từ đâu", không test nào đỏ. Đó chính xác là cơ chế đã tạo
 *      ra 100% NULL.
 *   2. Nó bắt các hàm nghiệp vụ mang theo một tham số chúng không dùng, chỉ để chuyển tiếp.
 *
 * Ở đây IP được đặt MỘT LẦN ở middleware (`app.setup.ts`) và `toRow()` tự đọc. Chỗ gọi mới
 * không phải biết gì cả, kể cả không phải nhớ.
 *
 * ===== GIỚI HẠN, ĐỌC TRƯỚC KHI DÙNG CHO VIỆC KHÁC =====
 *
 * Ngoài request thì `getStore()` trả `undefined` → `currentRequestIp()` trả `null`. Với job nền
 * (outbox relay, cron hết hạn) đó là câu trả lời ĐÚNG: không có IP client nào cả. Đừng đọc
 * `null` ở đây thành "chưa cấu hình xong" rồi đi tìm giá trị thay thế.
 *
 * Không nhét thêm dữ liệu nghiệp vụ vào đây. Ngữ cảnh ẩn khiến luồng dữ liệu khó lần ra; nó
 * đáng giá cho đúng thứ CẮT NGANG mọi tầng như IP của request. `actor` thì KHÔNG — nó đã được
 * truyền tường minh khắp nơi và việc đó vẫn đúng.
 */
export interface RequestContext {
  /** IP thật của client (đã qua `trust proxy`); `null` khi không xác định được. */
  ip: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Chạy `fn` với ngữ cảnh gắn kèm — mọi thứ `await` bên trong đều thấy nó. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** IP của request đang chạy; `null` nếu không nằm trong request nào (job nền, test đơn vị). */
export function currentRequestIp(): string | null {
  return storage.getStore()?.ip ?? null;
}

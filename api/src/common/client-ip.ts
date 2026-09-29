/** Chỉ cần đúng một thuộc tính — để `common/` không phải phụ thuộc vào `modules/auth` (AD-2). */
export interface IpBearingRequest {
  ip?: string;
}

/**
 * IP thật của client — đọc `req.ip`, KHÔNG bao giờ đọc `X-Forwarded-For` thô.
 *
 * VÌ SAO. `web/proxy-api-headers.conf:5` dùng `$proxy_add_x_forwarded_for`, tức nginx **NỐI
 * THÊM** vào giá trị client gửi lên chứ không ghi đè. Header tới đây là
 * `<client tự khai>, <IP thật>`. Lấy phần tử TRÁI NHẤT là lấy đúng thứ client tự điền vào.
 *
 * Hai hậu quả, cái đầu nặng hơn nhiều:
 *
 * 1. `auth.service.ts` băm thiết bị = `sha256(userAgent | maskIp(ip))` giữ `/24`. Kẻ đã có
 *    mật khẩu chỉ cần gửi kèm `X-Forwarded-For: 192.168.1.77` và một User-Agent phổ thông là
 *    băm trùng thiết bị đã biết của nạn nhân → `rememberWithin` trả `isNew = false` → KHÔNG
 *    có email "đăng nhập từ thiết bị mới", không dòng `auth.device.new`. Đó là cái chuông duy
 *    nhất nạn nhân được nghe. IMS chạy LAN nên dải /24 đoán được và tập User-Agent rất hẹp.
 * 2. Mọi `audit_log.ip` và `sessions.ip` mang giá trị do nghi phạm tự chọn. NFR-03 hỏi
 *    "từ đâu" thì câu trả lời là thứ nghi phạm điền vào.
 *
 * `req.ip` thì AN TOÀN: `app.setup.ts` đặt `trust proxy = 1`, nên Express bỏ đúng một hop
 * tin cậy ĐẾM TỪ PHẢI và trả về phần tử nginx đã nối — không phải phần client tự khai.
 * `LoginRateGuard:75` vốn đã dùng `request.ip`, nên đây cũng là gom hai khái niệm "IP client"
 * trong repo về một. Muốn chắc hơn nữa thì có `X-Real-IP` (nginx GHI ĐÈ bằng `$remote_addr`,
 * không nối, nên không giả được) — giữ lại đây như đường dự phòng nếu sau này bỏ trust proxy.
 *
 * Nằm ở `common/` (AD-15) vì có HAI nơi cần: controller auth và middleware dựng
 * `RequestContext` cho `audit_log.ip`. Đây là định nghĩa duy nhất của "IP client" trong repo.
 */
export function clientIp(req: IpBearingRequest): string | null {
  return req.ip ?? null;
}

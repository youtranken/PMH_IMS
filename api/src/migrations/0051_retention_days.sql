-- D-02 + "outbox không có retention": hai bảng chỉ-lớn-lên nay có ngưỡng dọn.
--
-- ===== LỖ =====
--
-- `SessionService.purgeOld()` tồn tại từ lâu, chú thích ghi hẳn "Gọi từ sweep (worker)" — và
-- KHÔNG AI GỌI. Một hàm dọn không ai gọi trông y hệt một hàm dọn đang chạy, nên chuyện này
-- sống được rất lâu mà không gì đỏ. `outbox` thì không có đường dọn nào cả.
--
-- ===== ĐO LẠI TRƯỚC KHI VÁ (21/09, DB dev) =====
--
--     outbox                69.583 hàng — 100% đã xử lý
--     sessions              67.394 hàng
--     security.probe.alert  109 hàng, mỗi hàng mang một địa chỉ email
--
-- Sổ rà soát 19/09 ghi "54.904 phiên chết" và "54.536 hàng outbox"; con số hôm nay khác vì
-- lượt gieo 200k hồ sơ (mục 13-15) đẻ ra toàn hàng MỚI — đếm theo tuổi thì gần như chưa hàng
-- nào quá 30 ngày. Nói ra chứ không chép lại số cũ.
--
-- Lỗ vẫn nguyên, vì nó là lỗ CẤU TRÚC: không có gì dọn, nên hai bảng này chỉ có một chiều.
--
-- ===== 109 HÀNG EMAIL, VÀ VÌ SAO RETENTION MỚI LÀ CHỖ ĐÚNG =====
--
-- `security.probe.alert` mang `who: <email>` trong payload. Đó là NGOẠI LỆ CÓ TÊN, khai sẵn
-- cạnh chính luật "payload không PII" (AD-11/NFR-04) — không phải vi phạm.
--
-- Nhưng ngoại lệ ấy được cấp cho việc ĐI ĐƯỜNG: để email tới được consumer mail. Giữ lại
-- VĨNH VIỄN sau khi đã gửi xong chưa bao giờ nằm trong phần được cấp — và mỗi bản `pg_dump`
-- đêm chở theo danh sách những người từng bị nghi dò két.
--
-- Nên không đụng tới ngoại lệ; chỉ thôi giữ mãi.
--
-- ===== HAI NGƯỠNG, KHÔNG PHẢI MỘT =====
--
-- Tách riêng vì hai bảng trả lời hai câu khác nhau và sẽ được siết theo hai nhịp khác nhau:
-- một dòng outbox đã gửi xong hết giá trị gần như ngay lập tức, còn một phiên đã chết vẫn là
-- dữ kiện cho câu "ai đăng nhập từ máy nào" trong lúc điều tra một sự cố.
--
-- KHÔNG áp cho `audit_log` và các bảng `*_history`: chúng chỉ-thêm và giữ VĨNH VIỄN theo
-- NFR-03/AD-13. Hai ngưỡng dưới chỉ nói về vết KỸ THUẬT, không phải sổ nghiệp vụ.

INSERT INTO system_config (key, value, description) VALUES
  ('session.retention_days', '30',
   'Phiên đăng nhập đã chết (last_seen_at cũ hơn ngần này ngày) thì lượt sweep xoá hẳn. Không áp cho audit_log — sổ nhật ký giữ vĩnh viễn theo NFR-03'),
  ('outbox.retention_days', '30',
   'Dòng outbox ĐÃ XỬ LÝ XONG cũ hơn ngần này ngày thì lượt sweep xoá hẳn. Dòng CHƯA xử lý không bao giờ bị đụng tới, dù cũ tới đâu — chưa xử nghĩa là việc chưa xong')
ON CONFLICT (key) DO NOTHING;

/*
 * Chỉ mục cho chính câu lệnh dọn.
 *
 * Không có nó thì lượt sweep quét toàn bảng mỗi phút — và bảng này lớn lên mãi, tức cái giá
 * ấy cũng lớn lên mãi. Đúng lớp lỗi mà `audit_count_cap` đã dọn ở màn nhật ký.
 *
 * Một phần (`WHERE processed_at IS NOT NULL`): hàng chưa xử lý không bao giờ là ứng viên dọn,
 * nên để chúng ngoài cây index luôn — index nhỏ hơn, và `relayBatch` vẫn dùng index riêng của nó.
 */
CREATE INDEX IF NOT EXISTS outbox_processed_at_idx
  ON outbox (processed_at) WHERE processed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS sessions_last_seen_idx ON sessions (last_seen_at);

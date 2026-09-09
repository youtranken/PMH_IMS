/*
 * HAI NGƯỠNG "SẮP HẾT HẠN" RA KHỎI CODE (AD-11, DoD gạch 8).
 *
 * ===== ĐANG SAI Ở ĐÂU =====
 *
 * Luật "sắp hết hạn" của cả hệ thống là hai con số: 7 ngày là GẤP, 30 ngày là SẮP. Chúng đang
 * được viết cứng ở BA chỗ độc lập, không chỗ nào biết chỗ nào:
 *
 *   1. `api/.../expiry.service.ts`  — `const CRITICAL_DAYS = 7`
 *   2. `api/.../expiry.service.ts`  — `clampWindow()` mặc định 30
 *   3. `web/src/lib/expiry.ts`      — `DEFAULT_EXPIRY_THRESHOLDS = { 7, 30 }`
 *
 * Chú thích ở cả hai file đều tự nhận là "khớp nhau" — bằng lời hứa, không bằng cơ chế. Đổi
 * một chỗ mà quên chỗ kia thì huy hiệu trên hàng và con số trên chip đếm theo hai luật khác
 * nhau, và không có bài kiểm nào bắt được vì mỗi bên đều tự nhất quán với chính nó.
 *
 * ===== VÌ SAO ĐÂY LÀ THAM SỐ NGHIỆP VỤ, KHÔNG PHẢI HẰNG SỐ HIỂN THỊ =====
 *
 * "Trước bao nhiêu ngày thì phải bắt đầu lo" là câu trả lời của bộ phận IT, không của lập
 * trình viên, và nó đổi theo thực tế mua sắm: gia hạn một chứng chỉ SSL mất một buổi, gia hạn
 * hợp đồng đường truyền với nhà mạng mất ba tuần. Cùng khuôn với hai ngưỡng của bảng điều
 * khiển ở 0038 — sửa bằng một dòng UPDATE, không dựng lại ảnh docker.
 */
INSERT INTO system_config (key, value, description) VALUES
  ('expiry.critical_days', '7',  'Còn bao nhiêu ngày trở xuống thì gọi là GẤP (đỏ) — FR-012'),
  ('expiry.warning_days',  '30', 'Còn bao nhiêu ngày trở xuống thì gọi là SẮP HẾT HẠN (vàng), và là cửa sổ mặc định của màn Sắp hết hạn — FR-012')
ON CONFLICT (key) DO NOTHING;

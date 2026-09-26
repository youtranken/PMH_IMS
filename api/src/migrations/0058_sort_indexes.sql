-- §8.8 — CHỈ MỤC CHO MỌI CỘT SẮP XẾP ĐƯỢC (26/09/2026).
--
-- ===== LỖI ĐANG CHỮA =====
--
-- Bốn màn danh sách cho người dùng bấm tiêu đề cột để sắp xếp, nhưng không cột nào có chỉ mục
-- phục vụ được thứ tự ấy. Đo ở 1 triệu dòng (§15 sổ rà soát): một cú bấm vào "Tên thiết bị"
-- mất 340ms ở trang 1, 1.949ms ở trang sâu, và làm tràn 228 MB ra đĩa. Có chỉ mục: 0,083ms.
--
-- ===== BA CHỖ KẾ HOẠCH BAN ĐẦU GHI SAI, ĐO RA MỚI BIẾT =====
--
-- (1) Sổ ghi chỉ mục `(name, id)`. Nhưng `ORDER BY` thật của cả bốn service chốt hạ bằng
--     `code`, không phải `id`. Làm theo sổ là dựng 16 chỉ mục mà planner không bao giờ chọn —
--     đúng thứ sổ tự cảnh báo ở mục 5 ("đã thêm index" ≠ "câu truy vấn CÓ DÙNG index đó").
--
-- (2) Bốn service viết `[primary, asc(code)]` — khoá chốt hạ CỐ ĐỊNH `asc`. Sắp giảm sinh ra
--     `ORDER BY name DESC, code ASC`: btree chỉ cho quét xuôi `(ASC,ASC)` và quét ngược
--     `(DESC,DESC)`, nên hình dạng TRỘN hướng buộc Postgres chồng thêm một `Incremental Sort`
--     lên trên index scan — nó sắp lại TỪNG NHÓM hàng cùng `name`.
--
--     Đo trên 200.003 hàng, và ca xấu nhất là cột ÍT GIÁ TRỊ KHÁC NHAU (`status`, 4 giá trị),
--     nơi "một nhóm" là 50.000 hàng:
--
--       ORDER BY status DESC, code ASC   → Incremental Sort, 50.001 hàng →  192,08 ms
--       ORDER BY status DESC, code DESC  → Index Scan Backward, hết      →   0,069 ms
--
--     Chênh 2.783 lần, ở TRANG 1. Trên cột nhiều giá trị (`name`) chênh nhẹ hơn nhưng vẫn
--     thật: 98,2ms so với 55,1ms ở trang cuối. Đã sửa nguồn: `orderByStable` trong
--     `common/sorting.ts` cho khoá chốt hạ đi theo hướng chính — thứ tự giữa hai hàng trùng
--     giá trị vốn tuỳ ý, cần ỔN ĐỊNH chứ không cần theo chiều nào. Cách còn lại là dựng 38 chỉ
--     mục thay vì 19.
--
-- (3) Sổ đếm 16 cột. Đếm lại theo `*_SORT_KEYS` thật thì có 19 cột sắp được (không kể `code`,
--     đã có khoá duy nhất): sổ bỏ sót `device.status`, `software.kind`, `isp_line.provider`.
--     Ba cột ấy CÓ chỉ mục sẵn nhưng đều vô dụng cho `ORDER BY`: `device_status_idx` và
--     `software_kind_idx` chỉ có MỘT cột (Postgres phải Incremental Sort phần `code` còn lại),
--     `isp_line.provider` thì không có chỉ mục nào.
--
-- ===== VÌ SAO KHÔNG `CONCURRENTLY` (khác hẳn 0053-0057) =====
--
-- 0053-0057 dựng GIN trigram: 86 MB và hàng phút ở cỡ triệu dòng, nên để nó khoá bảng là
-- không chấp nhận được. Ở đây là btree hai cột. Đo trên 200.003 hàng `device`: 248ms · 362ms ·
-- 554ms · 675ms · 1.465ms cho năm chỉ mục — tổng 3,3 giây (cột ít giá trị khác nhau lâu nhất).
-- Ba bảng còn lại nhỏ hơn hẳn trong thực tế, nên cả 19 chỉ mục ở cỡ 1 triệu thiết bị ước ~17
-- giây. `CREATE INDEX` thường giữ SHARE (chặn ghi, vẫn cho đọc) trong quãng đó, mà migration
-- chạy lúc api khởi động nên đường ghi đang đứng sẵn. Đánh đổi: một migration transaction
-- nguyên khối, rollback được, thay vì 19 file no-transaction không rollback được.
--
-- GIÁ PHẢI TRẢ, đo được: 41 MB cho năm chỉ mục của `device` ở 200.003 hàng ⇒ ~205 MB ở 1 triệu
-- thiết bị, cộng chi phí ghi mỗi lượt INSERT/UPDATE. Đó là giá của việc cho người dùng bấm sắp
-- xếp trên MỌI cột; nếu về sau thấy có cột chẳng ai bấm thì gỡ chỉ mục của nó, đừng gỡ cả bộ.
--
-- Bài canh: `api/test/sort-index.spec.ts` — đọc `EXPLAIN` của đúng câu bốn service sinh ra,
-- cho CẢ HAI hướng của CẢ 19 cột, và đỏ nếu thấy một node `Sort`.
--
-- KHÔNG gỡ chỉ mục cũ nào. `device_warranty_idx`, `software_end_idx`, `isp_line_end_idx` là
-- PARTIAL (`WHERE status <> …`), dựng cho màn Sắp hết hạn — chúng không phục vụ `ORDER BY`
-- của màn danh sách, nhưng gỡ đi là làm chậm một màn khác.

-- device — 5 cột sắp được ngoài `code`
CREATE INDEX device_name_code_idx        ON device (name, code);
CREATE INDEX device_serial_code_idx      ON device (serial, code);
CREATE INDEX device_assigned_code_idx    ON device (assigned_to, code);
CREATE INDEX device_status_code_idx      ON device (status, code);
CREATE INDEX device_warranty_code_idx    ON device (warranty_end, code);

-- software — 6 cột
CREATE INDEX software_name_code_idx      ON software (name, code);
CREATE INDEX software_kind_code_idx      ON software (kind, code);
CREATE INDEX software_seats_code_idx     ON software (seat_total, code);
CREATE INDEX software_start_code_idx     ON software (start_date, code);
CREATE INDEX software_end_code_idx       ON software (end_date, code);
CREATE INDEX software_status_code_idx    ON software (status, code);

-- service_account — 3 cột
CREATE INDEX service_account_name_code_idx   ON service_account (name, code);
CREATE INDEX service_account_kind_code_idx   ON service_account (kind, code);
CREATE INDEX service_account_status_code_idx ON service_account (status, code);

-- isp_line — 5 cột
CREATE INDEX isp_line_provider_code_idx  ON isp_line (provider, code);
CREATE INDEX isp_line_hotline_code_idx   ON isp_line (hotline, code);
CREATE INDEX isp_line_contract_code_idx  ON isp_line (contract_no, code);
CREATE INDEX isp_line_end_code_idx       ON isp_line (end_date, code);
CREATE INDEX isp_line_status_code_idx    ON isp_line (status, code);

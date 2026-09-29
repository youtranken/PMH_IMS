-- Website dùng chứng chỉ SSL / tên miền nào, theo từng năm (Q-15, SW-043).
--
-- `software.websites`: danh sách HIỆN TẠI của hồ sơ — ô tìm của danh sách phần mềm đọc nó để
-- trả lời "shop.pmh.vn đang dùng cert nào". Rỗng với mọi loại không phải SSL/tên miền.
--
-- `renewal_history.websites`: ảnh chụp danh sách của RIÊNG kỳ gia hạn đó. Để ở hồ sơ thôi thì
-- sửa danh sách năm nay là mất câu trả lời "năm 2025 cert này phủ những website nào". NULL =
-- loại hồ sơ không có khái niệm website (license, bảo trì…), khác mảng rỗng (SSL chưa ghi
-- website nào). Bảng vẫn chỉ-thêm: REVOKE + trigger của 0017 áp cả cột mới.
ALTER TABLE software
  ADD COLUMN websites text[] NOT NULL DEFAULT '{}';

ALTER TABLE renewal_history
  ADD COLUMN websites text[];

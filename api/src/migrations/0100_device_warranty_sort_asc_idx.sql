-- ims:no-transaction
--
-- Sắp danh sách thiết bị theo Bảo hành TĂNG DẦN: máy đã thanh lý và máy chưa khai hạn xuống cuối
-- (`deviceOrderBy`). Một câu lệnh mỗi file vì CREATE INDEX CONCURRENTLY không chạy trong
-- transaction — xem 0053.

CREATE INDEX CONCURRENTLY IF NOT EXISTS device_warranty_sort_asc_idx
  ON device ((status = 'retired'), warranty_end ASC NULLS LAST, code ASC);

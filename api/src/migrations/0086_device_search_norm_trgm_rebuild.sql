-- ims:no-transaction
--
-- Dựng lại chỉ mục tìm kiếm của `device` sau khi 0085 thay cột sinh. Tách file và chỉ MỘT câu
-- lệnh vì CREATE INDEX CONCURRENTLY không chạy trong transaction — xem chú thích ở 0053.

CREATE INDEX CONCURRENTLY IF NOT EXISTS device_search_norm_trgm
  ON device USING gin (search_norm gin_trgm_ops);

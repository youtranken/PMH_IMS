-- ims:no-transaction
--
-- B-01 — chỉ mục tìm kiếm cho `software`. Lý do tách file và lý do KHÔNG có file
-- `DROP INDEX CONCURRENTLY` đi trước: xem 0053, nơi ghi đầy đủ một lần cho cả năm file.

CREATE INDEX CONCURRENTLY IF NOT EXISTS software_search_norm_trgm
  ON software USING gin (search_norm gin_trgm_ops);
